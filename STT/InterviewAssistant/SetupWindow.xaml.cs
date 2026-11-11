using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Win32;

namespace InterviewAssistant;

/// <summary>
/// All settings in one place, in six tabs. Text, timing and hotkeys are written to the settings on
/// Save; the choices that change the running app (sending, view style, captions, theme, window) are
/// exposed as Chosen* properties so the main window can apply them live.
/// </summary>
public partial class SetupWindow : Window
{
    const string NoHotkey = "Not set";


    readonly AppSettings _settings;
    readonly TextBox[] _hotkeyBoxes;
    readonly (RadioButton Button, CaptionDock Dock)[] _docks;

    public bool ChosenSubmitAutomatically { get; private set; }
    public bool ChosenAutoSend { get; private set; }
    public bool ChosenOverlay { get; private set; }
    public CaptionDock ChosenCaptionDock { get; private set; }
    public AppTheme ChosenTheme { get; private set; }
    public bool ChosenAlwaysOnTop { get; private set; }
    public bool ChosenHideFromCapture { get; private set; }
    public bool ChosenHideLiveCaptions { get; private set; }

    // Plays the Test sentence; the main window keeps its own speaker.
    AnswerSpeaker? _testSpeaker;

    /// <summary>
    /// The Test voice started (true) or stopped. Live Captions hears it like any other sound, so the
    /// main window treats it like the answer's voice and does not send its words.
    /// </summary>
    public event Action<bool, bool>? TestVoiceChanged;
    string? _savedGoogleKey;

    // Answers: the key typed for each API (kept while switching between them), and the saved ones.
    readonly Dictionary<AnswerEngine, string> _typedApiKeys = [];
    AnswerEngine _shownEngine = AnswerEngine.ChatPage;

