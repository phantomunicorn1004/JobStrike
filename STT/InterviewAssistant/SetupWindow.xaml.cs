using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Win32;

namespace InterviewAssistant;

/// <summary>
/// All settings in one place, in four tabs. Text, timing and hotkeys are written to the settings on
/// Save; the choices that change the running app (sending, view style, captions, theme, window) are
/// exposed as Chosen* properties so the main window can apply them live.
/// </summary>
public partial class SetupWindow : Window
{
    const string NoHotkey = "Not set";

    /// <summary>Combinations other programs commonly use; taking one disables it there while the app runs.</summary>
    static readonly Dictionary<string, string> CommonShortcuts = new()
    {
        ["Ctrl+X"] = "Cut", ["Ctrl+C"] = "Copy", ["Ctrl+V"] = "Paste", ["Ctrl+Z"] = "Undo", ["Ctrl+Y"] = "Redo",
        ["Ctrl+A"] = "Select all", ["Ctrl+S"] = "Save", ["Ctrl+F"] = "Find", ["Ctrl+P"] = "Print", ["Ctrl+N"] = "New",
        ["Ctrl+T"] = "New tab", ["Ctrl+W"] = "Close tab", ["Ctrl+R"] = "Reload", ["Ctrl+L"] = "the address bar",
        ["Ctrl+B"] = "Bold", ["Ctrl+I"] = "Italic", ["Ctrl+U"] = "Underline", ["Ctrl+E"] = "Search / camera in meeting apps",
        ["Ctrl+D"] = "Mute in Google Meet", ["Ctrl+Space"] = "Autocomplete and switching input languages",
        ["Ctrl+Enter"] = "Send in chat apps", ["Ctrl+="] = "Zoom in", ["Ctrl+-"] = "Zoom out", ["Ctrl+0"] = "Reset zoom",
        ["Ctrl+Shift+M"] = "Mute in Teams", ["Alt+A"] = "Mute in Zoom", ["Alt+V"] = "Camera in Zoom",
        ["Ctrl+Shift+O"] = "Camera in Teams", ["Ctrl+Shift+E"] = "Share screen in Teams",
    };

    readonly AppSettings _settings;
    readonly TextBox[] _hotkeyBoxes;
    readonly (RadioButton Button, CaptionDock Dock)[] _docks;

    public bool ChosenSubmitAutomatically { get; private set; }
    public bool ChosenAutoSend { get; private set; }
    public bool ChosenOverlay { get; private set; }
    public CaptionDock ChosenCaptionDock { get; private set; }
    public AppTheme ChosenTheme { get; private set; }
    public bool ChosenAlwaysOnTop { get; private set; }
    public bool ChosenHideLiveCaptions { get; private set; }

    public SetupWindow(AppSettings settings, string? tab = null)
    {
        InitializeComponent();
        _settings = settings;
        _hotkeyBoxes = [HotkeySendBox, HotkeyDiscardBox, HotkeySubmitBox, HotkeyClearBox, HotkeyAutoBox, HotkeyCompactBox,
            HotkeyScrollDownBox, HotkeyScrollUpBox, HotkeyLessSeeThroughBox, HotkeyMoreSeeThroughBox];
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
        (_docks.FirstOrDefault(d => d.Dock == settings.CompactCaptionDock).Button ?? DockTop).IsChecked = true;
        (settings.Theme switch { AppTheme.Light => ThemeLight, AppTheme.System => ThemeSystem, _ => ThemeDark }).IsChecked = true;
        TopmostToggle.IsChecked = settings.AlwaysOnTop;
        HideLcToggle.IsChecked = settings.HideLiveCaptionsWindow;

        // Hotkeys
        var keys = settings.Hotkeys;
        string[] current = [keys.Send, keys.Discard, keys.SubmitChatBox, keys.ClearChatBox, keys.ToggleAutoSend, keys.ToggleCompact,
            keys.ScrollAnswerDown, keys.ScrollAnswerUp, keys.LessSeeThrough, keys.MoreSeeThrough];
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
        UpdateHotkeyWarning();

        (tab switch { "sending" => TabSending, "display" => TabDisplay, "hotkeys" => TabHotkeys, _ => TabInterview }).IsChecked = true;
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
        PageHotkeys.Visibility = TabHotkeys.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        (PageTitle.Text, PageSubtitle.Text) =
            TabSending.IsChecked == true ? ("Sending", "What happens when you press Send.")
            : TabDisplay.IsChecked == true ? ("Display", "How the interview view looks, the theme, and the window.")
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
            // In the overlay the captions always sit above the answer.
            DockOptions.Visibility = StyleWindow.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
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
        var notes = _hotkeyBoxes.Select(b => b.Text).Where(CommonShortcuts.ContainsKey).Distinct()
            .Select(h => $"{h} is {CommonShortcuts[h]} in other programs.").ToList();
        HotkeyWarning.Visibility = notes.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        HotkeyWarningText.Text = notes.Count == 0 ? ""
            : string.Join(" ", notes) + " While Interview Assistant runs, "
              + (notes.Count == 1 ? "that key does the app's action instead, everywhere."
                 : "those keys do the app's actions instead, everywhere.")
              + " Combinations with Ctrl+Alt are usually free.";
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
        };

        ChosenAutoSend = auto;
        ChosenSubmitAutomatically = auto || SendModeSubmit.IsChecked == true;
        ChosenOverlay = StyleOverlay.IsChecked == true;
        ChosenCaptionDock = _docks.Where(d => d.Button.IsChecked == true).Select(d => (CaptionDock?)d.Dock).FirstOrDefault()
            ?? CaptionDock.Top;
        ChosenTheme = ThemeLight.IsChecked == true ? AppTheme.Light : ThemeSystem.IsChecked == true ? AppTheme.System : AppTheme.Dark;
        ChosenAlwaysOnTop = TopmostToggle.IsChecked == true;
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
        if (application.JobDescription.Length > 0)
        {
            var header = new List<string>();
            if (application.JobTitle.Length > 0) header.Add($"Job title: {application.JobTitle}");
            if (application.JobLink.Length > 0) header.Add($"Job link: {application.JobLink}");
            header.Add("");
            JobDescriptionBox.Text = string.Join(Environment.NewLine, header) + application.JobDescription;
        }
        else
        {
            kept.Add("job description");
        }
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