    public SetupWindow(AppSettings settings, string? tab = null)
    {
        InitializeComponent();
        _settings = settings;
        _hotkeyBoxes = [HotkeySendBox, HotkeyDiscardBox, HotkeySubmitBox, HotkeyClearBox, HotkeyAutoBox, HotkeyCompactBox,
            HotkeyScrollDownBox, HotkeyScrollUpBox, HotkeyLessSeeThroughBox, HotkeyMoreSeeThroughBox, HotkeyVoiceBox, HotkeyStopVoiceBox,
            HotkeyShowHideBox];
        _docks =
        [
            (DockTop, CaptionDock.Top), (DockBottom, CaptionDock.Bottom), (DockLeft, CaptionDock.Left),
            (DockRight, CaptionDock.Right), (DockFloating, CaptionDock.Floating),
        ];

        // Interview
        ProfileBox.Text = settings.Profile;
        CompanyBox.Text = settings.Company;
        JobDescriptionBox.Text = settings.JobDescription;
        ResumeBox.Text = settings.Resume;
        CallPromptBox.Text = settings.CallPromptTemplate;

        // Sending: one choice instead of two switches
        (settings.AutoSend ? SendModeAuto : settings.SubmitAutomatically ? SendModeSubmit : SendModeManual).IsChecked = true;
        PauseBox.Text = settings.PauseSeconds.ToString("0.0#", CultureInfo.InvariantCulture);
        MinWordsBox.Text = settings.MinWords.ToString(CultureInfo.InvariantCulture);

        // Display
        (settings.OverlayMode ? StyleOverlay : StyleWindow).IsChecked = true;
        (_docks.FirstOrDefault(d => d.Dock == settings.CompactCaptionDock).Button ?? DockBottom).IsChecked = true;
        (settings.Theme switch { AppTheme.Light => ThemeLight, AppTheme.System => ThemeSystem, _ => ThemeDark }).IsChecked = true;
        TopmostToggle.IsChecked = settings.AlwaysOnTop;
        HideFromCaptureToggle.IsChecked = settings.HideFromCapture;
        HideLcToggle.IsChecked = settings.HideLiveCaptionsWindow;

        // Answers
        (settings.AnswerEngine switch { AnswerEngine.OpenAi => EngineOpenAi, AnswerEngine.DeepSeek => EngineDeepSeek, _ => EngineChatPage })
            .IsChecked = true;
        InterviewTypeBox.ItemsSource = InterviewStyles.All.Select(t => new VoiceChoice(t.ToString(), InterviewStyles.Name(t))).ToList();
        InterviewTypeBox.SelectedIndex = Array.IndexOf(InterviewStyles.All, settings.InterviewType);
        (settings.AnswerLength switch { AnswerLength.Short => LengthShort, AnswerLength.Detailed => LengthDetailed, _ => LengthNormal })
            .IsChecked = true;
        OnEngineChecked(this, new RoutedEventArgs());

        // Voice
        SpeakToggle.IsChecked = settings.SpeakAnswers;
        SkipCaptionsToggle.IsChecked = settings.VoiceSkipsCaptions;
        RateSlider.Value = settings.VoiceRate;
        var voices = AnswerSpeaker.WindowsVoices();
        VoiceBox.ItemsSource = voices;
        VoiceBox.SelectedItem = voices.FirstOrDefault(v => v.Id == settings.VoiceId) ?? voices.FirstOrDefault();
        // Until Google's list arrives, the saved voice is the only choice.
        ShowGoogleVoices([new VoiceChoice(settings.GoogleVoice, settings.GoogleVoice)], settings.GoogleVoice);
        _savedGoogleKey = ProtectedText.Unprotect(settings.GoogleKeyProtected);
        GoogleKeyStatus.Text = _savedGoogleKey != null
            ? "A key is saved. Paste a new one only to replace it."
            : "No key yet: until you add one, the Windows voice reads the answers.";
        (settings.VoiceService == VoiceService.Google ? ServiceGoogle : ServiceWindows).IsChecked = true;
        OnVoiceServiceChecked(this, new RoutedEventArgs());
        Loaded += async (_, _) =>
        {
            var devices = await AnswerSpeaker.OutputDevicesAsync();
            DeviceBox.ItemsSource = devices;
            DeviceBox.SelectedItem = devices.FirstOrDefault(d => d.Id == settings.VoiceDeviceId) ?? devices[0];
            if (_savedGoogleKey != null)
            {
                await LoadGoogleVoicesAsync(_savedGoogleKey, quiet: true);
            }
        };
        Closed += (_, _) => _testSpeaker?.Dispose();

        // Hotkeys
        var keys = settings.Hotkeys;
        string[] current = [keys.Send, keys.Discard, keys.SubmitChatBox, keys.ClearChatBox, keys.ToggleAutoSend, keys.ToggleCompact,
            keys.ScrollAnswerDown, keys.ScrollAnswerUp, keys.LessSeeThrough, keys.MoreSeeThrough, keys.ToggleVoice, keys.StopVoice,
            keys.ShowHide];
        for (int i = 0; i < _hotkeyBoxes.Length; i++)
        {
            var box = _hotkeyBoxes[i];
            box.IsReadOnly = true;
            box.IsReadOnlyCaretVisible = false;
            box.Cursor = Cursors.Hand;
            ShowHotkey(box, Hotkey.TryParse(current[i], out var hotkey) ? hotkey.ToString() : NoHotkey);
            box.PreviewKeyDown += OnHotkeyBoxKeyDown;
            box.GotKeyboardFocus += (_, _) => box.SetResourceReference(BackgroundProperty, "PendingBg");
            box.LostKeyboardFocus += (_, _) => box.ClearValue(BackgroundProperty);
        }
        HotkeyAppsBox.Text = settings.HotkeyApps;
        HotkeysEverywhereToggle.IsChecked = settings.CommonHotkeysEverywhere;
        UpdateHotkeyWarning();

        SourceInitialized += (_, _) =>
        {
            if (settings.HideFromCapture)
                NativeMethods.SetCaptureExclusion(new WindowInteropHelper(this).Handle, true);
        };
        (tab switch { "sending" => TabSending, "display" => TabDisplay, "answers" => TabAnswers, "voice" => TabVoice, "hotkeys" => TabHotkeys, _ => TabInterview }).IsChecked = true;
        OnTabChecked(this, new RoutedEventArgs()); // the page that was already selected raises no event
    }

    void OnTabChecked(object sender, RoutedEventArgs e)
    {
        if (PageInterview == null)
        {
            return; // fired during InitializeComponent
        }
        PageInterview.Visibility = TabInterview.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        PageSending.Visibility = TabSending.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        PageDisplay.Visibility = TabDisplay.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        PageAnswers.Visibility = TabAnswers.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        PageVoice.Visibility = TabVoice.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        PageHotkeys.Visibility = TabHotkeys.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        (PageTitle.Text, PageSubtitle.Text) =
            TabSending.IsChecked == true ? ("Sending", "What happens when you press Send.")
            : TabDisplay.IsChecked == true ? ("Display", "How the interview view looks, the theme, and the window.")
            : TabAnswers.IsChecked == true ? ("Answers", "Where answers come from, and how they fit the interview round.")
            : TabVoice.IsChecked == true ? ("Voice", "Hear the answer instead of reading it.")
            : TabHotkeys.IsChecked == true ? ("Hotkeys", "Keys that work everywhere, also while the meeting app has focus.")
            : ("Interview", "Who you are and the role you're interviewing for. Sent to the AI with the call prompt.");
        PageScroll.ScrollToTop();
    }

    void OnSendModeChecked(object sender, RoutedEventArgs e)
    {
        if (AutoOptions != null)
        {
            AutoOptions.Visibility = SendModeAuto.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    void OnViewStyleChecked(object sender, RoutedEventArgs e)
    {
        if (DockOptions != null)
        {
            // In the overlay the captions always sit below the answer.
            DockOptions.Visibility = StyleWindow.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    AnswerEngine ChosenEngine =>
        EngineOpenAi.IsChecked == true ? AnswerEngine.OpenAi : EngineDeepSeek.IsChecked == true ? AnswerEngine.DeepSeek : AnswerEngine.ChatPage;

    string SavedApiKeyProtected(AnswerEngine engine) =>
        engine == AnswerEngine.DeepSeek ? _settings.DeepSeekKeyProtected : _settings.OpenAiKeyProtected;

    string SavedApiModel(AnswerEngine engine) =>
        engine == AnswerEngine.DeepSeek ? _settings.DeepSeekModel : _settings.OpenAiModel;

    string ApiKeyFor(AnswerEngine engine) =>
        _typedApiKeys.TryGetValue(engine, out string? typed) && typed.Length > 0 ? typed
        : ProtectedText.Unprotect(SavedApiKeyProtected(engine)) ?? "";

    void OnEngineChecked(object sender, RoutedEventArgs e)
    {
        if (ApiPanel == null)
        {
            return;
        }
        if (_shownEngine != AnswerEngine.ChatPage)
        {
            _typedApiKeys[_shownEngine] = ApiKeyBox.Password.Trim();
        }
        var engine = ChosenEngine;
        _shownEngine = engine;
        ApiPanel.Visibility = engine == AnswerEngine.ChatPage ? Visibility.Collapsed : Visibility.Visible;
        if (engine == AnswerEngine.ChatPage)
        {
            return;
        }
        ApiKeyLabel.Text = $"{DirectChat.DisplayName(engine)} key";
        ApiKeyBox.Password = _typedApiKeys.TryGetValue(engine, out string? typed) ? typed : "";
        bool saved = ProtectedText.Unprotect(SavedApiKeyProtected(engine)) != null;
        ShowApiStatus(saved ? "A key is saved. Paste a new one only to replace it." : "Paste your API key, then press Check key.", error: false, neutral: true);
        string model = SavedApiModel(engine);
        ApiModelBox.ItemsSource = model.Length > 0 ? new[] { model } : Array.Empty<string>();
        ApiModelBox.SelectedItem = model.Length > 0 ? model : null;
        if (saved)
        {
            _ = LoadApiModelsAsync(engine, quiet: true);
        }
    }

    void OnApiKeyChanged(object sender, RoutedEventArgs e) =>
        ShowApiStatus(ApiKeyBox.Password.Length > 0 ? "Press Check key to try it." : "", error: false, neutral: true);

    async void OnCheckApiKeyClick(object sender, RoutedEventArgs e)
    {
        _typedApiKeys[ChosenEngine] = ApiKeyBox.Password.Trim();
        if (ApiKeyFor(ChosenEngine).Length == 0)
        {
            ShowApiStatus("Paste the API key first.", error: true);
            return;
        }
        await LoadApiModelsAsync(ChosenEngine, quiet: false);
    }

    async Task LoadApiModelsAsync(AnswerEngine engine, bool quiet)
    {
        if (!quiet)
        {
            ShowApiStatus("Checking the key…", error: false, neutral: true);
        }
        try
        {
            var models = await DirectChat.ModelsAsync(engine, ApiKeyFor(engine));
            if (engine != ChosenEngine)
            {
                return;
            }
            string current = ApiModelBox.SelectedItem as string ?? SavedApiModel(engine);
            ApiModelBox.ItemsSource = models;
            ApiModelBox.SelectedItem = models.Contains(current) ? current : models.FirstOrDefault();
            if (!quiet)
            {
                ShowApiStatus($"The key works: {models.Count} chat models. The first ones are quickest.", error: false);
            }
        }
        catch (Exception ex)
        {
            if (engine == ChosenEngine)
            {
                ShowApiStatus(ex is DirectChatException ? ex.Message : $"Could not reach the {DirectChat.DisplayName(engine)}: {ex.Message}", error: true);
            }
        }
    }

    void ShowApiStatus(string text, bool error, bool neutral = false)
    {
        ApiKeyStatus.Text = text;
        ApiKeyStatus.SetResourceReference(TextBlock.ForegroundProperty, neutral ? "Muted" : error ? "Danger" : "Success");
    }

    void OnRateChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        if (RateLabel != null)
        {
            RateLabel.Text = $"{RateSlider.Value:0.0#}×";
        }
    }

    bool GoogleChosen => ServiceGoogle.IsChecked == true;

    /// <summary>The key in the box, or else the saved one.</summary>
    string GoogleKey => GoogleKeyBox.Password.Trim().Length > 0 ? GoogleKeyBox.Password.Trim() : _savedGoogleKey ?? "";

    void OnVoiceServiceChecked(object sender, RoutedEventArgs e)
    {
        if (GooglePanel == null)
        {
            return; // fired during InitializeComponent
        }
        bool google = GoogleChosen;
        GooglePanel.Visibility = google ? Visibility.Visible : Visibility.Collapsed;
        GoogleVoiceBox.Visibility = google ? Visibility.Visible : Visibility.Collapsed;
        VoiceBox.Visibility = google ? Visibility.Collapsed : Visibility.Visible;
    }

    void OnGoogleKeyChanged(object sender, RoutedEventArgs e)
    {
        GoogleKeyStatus.SetResourceReference(TextBlock.ForegroundProperty, "Muted");
        GoogleKeyStatus.Text = GoogleKeyBox.Password.Length > 0 ? "Press Check key to try it." : "";
    }

    async void OnCheckGoogleKeyClick(object sender, RoutedEventArgs e)
    {
        if (GoogleKey.Length == 0)
        {
            ShowKeyStatus("Paste the API key first.", error: true);
            return;
        }
        await LoadGoogleVoicesAsync(GoogleKey, quiet: false);
    }

    async Task LoadGoogleVoicesAsync(string key, bool quiet)
    {
        if (!quiet)
        {
            ShowKeyStatus("Checking the key with Google…", error: false);
        }
        try
        {
            var voices = await GoogleSpeech.VoicesAsync(key);
            string current = (GoogleVoiceBox.SelectedItem as VoiceChoice)?.Id ?? _settings.GoogleVoice;
            ShowGoogleVoices(voices, current);
            if (!quiet)
            {
                ShowKeyStatus($"The key works: {voices.Count} English voices. Pick one and press Test.", error: false);
            }
        }
        catch (Exception ex)
        {
            ShowKeyStatus(ex is GoogleSpeechException ? ex.Message : $"Could not reach Google: {ex.Message}", error: true);
        }
    }

    void ShowGoogleVoices(IReadOnlyList<VoiceChoice> voices, string selected)
    {
        GoogleVoiceBox.ItemsSource = voices;
        GoogleVoiceBox.SelectedItem = voices.FirstOrDefault(v => v.Id == selected)
            ?? voices.FirstOrDefault(v => v.Id == GoogleSpeech.DefaultVoice) ?? voices.FirstOrDefault();
    }

    void ShowKeyStatus(string text, bool error)
    {
        GoogleKeyStatus.Text = text;
        GoogleKeyStatus.SetResourceReference(TextBlock.ForegroundProperty, error ? "Danger" : "Success");
    }

    void OnOpenGoogleCloudClick(object sender, RoutedEventArgs e) =>
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(GoogleSpeech.ConsoleUrl) { UseShellExecute = true });

    async void OnTestVoiceClick(object sender, RoutedEventArgs e)
    {
        if (_testSpeaker == null)
        {
            _testSpeaker = new AnswerSpeaker();
            _testSpeaker.Problem += message => ShowKeyStatus(message, error: true);
            _testSpeaker.SpeakingChanged += () => TestVoiceChanged?.Invoke(_testSpeaker.IsSpeaking, _testSpeaker.HeardByCaptions);
        }
        await _testSpeaker.ConfigureAsync(GoogleChosen ? VoiceService.Google : VoiceService.Windows, GoogleKey,
            (GoogleVoiceBox.SelectedItem as VoiceChoice)?.Id ?? "", (VoiceBox.SelectedItem as VoiceChoice)?.Id ?? "",
            RateSlider.Value, (DeviceBox.SelectedItem as VoiceChoice)?.Id ?? "");
        _testSpeaker.Say("Hi! This is how your answers will sound. I usually start with a one-sentence answer, then a few points to expand on.");
    }

    void OnHotkeyScopeChanged(object sender, RoutedEventArgs e)
    {
        if (HotkeyWarning != null)
        {
            UpdateHotkeyWarning();
        }
    }

    void OnHotkeyBoxKeyDown(object sender, KeyEventArgs e)
    {
        var box = (TextBox)sender;
        Key key = e.Key == Key.System ? e.SystemKey : e.Key;
        if (key is Key.Tab or Key.Escape && Keyboard.Modifiers == ModifierKeys.None)
        {
            return; // Tab moves between fields, Esc still closes the window
        }
        e.Handled = true;
        if (Hotkey.IsModifierKey(key) || key == Key.ImeProcessed)
        {
            return;
        }
        if (key is Key.Back or Key.Delete && Keyboard.Modifiers == ModifierKeys.None)
        {
            ShowHotkey(box, NoHotkey);
            UpdateHotkeyWarning();
            return;
        }
        var hotkey = new Hotkey(Keyboard.Modifiers, key);
        ShowHotkey(box, hotkey.IsValid ? hotkey.ToString() : box.Text);
        box.ToolTip = hotkey.IsValid ? null : "Add Ctrl, Alt or Win, or use a function key (F1–F24).";
        UpdateHotkeyWarning();
    }

    /// <summary>A set combination reads like a key (monospace); an empty box says "Not set" quietly.</summary>
    void ShowHotkey(TextBox box, string text)
    {
        box.Text = text;
        bool empty = text == NoHotkey;
        box.FontFamily = (FontFamily)FindResource(empty ? "UiFont" : "MonoFont");
        box.SetResourceReference(ForegroundProperty, empty ? "Faint" : "Text");
    }

    void UpdateHotkeyWarning()
    {
        var notes = _hotkeyBoxes.Select(b => b.Text).Where(Hotkey.CommonShortcuts.ContainsKey).Distinct()
            .Select(h => $"{h} is {Hotkey.CommonShortcuts[h]} in other programs.").ToList();
        HotkeyWarning.Visibility = notes.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        HotkeyWarningText.Text = notes.Count == 0 ? ""
            : HotkeysEverywhereToggle.IsChecked == true
                ? string.Join(" ", notes) + " While Interview Assistant runs, "
                  + (notes.Count == 1 ? "that key does the app's action instead, everywhere."
                     : "those keys do the app's actions instead, everywhere.")
                  + " Combinations with Ctrl+Alt are usually free."
                : string.Join(" ", notes) + " "
                  + (notes.Count == 1 ? "It does the app's action" : "They do the app's actions")
                  + " only in Interview Assistant and the apps listed above, and keep their normal job everywhere else."
                  + " Combinations with Ctrl+Alt are free everywhere.";
    }

    void OnSaveClick(object sender, RoutedEventArgs e)
    {
        bool auto = SendModeAuto.IsChecked == true;
        double pause = _settings.PauseSeconds;
        int minWords = _settings.MinWords;
        if (auto)
        {
            if (!double.TryParse(PauseBox.Text.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out pause)
                || pause < 0.3 || pause > 10)
            {
                ShowProblem(TabSending, PauseBox, "The pause must be a number of seconds between 0.3 and 10.");
                return;
            }
            if (!int.TryParse(MinWordsBox.Text, out minWords) || minWords < 1 || minWords > 50)
            {
                ShowProblem(TabSending, MinWordsBox, "The minimum number of words must be a whole number between 1 and 50.");
                return;
            }
        }
        string[] hotkeys = _hotkeyBoxes.Select(b => b.Text == NoHotkey ? "" : b.Text).ToArray();
        string? duplicate = hotkeys.Where(h => h.Length > 0).GroupBy(h => h).FirstOrDefault(g => g.Count() > 1)?.Key;
        if (duplicate != null)
        {
            ShowProblem(TabHotkeys, null, $"{duplicate} is used for more than one action.");
            return;
        }

        _settings.Profile = ProfileBox.Text.Trim();
        _settings.Company = CompanyBox.Text.Trim();
        _settings.JobDescription = JobDescriptionBox.Text.Trim();
        _settings.Resume = ResumeBox.Text.Trim();
        _settings.CallPromptTemplate = string.IsNullOrWhiteSpace(CallPromptBox.Text)
            ? AppSettings.DefaultCallPrompt
            : CallPromptBox.Text.Trim();
        _settings.PauseSeconds = pause;
        _settings.MinWords = minWords;
        _settings.Hotkeys = new HotkeySettings
        {
            Send = hotkeys[0],
            Discard = hotkeys[1],
            SubmitChatBox = hotkeys[2],
            ClearChatBox = hotkeys[3],
            ToggleAutoSend = hotkeys[4],
            ToggleCompact = hotkeys[5],
            ScrollAnswerDown = hotkeys[6],
            ScrollAnswerUp = hotkeys[7],
            LessSeeThrough = hotkeys[8],
            MoreSeeThrough = hotkeys[9],
            ToggleVoice = hotkeys[10],
            StopVoice = hotkeys[11],
            ShowHide = hotkeys[12],
        };
        var engine = ChosenEngine;
        if (engine != AnswerEngine.ChatPage)
        {
            _typedApiKeys[engine] = ApiKeyBox.Password.Trim();
        }
        foreach (var (api, typed) in _typedApiKeys)
        {
            if (typed.Length == 0)
            {
                continue;
            }
            if (api == AnswerEngine.DeepSeek) _settings.DeepSeekKeyProtected = ProtectedText.Protect(typed);
            else _settings.OpenAiKeyProtected = ProtectedText.Protect(typed);
        }
        if (engine != AnswerEngine.ChatPage && ApiModelBox.SelectedItem is string model)
        {
            if (engine == AnswerEngine.DeepSeek) _settings.DeepSeekModel = model;
            else _settings.OpenAiModel = model;
        }
        _settings.AnswerEngine = engine;
        _settings.InterviewType = InterviewTypeBox.SelectedIndex >= 0 ? InterviewStyles.All[InterviewTypeBox.SelectedIndex] : _settings.InterviewType;
        _settings.AnswerLength = LengthShort.IsChecked == true ? AnswerLength.Short
            : LengthDetailed.IsChecked == true ? AnswerLength.Detailed : AnswerLength.Normal;
        _settings.HotkeyApps = HotkeyAppsBox.Text.Trim();
        _settings.CommonHotkeysEverywhere = HotkeysEverywhereToggle.IsChecked == true;
        _settings.SpeakAnswers = SpeakToggle.IsChecked == true;
        _settings.VoiceSkipsCaptions = SkipCaptionsToggle.IsChecked == true;
        _settings.VoiceRate = RateSlider.Value;
        _settings.VoiceId = (VoiceBox.SelectedItem as VoiceChoice)?.Id ?? _settings.VoiceId;
        _settings.VoiceService = GoogleChosen ? VoiceService.Google : VoiceService.Windows;
        _settings.GoogleVoice = (GoogleVoiceBox.SelectedItem as VoiceChoice)?.Id ?? _settings.GoogleVoice;
        if (GoogleKeyBox.Password.Trim().Length > 0)
        {
            _settings.GoogleKeyProtected = ProtectedText.Protect(GoogleKeyBox.Password.Trim());
        }
        _settings.VoiceDeviceId = (DeviceBox.SelectedItem as VoiceChoice)?.Id ?? _settings.VoiceDeviceId;

        ChosenAutoSend = auto;
        ChosenSubmitAutomatically = auto || SendModeSubmit.IsChecked == true;
        ChosenOverlay = StyleOverlay.IsChecked == true;
        ChosenCaptionDock = _docks.Where(d => d.Button.IsChecked == true).Select(d => (CaptionDock?)d.Dock).FirstOrDefault()
            ?? CaptionDock.Bottom;
        ChosenTheme = ThemeLight.IsChecked == true ? AppTheme.Light : ThemeSystem.IsChecked == true ? AppTheme.System : AppTheme.Dark;
        ChosenAlwaysOnTop = TopmostToggle.IsChecked == true;
        ChosenHideFromCapture = HideFromCaptureToggle.IsChecked == true;
        ChosenHideLiveCaptions = HideLcToggle.IsChecked == true;
        DialogResult = true;
    }

    void ShowProblem(RadioButton tab, Control? field, string message)
    {
        tab.IsChecked = true;
        MessageBox.Show(this, message, Title);
        field?.Focus();
    }

    void OnResetPromptClick(object sender, RoutedEventArgs e) => CallPromptBox.Text = AppSettings.DefaultCallPrompt;

    /// <summary>Fills the role from a JobStrike application; nothing is kept until Save.</summary>
    void OnLoadFromJobStrikeClick(object sender, RoutedEventArgs e)
    {
        var dialog = new JobStrikeWindow(_settings, profileIsEmpty: ProfileBox.Text.Trim().Length == 0) { Owner = this };
        if (dialog.ShowDialog() != true || dialog.Result is not { } loaded)
        {
            return;
        }
        // A box is only replaced when JobStrike has something for it; otherwise what is there stays.
        var application = loaded.Application;
        var kept = new List<string>();
        if (application.Company.Length > 0) CompanyBox.Text = application.Company; else kept.Add("company");
        string description = application.JobDescriptionText();
        if (description.Length > 0) JobDescriptionBox.Text = description; else kept.Add("job description");
        if (loaded.Resume.Length > 0)
        {
            ResumeBox.Text = loaded.Resume;
            ResumeHint.Text = $"Loaded {loaded.ResumeFileName} from JobStrike ({CaptionTracker.CountWords(loaded.Resume)} words). Check the text and edit anything that came out wrong.";
        }
        if (dialog.ReplaceProfile && loaded.Profile.Length > 0)
        {
            ProfileBox.Text = loaded.Profile;
        }

        JobStrikeNoteText.Text = $"Loaded from JobStrike: {(application.Company.Length > 0 ? application.Company : "(no company)")}"
            + (application.JobTitle.Length > 0 ? $" · {application.JobTitle}" : "")
            + (application.CandidateName.Length > 0 ? $" ({application.CandidateName})" : "") + ". "
            // An empty resume always comes with the reason (no file, download failed, unreadable file).
            + (loaded.ResumeProblem != null ? loaded.ResumeProblem + " The resume box was left as it was. " : "")
            + (kept.Count > 0 ? $"JobStrike has no {string.Join(" or ", kept)} for it, so {(kept.Count == 1 ? "that box was" : "those boxes were")} left as {(kept.Count == 1 ? "it was" : "they were")}. " : "")
            + "Check the boxes below, then press Save.";
        JobStrikeNote.Visibility = Visibility.Visible;
    }

    void OnLoadResumeClick(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Filter = ResumeReader.FileDialogFilter };
        if (dialog.ShowDialog(this) == true)
        {
            LoadResume(dialog.FileName);
        }
    }

    void OnResumeDragOver(object sender, DragEventArgs e)
    {
        e.Effects = DroppedFile(e) != null ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    void OnResumeDrop(object sender, DragEventArgs e)
    {
        if (DroppedFile(e) is { } path)
        {
            e.Handled = true;
            LoadResume(path);
        }
    }

    static string? DroppedFile(DragEventArgs e) =>
        e.Data.GetData(DataFormats.FileDrop) is string[] { Length: 1 } files
        && (ResumeReader.IsSupported(files[0]) || files[0].EndsWith(".doc", StringComparison.OrdinalIgnoreCase))
            ? files[0]
            : null;

    void LoadResume(string path)
    {
        try
        {
            string text = ResumeReader.ReadText(path);
            ResumeBox.Text = text;
            ResumeHint.Text = $"Loaded {Path.GetFileName(path)} ({CaptionTracker.CountWords(text)} words). Check the text and edit anything that came out wrong.";
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            MessageBox.Show(this, $"Could not read {Path.GetFileName(path)}: {ex.Message}", Title);
        }
    }
}
