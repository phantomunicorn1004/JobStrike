using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace InterviewAssistant;

/// <summary>
/// Two views share one window. Full view prepares the session (toolbar, chat page, captions,
/// next message). Interview view ("compact" in settings) is a small window with the caption strip
/// and the answer reader, driven by global hotkeys.
/// </summary>
public partial class MainWindow : Window
{
    static readonly WindowBounds DefaultCompactSize = new(double.NaN, double.NaN, 560, 760);
    static readonly WindowBounds DefaultNormalSize = new(double.NaN, double.NaN, 1440, 900);
    static readonly TimeSpan AnswerPollInterval = TimeSpan.FromMilliseconds(350);
    static readonly TimeSpan AnswerWaitLimit = TimeSpan.FromMinutes(2);
    // Live Captions writes words down about a second after they are heard.
    static readonly TimeSpan VoiceEchoDelay = TimeSpan.FromSeconds(2);
    const double HiddenPageWidth = 900;
    const double HiddenPageHeight = 1000;
    const double HiddenPageOffset = 30000;

    readonly AppSettings _settings = AppSettings.Load();
    readonly CaptionTracker _tracker = new();
    readonly LiveCaptionsReader _reader = new();
    readonly LiveCaptionsWindowMover _lcMover = new();
    readonly DispatcherTimer _tick;
    readonly DispatcherTimer _answerTimer;
    readonly Dictionary<ChatProvider, WebView2> _views;
    readonly Dictionary<ChatProvider, Task<ChatBridge>> _bridges = [];
    readonly ContextMenu _mainMenu = new();
    readonly List<string> _renderedAnswerKeys = [];
    Task<CoreWebView2Environment>? _environment;
    GlobalHotkeys? _hotkeys;
    DateTime _lastCaptionChange = DateTime.UtcNow;
    DateTime _autoSendBlockedUntil = DateTime.MinValue;
    // The interview view's status line shows the latest status message briefly (errors longer, in red).
    DateTime _compactStatusUntil = DateTime.MinValue;
    bool _compactStatusIsError;
    /// <summary>Names of the hotkeys Windows accepted (see HotkeyActions).</summary>
    readonly HashSet<string> _activeHotkeys = [];
    readonly CaptionList _captionList;
    readonly AnswerSpeaker _speaker;
    // The voice reading the answer is captioned too when it plays on the default speaker; those
    // words are skipped (VoiceEchoActive) and dropped once it has been quiet for VoiceEchoDelay.
    DateTime _voiceStartedAt = DateTime.MinValue;
    DateTime _voiceEchoUntil = DateTime.MinValue;
    bool _voiceHeardByCaptions;
    bool _voiceEchoPending;
    // Set when read-aloud is switched on: the answer already on the page is not read.
    bool _speechSkipCurrent;
    bool _captionsConnected;
    bool _syncingPane;
    bool _followCaptions = true;
    DefinitionBase? _captionDefinition;
    Window? _floatingWindow;
    OverlayWindow? _overlay;
    CaptionDock? _lastDocked;
    string? _answerId;
    int _answerCount = -1;
    bool _answerPolling;
    bool _awaitingAnswer;
    bool _answerTimedOut;
    string? _awaitingAfterId;
    DateTime _awaitingSince;
    int _answerLength;
    DateTime _answerGrewAt = DateTime.MinValue;
    bool _loadingBarOn;
    TranslateTransform? _loadingSweep;
    string? _lastSentQuestion;
    bool _closingApp;
    bool _startingNewChat;
    bool _initializing = true;

    public MainWindow()
    {
        InitializeComponent();
        _captionList = new CaptionList(CaptionStack);
        _speaker = new AnswerSpeaker();
        _speaker.SpeakingChanged += OnSpeakingChanged;
        _speaker.Problem += message => SetStatus(message, error: true);
        _views = new()
        {
            [ChatProvider.ChatGpt] = ChatGptView,
            [ChatProvider.DeepSeek] = DeepSeekView,
        };

        Topmost = _settings.AlwaysOnTop;
        CaptionPanel.ContextMenu = _mainMenu;
        CaptionPanel.ContextMenuOpening += (_, _) => FillMainMenu();
        ReaderPanel.ContextMenu = _mainMenu;
        ReaderPanel.ContextMenuOpening += (_, _) => FillMainMenu();
        AnswerBox.Document.FontFamily = (FontFamily)FindResource("UiFont");
        SourceInitialized += (_, _) => NativeMethods.ApplyWindowChrome(this);
        (_settings.Provider == ChatProvider.DeepSeek ? DeepSeekTab : ChatGptTab).IsChecked = true;
        ApplyAnswerWidth();
        ApplyLayout(_settings.CompactMode);
        if (!OverlayActive)
        {
            ApplyBounds(_settings.CompactMode ? _settings.CompactBounds ?? DefaultCompactSize : _settings.NormalBounds);
        }
        UpdateModeText();
        ThemeManager.Changed += OnThemeChanged;
        StateChanged += OnMainWindowStateChanged;
        _initializing = false;

        foreach (var view in _views.Values)
        {
            view.ZoomFactorChanged += OnZoomFactorChanged;
        }

        _reader.TextChanged += text => Dispatcher.BeginInvoke(() => OnCaptionsChanged(text));
        _reader.StateChanged += state => Dispatcher.BeginInvoke(() => OnSourceStateChanged(state));

        _tick = new DispatcherTimer(TimeSpan.FromMilliseconds(100), DispatcherPriority.Normal, OnTick, Dispatcher);
        _answerTimer = new DispatcherTimer(AnswerPollInterval, DispatcherPriority.Background, OnAnswerTick, Dispatcher);
    }

    async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _hotkeys = new GlobalHotkeys(new WindowInteropHelper(this).Handle);
        var failed = RegisterHotkeys();

#if UI_PREVIEW
        // Design preview build (dotnet build -p:DefineConstants=UI_PREVIEW): sample captions instead
        // of Live Captions, which is neither opened nor read.
        OnSourceStateChanged(CaptionSourceState.Connected);
        OnCaptionsChanged("Thanks for joining today. Let's start with your background.\nCould you walk me through a system you designed that had to scale quickly?");
        _tracker.DiscardPending();
        OnCaptionsChanged("Thanks for joining today. Let's start with your background.\nCould you walk me through a system you designed that had to scale quickly?\nAnd what would you do differently if you built it again today");
        if (Environment.GetEnvironmentVariable("IA_PREVIEW_POPUP") == "1")
        {
            // Selects the first words of the answer (once one is shown) and opens the Listen pop-up.
            var popupTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            popupTimer.Tick += (_, _) =>
            {
                var start = AnswerBox.Document.ContentStart.GetInsertionPosition(LogicalDirection.Forward);
                var end = start.GetPositionAtOffset(30);
                if (end == null || AnswerBox.Document.Blocks.Count == 0)
                {
                    return;
                }
                popupTimer.Stop();
                AnswerBox.Focus();
                AnswerBox.Selection.Select(start, end);
                ShowSelectionPopup(new Point(140, 40));
            };
            popupTimer.Start();
        }
        if (Environment.GetEnvironmentVariable("IA_PREVIEW_STRESS") == "1")
        {
            // Replays a long interview through a Live Captions-sized window (about 3,000 characters
            // that keeps dropping its oldest paragraph) and logs how long each update takes on screen.
            var words = "so one of the things we deal with in any client situation is stakeholders who are not as familiar with the technology".Split(' ');
            var window = new System.Text.StringBuilder(_tracker.Transcript);
            var timings = new List<double>();
            var codeTimes = new List<double>();
            int steps = int.TryParse(Environment.GetEnvironmentVariable("IA_STRESS_STEPS"), out int n) ? n : 20000;
            for (int step = 0; step < steps; step++)
            {
                window.Append(' ').Append(words[step % words.Length]).Append(step % 23 == 22 ? ".\n" : "");
                if (window.Length > 3000)
                {
                    string current = window.ToString();
                    window.Remove(0, current.IndexOf('\n', current.Length - 3000) + 1);
                }
                long t0 = System.Diagnostics.Stopwatch.GetTimestamp();
                OnCaptionsChanged(window.ToString());
                if (step % 10 == 0) _tracker.DiscardPending();
                codeTimes.Add(System.Diagnostics.Stopwatch.GetElapsedTime(t0).TotalMilliseconds);
                UpdateLayout();
                timings.Add(System.Diagnostics.Stopwatch.GetElapsedTime(t0).TotalMilliseconds);
                if (step % 300 == 0) await Dispatcher.Yield();
            }
            var last = timings.Skip(timings.Count - 300).ToList();
            Log.Write($"Caption stress: {_tracker.Transcript.Length:N0} chars, {_captionList.Count} cards; "
                + $"last 300 updates avg {last.Average():0.00} ms, max {last.Max():0.0} ms (code alone {codeTimes.Skip(codeTimes.Count - 300).Average():0.00} ms)");
        }
#else
        if (!LiveCaptionsReader.IsWindowOpen())
        {
            TryLaunchLiveCaptions();
        }
        _reader.Start();
#endif
        _tick.Start();
        _answerTimer.Start();
        UpdateListenButton();
        await ApplyVoiceSettingsAsync();

        SetStatus(failed.Count == 0
            ? "Ready. Sign in to the chat, fill in Settings, then “New chat + call prompt”."
            : $"Hotkeys already used by another app: {string.Join(", ", failed)}. Change them in Settings → Hotkeys.",
            error: failed.Count > 0);

        await ShowProviderAsync(_settings.Provider);

        string? message = CommandLineMessage();
        if (message != null)
        {
            await SendTextAsync(message, "command line");
        }
    }

    void OnClosing(object? sender, CancelEventArgs e)
    {
        _tick.Stop();
        _answerTimer.Stop();
        _closingApp = true;
        SaveForExit();
        _overlay?.Close(); // not owned by this window, so it would otherwise keep the app alive
        _hotkeys?.Dispose();
        _reader.Dispose();
        _speaker.Dispose();
    }

    /// <summary>
    /// Saves sizes and positions and puts Live Captions back on screen. Also called when Windows
    /// shuts down or logs off, when Closing is not raised.
    /// </summary>
    public void SaveForExit()
    {
        SaveCaptionSize();
        SaveBounds();
        if (_overlay is { IsVisible: true })
        {
            _overlay.SaveState();
        }
        _settings.Save();
        _lcMover.Restore();
    }

    static string? CommandLineMessage()
    {
        string[] args = Environment.GetCommandLineArgs();
        int i = Array.IndexOf(args, "--send");
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    // ---------------------------------------------------------------- hotkeys

    IEnumerable<(string Name, string Combo, Action Action)> HotkeyActions()
    {
        var keys = _settings.Hotkeys;
        yield return ("Send", keys.Send, () => _ = SendPendingAsync());
        yield return ("Discard", keys.Discard, DiscardPending);
        yield return ("Submit", keys.SubmitChatBox, () => _ = SubmitChatBoxAsync());
        yield return ("Clear chat box", keys.ClearChatBox, () => _ = ClearChatBoxAsync());
        yield return ("Scroll answer down", keys.ScrollAnswerDown, () => ScrollAnswer(down: true));
        yield return ("Scroll answer up", keys.ScrollAnswerUp, () => ScrollAnswer(down: false));
        yield return ("Auto-send", keys.ToggleAutoSend, () => SetAutoSend(!_settings.AutoSend));
        yield return ("Interview view", keys.ToggleCompact, ToggleCompact);
        yield return ("Overlay more solid", keys.LessSeeThrough, () => ChangeSeeThrough(-0.1));
        yield return ("Overlay more see-through", keys.MoreSeeThrough, () => ChangeSeeThrough(+0.1));
        yield return ("Automatic reading", keys.ToggleVoice, () => SetSpeakAnswers(!_settings.SpeakAnswers));
        yield return ("Listen / stop", keys.StopVoice, () => _ = ListenAsync());
    }

    /// <summary>Only the overlay can be see-through; the normal window cannot show what is behind it.</summary>
    void ChangeSeeThrough(double delta)
    {
        if (OverlayActive && _overlay != null)
        {
            _overlay.ChangeTransparency(delta);
        }
        else
        {
            SetStatus("See-through works in the overlay: Settings ▸ Display ▸ Overlay, then Interview view.");
        }
    }

    /// <summary>(Re)registers every configured hotkey. Returns the combinations another app already owns.</summary>
    List<string> RegisterHotkeys()
    {
        var failed = new List<string>();
        if (_hotkeys == null)
        {
            return failed;
        }
        _hotkeys.UnregisterAll();
        _hotkeys.SetScope(_settings.HotkeyApps);
        _activeHotkeys.Clear();
        var all = new List<string>();
        foreach (var (name, combo, action) in HotkeyActions())
        {
            if (!Hotkey.TryParse(combo, out var hotkey))
            {
                continue;
            }
            // Switching views brings a window to the front, which only a real Windows hotkey may do.
            // Everyday shortcuts (Ctrl+X, Ctrl+Space, …) only act as hotkeys in the meeting and in this
            // app, so they keep their normal job everywhere else.
            bool scoped = hotkey.IsCommonShortcut && !_settings.CommonHotkeysEverywhere;
            if (_hotkeys.Register(hotkey, action, activates: combo == _settings.Hotkeys.ToggleCompact, scoped))
            {
                all.Add($"{name}: {hotkey}");
                _activeHotkeys.Add(name);
            }
            else
            {
                failed.Add(hotkey.ToString());
            }
        }
        // Only hotkeys that actually work (set, and not taken by another app); the full list is in the tooltip.
        var hints = new[] { ("Send", _settings.Hotkeys.Send), ("Submit", _settings.Hotkeys.SubmitChatBox) }
            .Where(h => _activeHotkeys.Contains(h.Item1)).Select(h => $"{h.Item1} {HotkeyTip(h.Item2)}").ToList();
        HotkeyHint.Text = all.Count > 0 ? string.Join("  ·  ", hints.Append("all hotkeys…"))
            : failed.Count > 0 ? "Hotkeys taken by another app · Settings ▸ Hotkeys"
            : "No hotkeys set · Settings ▸ Hotkeys";
        HotkeyHint.ToolTip = all.Count == 0 ? null : string.Join(Environment.NewLine, all);
        SendNowButton.ToolTip = HotkeyTip(_settings.Hotkeys.Send);
        DiscardButton.ToolTip = HotkeyTip(_settings.Hotkeys.Discard);
        ClearChatButton.ToolTip = HotkeyTip(_settings.Hotkeys.ClearChatBox);
        SubmitChatButton.ToolTip = "Press Enter in the chat · " + HotkeyTip(_settings.Hotkeys.SubmitChatBox);
        UpdateReaderPlaceholder();
        UpdateListenButton();
        return failed;
    }

    static string HotkeyTip(string combo) => Hotkey.TryParse(combo, out var hotkey) ? hotkey.ToString() : "(no hotkey)";

    // Set only on change: these run on every 100 ms tick and should not re-lay out the text.
    static void SetText(TextBlock block, string text)
    {
        if (block.Text != text)
        {
            block.Text = text;
        }
    }

    static void SetText(Run run, string text)
    {
        if (run.Text != text)
        {
            run.Text = text;
        }
    }

    // ---------------------------------------------------------------- captions

    void OnCaptionsChanged(string text)
    {
        _lastCaptionChange = DateTime.UtcNow;
        if (_tracker.Update(text))
        {
            RenderCaptions();
        }
    }

    void OnSourceStateChanged(CaptionSourceState state)
    {
        bool connected = state == CaptionSourceState.Connected;
        _captionsConnected = connected;
        string brush = connected ? "Success" : "Danger";
        SourceDot.SetResourceReference(System.Windows.Shapes.Shape.FillProperty, brush);
        CompactDot.SetResourceReference(System.Windows.Shapes.Shape.FillProperty, brush);
        _overlay?.SetCaptionsConnected(connected);
        CompactDot.ToolTip = connected ? "Live Captions connected" : "Live Captions is not running";
        SourceText.Text = connected ? "Connected" : "Not running";
        StartLcButton.Visibility = connected ? Visibility.Collapsed : Visibility.Visible;
        if (connected && _settings.HideLiveCaptionsWindow)
        {
            _lcMover.Hide(_reader.WindowHandle);
        }
    }

    /// <summary>
    /// Shows the transcript as one card per paragraph. CaptionList only redraws cards that changed,
    /// so a long interview stays as quick as a short one (redrawing the whole history on every
    /// change kept the window busy and slowed everything else down, New chat included). The view
    /// follows new text unless the user has scrolled up to read something.
    /// </summary>
    void RenderCaptions()
    {
        _captionList.Render(_tracker.Transcript, _tracker.VisibleFrom, _tracker.SentUpTo, _settings.CompactMode);
        CaptionEmpty.Visibility = _captionList.Count == 0 && !_settings.CompactMode ? Visibility.Visible : Visibility.Collapsed;
        if (_followCaptions)
        {
            CaptionScroll.ScrollToEnd();
        }

        if (!_draftEdited)
        {
            ShowCaptionDraft();
        }
    }

    // ---------------------------------------------------------------- message box

    // The message box (full view and interview view show the same text) holds the waiting captions
    // until the user types in it; from then on it is the user's own message, and new captions wait
    // for the message after it. Send sends what is in the box.
    //
    // While the user is not typing, the boxes themselves stay empty and the waiting captions show in
    // a plain text block drawn over them: putting text into a TextBox costs ~40 ms, far too much to
    // repeat on every caption update. Clicking into a box moves the words into it for editing.
    bool _draftEdited;
    // How far the transcript went when the user started editing: those caption words were in the
    // box, so they count as sent with the message.
    int _draftCaptionMark;
    bool _settingDraft;

    TextBox[] DraftBoxes => [DraftBox, CompactDraftBox];

    (TextBox Box, TextBlock Preview, ScrollViewer Scroll, string Placeholder)[] Drafts =>
    [
        (DraftBox, DraftPreview, DraftPreviewScroll, "Waiting for the interviewer… or type your own message"),
        (CompactDraftBox, CompactDraftPreview, CompactDraftPreviewScroll, "Type a message, or wait for the interviewer…"),
    ];

    /// <summary>The message Send sends: the user's text, or else the waiting captions.</summary>
    string DraftText => _draftEdited ? DraftBox.Text.Trim() : _tracker.Pending;

    /// <summary>Shows the waiting captions in the message box (called on every caption update).</summary>
    void ShowCaptionDraft()
    {
        string pending = _tracker.Pending;
        foreach (var (box, _, _, _) in Drafts)
        {
            if (box.IsKeyboardFocused)
            {
                SetBoxText(box, pending); // clicked into but not typed in yet: the words are there to edit
            }
        }
        UpdateDraftPreviews();
    }

    void SetBoxText(TextBox box, string text)
    {
        if (box.Text == text)
        {
            return;
        }
        _settingDraft = true;
        box.Text = text;
        _settingDraft = false;
        if (box.IsKeyboardFocused)
        {
            box.CaretIndex = text.Length; // typing continues the text instead of starting before it
            box.ScrollToEnd();
        }
    }

    /// <summary>The text drawn over an empty box: the waiting captions, or what can be done there.</summary>
    void UpdateDraftPreviews()
    {
        string pending = _draftEdited ? "" : _tracker.Pending;
        foreach (var (box, preview, scroll, placeholder) in Drafts)
        {
            bool show = box.Text.Length == 0;
            scroll.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
            if (!show)
            {
                continue;
            }
            string text = pending.Length > 0 ? pending : placeholder;
            if (preview.Text != text)
            {
                preview.Text = text;
                preview.SetResourceReference(TextBlock.ForegroundProperty, pending.Length > 0 ? "Text" : "Faint");
                scroll.ScrollToEnd(); // the newest words
            }
        }
    }

    void OnDraftFocused(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (!_draftEdited)
        {
            SetBoxText((TextBox)sender, _tracker.Pending);
            UpdateDraftPreviews();
        }
    }

    void OnDraftUnfocused(object sender, KeyboardFocusChangedEventArgs e)
    {
        if (!_draftEdited)
        {
            SetBoxText((TextBox)sender, ""); // back to the light preview
            UpdateDraftPreviews();
        }
    }

    void OnDraftChanged(object sender, TextChangedEventArgs e)
    {
        if (_settingDraft)
        {
            return;
        }
        if (!_draftEdited)
        {
            _draftEdited = true;
            _draftCaptionMark = _tracker.Transcript.Length;
        }
        var edited = (TextBox)sender;
        foreach (var box in DraftBoxes)
        {
            if (box != edited)
            {
                SetBoxText(box, edited.Text);
            }
        }
        UpdateDraftPreviews();
    }

    /// <summary>Makes <paramref name="text"/> the user's own message (e.g. the words kept while the voice speaks).</summary>
    void StartEditedDraft(string text)
    {
        _draftEdited = true;
        _draftCaptionMark = _tracker.Transcript.Length;
        foreach (var box in DraftBoxes)
        {
            SetBoxText(box, text);
        }
        UpdateDraftPreviews();
    }

    /// <summary>Enter sends, Shift+Enter starts a new line, Esc goes back to the captions.</summary>
    void OnDraftKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.None)
        {
            e.Handled = true;
            _ = SendPendingAsync();
        }
        else if (e.Key == Key.Escape && _draftEdited)
        {
            e.Handled = true;
            ResetDraft();
            SetStatus("The message box shows the interviewer's words again.");
        }
    }

    /// <summary>Back to showing the waiting captions.</summary>
    void ResetDraft()
    {
        _draftEdited = false;
        foreach (var box in DraftBoxes)
        {
            SetBoxText(box, box.IsKeyboardFocused ? _tracker.Pending : "");
        }
        UpdateDraftPreviews();
    }

    void OnHideMessageBoxClick(object sender, RoutedEventArgs e) => SetCompactMessageBox(false);

    void OnShowMessageBoxClick(object sender, RoutedEventArgs e) => SetCompactMessageBox(true);

    void SetCompactMessageBox(bool show)
    {
        _settings.CompactMessageBox = show;
        _settings.Save();
        ApplyCompactMessageBox();
        if (show)
        {
            CompactDraftBox.Focus();
            CompactDraftBox.CaretIndex = CompactDraftBox.Text.Length;
        }
    }

    /// <summary>Hidden, the box leaves its space to the captions and a keyboard button in the status line brings it back.</summary>
    void ApplyCompactMessageBox()
    {
        bool show = _settings.CompactMessageBox;
        CompactComposer.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        ShowMessageBoxButton.Visibility = show ? Visibility.Collapsed : Visibility.Visible;
    }

    void OnClearCaptionsClick(object sender, RoutedEventArgs e)
    {
        ClearCaptions();
        SetStatus("Cleared the caption history.");
    }

    /// <summary>Empties the caption panel and forgets the old transcript (a new interview).</summary>
    void ClearCaptions()
    {
        _tracker.ClearHistory();
        if (_draftEdited)
        {
            _draftCaptionMark = _tracker.Transcript.Length; // the old positions no longer exist
        }
        _captionList.Clear(forgetTimes: true);
        RenderCaptions();
        FollowLatestCaptions();
    }

    bool IsCaptionScrollAtBottom() => CaptionScroll.VerticalOffset >= CaptionScroll.ScrollableHeight - 4;

    /// <summary>
    /// Follows the newest captions until the user scrolls up; a change of content or panel size
    /// (new text, switching views, dragging the splitter) keeps the view on the newest line.
    /// </summary>
    void OnCaptionScrollChanged(object sender, ScrollChangedEventArgs e)
    {
        if (e.ExtentHeightChange == 0 && e.ViewportHeightChange == 0)
        {
            _followCaptions = IsCaptionScrollAtBottom();
        }
        else if (_followCaptions)
        {
            CaptionScroll.ScrollToEnd();
        }
        JumpLatestButton.Visibility = _followCaptions ? Visibility.Collapsed : Visibility.Visible;
    }

    void OnJumpLatestClick(object sender, RoutedEventArgs e)
    {
        _followCaptions = true;
        CaptionScroll.ScrollToEnd();
    }

    void FollowLatestCaptions()
    {
        _followCaptions = true;
        Dispatcher.BeginInvoke(CaptionScroll.ScrollToEnd, DispatcherPriority.Loaded);
    }

    void OnTick(object? sender, EventArgs e)
    {
        bool echo = VoiceEchoActive;
        if (_voiceEchoPending && !echo)
        {
            _voiceEchoPending = false;
            if (_voiceHeardByCaptions && _settings.VoiceSkipsCaptions && _lastCaptionChange > _voiceStartedAt
                && _tracker.PendingWordCount > 0)
            {
                _tracker.DiscardPending();
                RenderCaptions();
                SetStatus("Skipped the captions of the voice reading the answer.");
            }
        }

        int words = _draftEdited ? CaptionTracker.CountWords(DraftText) : _tracker.PendingWordCount;
        double pause = Math.Max(0.3, _settings.PauseSeconds);
        double silent = (DateTime.UtcNow - _lastCaptionChange).TotalSeconds;
        bool auto = _settings.AutoSend;

        string wordsText = words == 1 ? "1 word" : $"{words} words";
        if (_draftEdited)
        {
            // Automatic sending waits while the user writes their own message.
            SetText(PendingInfo, "  ·  your own text");
            PauseProgress.Value = 0;
        }
        else if (words == 0)
        {
            SetText(PendingInfo, "");
            PauseProgress.Value = 0;
        }
        else
        {
            SetText(PendingInfo, !auto ? $"  ·  {wordsText}"
                : words < _settings.MinWords ? $"  ·  {wordsText}, waiting for {_settings.MinWords}+"
                : $"  ·  {wordsText}, sends after a {pause:0.#}s pause");
            PauseProgress.Value = auto ? Math.Min(1, silent / pause) : 0;
        }
        PauseProgress.Visibility = auto ? Visibility.Visible : Visibility.Collapsed;

        // The Send key is shown as a key chip while there is something to send by hand.
        bool sendKey = (!auto || _draftEdited) && words > 0 && _activeHotkeys.Contains("Send");
        string sendText = sendKey ? HotkeyTip(_settings.Hotkeys.Send) : "";
        SetText(SendKeyText, sendText);
        SetText(CompactKeyText, sendText);
        SendKeyChip.Visibility = sendKey ? Visibility.Visible : Visibility.Collapsed;

        bool showStatus = DateTime.UtcNow < _compactStatusUntil;
        SetText(CompactInfo, showStatus ? StatusText.Text
            : !_captionsConnected ? "Live Captions is not running · Menu ▸ Start Live Captions"
            : _draftEdited ? "Your message · Enter sends · Esc = captions"
            : echo ? "Reading the answer aloud · its captions are skipped"
            : words == 0 ? "Listening…"
            : auto ? $"{wordsText} waiting · sends when the interviewer pauses"
            : $"{wordsText} waiting");
        CompactKeyChip.Visibility = sendKey && !showStatus && _captionsConnected ? Visibility.Visible : Visibility.Collapsed;
        CompactInfo.ToolTip = showStatus ? StatusText.Text : ModeSummary(shortForm: false);
        CompactInfo.Foreground = (Brush)FindResource(showStatus ? (_compactStatusIsError ? "Danger" : "Text")
            : !_captionsConnected ? "Danger" : "Muted");

        if (auto && !echo && !_draftEdited && words >= _settings.MinWords && silent >= pause && DateTime.UtcNow >= _autoSendBlockedUntil)
        {
            _ = SendPendingAsync();
        }
    }

    async Task SendPendingAsync()
    {
        if (_startingNewChat)
        {
            // The call prompt goes first; the words stay waiting for the next Send.
            SetStatus("The new chat is still being set up. Send again when the call prompt is in.");
            return;
        }
        if (_draftEdited)
        {
            await SendDraftAsync();
            return;
        }
        if (VoiceEchoActive)
        {
            // What is waiting is (mostly) the voice itself; the interviewer is probably talking again.
            _speaker.Stop();
            _tracker.DiscardPending();
            _voiceEchoUntil = DateTime.UtcNow + VoiceEchoDelay;
            _voiceEchoPending = true;
            RenderCaptions();
            SetStatus("Stopped the voice. Press Send again for what the interviewer says next.");
            return;
        }
        var (text, previousMarker) = _tracker.TakePending();
        RenderCaptions();
        if (text.Length == 0)
        {
            SetStatus("Nothing to send yet.");
            return;
        }
        _lastSentQuestion = text;
        int take = _tracker.TakeCount;
        var result = await SendTextAsync(text, "interviewer", SendSubmits);
        if (!result.Success && !result.WasCancelled)
        {
            // Offer the words again only if none of them reached the chat box (otherwise they would
            // be sent twice) and no later Send or Discard has moved on since.
            if (!result.Delivered && _tracker.TakeCount == take)
            {
                _tracker.RestoreMarker(previousMarker);
            }
            _autoSendBlockedUntil = DateTime.UtcNow.AddSeconds(10);
            RenderCaptions();
        }
    }

    /// <summary>Sends the user's own (or edited) message from the message box.</summary>
    async Task SendDraftAsync()
    {
        if (_sendingDraft)
        {
            return; // Enter pressed twice: the message is already on its way
        }
        string text = DraftText;
        if (text.Length == 0)
        {
            SetStatus("Type a message first, or press Esc to show the interviewer's words again.");
            return;
        }
        int mark = _draftCaptionMark;
        _lastSentQuestion = text;
        _sendingDraft = true;
        try
        {
            var result = await SendTextAsync(text, "your", SendSubmits || ApiMode);
            if (result.Success || result.Delivered)
            {
                // The caption words that were in the box went out with it; later ones wait for the next message.
                _tracker.MarkSentUpTo(mark);
                ResetDraft();
                RenderCaptions();
            }
        }
        finally
        {
            _sendingDraft = false;
        }
    }

    bool _sendingDraft;

    void DiscardPending()
    {
        if (_draftEdited)
        {
            ResetDraft();
            SetStatus("Cleared your message; the box shows the interviewer's words again.");
            return;
        }
        _tracker.DiscardPending();
        RenderCaptions();
        SetStatus("Discarded the waiting caption text.");
    }

    // ---------------------------------------------------------------- chat

    async Task<SendResult> SendTextAsync(string text, string what, bool submit = true, bool replace = false)
    {
        if (ApiMode)
        {
            return SendToApi(text, what, submit);
        }
        var provider = _settings.Provider;
        string name = ChatBridge.DisplayName(provider);
        try
        {
            var bridge = await GetBridgeAsync(provider);
            SetStatus(submit
                ? $"Sending {what} message to {name}: “{Shorten(text)}”"
                : $"Putting {what} message in the {name} box: “{Shorten(text)}”");
            var result = await bridge.SendAsync(text, submit, replace);
            if (result.Success && submit)
            {
                BeginAwaitingAnswer(result.AnswerIdBefore);
            }
            if (result.Success)
            {
                SetStatus(submit
                    ? $"Sent to {name}: “{Shorten(text)}”"
                    : $"In the {name} box. Press Enter in the chat or {HotkeyTip(_settings.Hotkeys.SubmitChatBox)} to submit.");
            }
            else if (result.WasCancelled)
            {
                SetStatus("Message dropped because the chat box was cleared.");
            }
            else
            {
                SetStatus(result.Error!, error: true);
            }
            return result;
        }
        catch (Exception ex)
        {
            SetStatus($"Could not send to {name}: {ex.Message}", error: true);
            return SendResult.Fail(ex.Message);
        }
    }

    async Task SubmitChatBoxAsync()
    {
        if (ApiMode)
        {
            SetStatus("The chat box is not used with an AI API: Send sends the message box straight away.");
            return;
        }
        string name = ChatBridge.DisplayName(_settings.Provider);
        try
        {
            var bridge = await GetBridgeAsync(_settings.Provider);
            SetStatus($"Submitting the {name} chat box…");
            var result = await bridge.SubmitAsync();
            if (result.Success)
            {
                BeginAwaitingAnswer(result.AnswerIdBefore);
                SetStatus($"Submitted to {name}.");
            }
            else if (!result.WasCancelled)
            {
                SetStatus(result.Error!, error: true);
            }
        }
        catch (Exception ex)
        {
            SetStatus($"Could not submit: {ex.Message}", error: true);
        }
    }

    async Task ClearChatBoxAsync()
    {
        if (ApiMode)
        {
            ResetDraft();
            SetStatus("Cleared the message box.");
            return;
        }
        try
        {
            var bridge = await GetBridgeAsync(_settings.Provider);
            bool cleared = await bridge.ClearComposerAsync();
            SetStatus(cleared ? "Cleared the chat message box." : "Could not find the chat message box to clear.", error: !cleared);
        }
        catch (Exception ex)
        {
            SetStatus($"Could not clear the chat box: {ex.Message}", error: true);
        }
    }

    Task<ChatBridge> GetBridgeAsync(ChatProvider provider)
    {
        // A page that failed to start (e.g. browser profile locked) is tried again on the next use.
        if (!_bridges.TryGetValue(provider, out var task) || task.IsFaulted || task.IsCanceled)
        {
            task = CreateBridgeAsync(provider);
            _bridges[provider] = task;
        }
        return task;
    }

    async Task<ChatBridge> CreateBridgeAsync(ChatProvider provider)
    {
        if (_environment is { IsFaulted: true } or { IsCanceled: true })
        {
            _environment = null;
        }
        _environment ??= CoreWebView2Environment.CreateAsync(
            null, Path.Combine(AppSettings.DataFolder, "WebView2"));
        var environment = await _environment;
        var view = _views[provider];
        view.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 33, 33, 33);
        await view.EnsureCoreWebView2Async(environment);
        view.ZoomFactor = CurrentZoom;
        var core = view.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Profile.PreferredColorScheme = PageColorScheme;
        core.NewWindowRequested += OnNewWindowRequested;
        core.Navigate(ChatBridge.HomeUrl(provider).ToString());
        return new ChatBridge(core, provider);
    }

    /// <summary>Sign-in pages (Google, Microsoft, Apple) open in a popup that shares the login session.</summary>
    async void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        var deferral = e.GetDeferral();
        Window? popup = null;
        try
        {
            var popupView = new WebView2();
            popup = new Window
            {
                Title = "Interview Assistant",
                Width = e.WindowFeatures.HasSize ? Math.Max(480, e.WindowFeatures.Width) : 520,
                Height = e.WindowFeatures.HasSize ? Math.Max(560, e.WindowFeatures.Height) : 720,
                // While the overlay is up this window is minimized, and a popup owned by it would be hidden.
                Owner = OverlayActive && _overlay != null ? _overlay : this,
                Content = popupView,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
            };
            popup.Show();
            await popupView.EnsureCoreWebView2Async(await _environment!);
            var shown = popup;
            popupView.CoreWebView2.WindowCloseRequested += (_, _) => shown.Close();
            popupView.CoreWebView2.NewWindowRequested += OnNewWindowRequested;
            e.NewWindow = popupView.CoreWebView2;
        }
        catch (Exception ex)
        {
            Log.Write($"Sign-in popup failed: {ex}");
            popup?.Close();
            SetStatus("Could not open the sign-in window. Try again, or sign in with email and password.", error: true);
        }
        finally
        {
            deferral.Complete();
        }
    }

    async Task ShowProviderAsync(ChatProvider provider)
    {
        _answerId = null;
        _answerCount = -1;
        UpdateChatHost();
        try
        {
            await GetBridgeAsync(provider);
        }
        catch (Exception ex)
        {
            _bridges.Remove(provider);
            SetStatus($"Could not start the {ChatBridge.DisplayName(provider)} view: {ex.Message}", error: true);
        }
    }

    async void OnProviderChecked(object sender, RoutedEventArgs e)
    {
        if (_initializing)
        {
            return;
        }
        var provider = sender == DeepSeekTab ? ChatProvider.DeepSeek : ChatProvider.ChatGpt;
        _settings.Provider = provider;
        _settings.Save();
        await ShowProviderAsync(provider);
    }

    /// <summary>
    /// Opens a fresh chat and sends the call prompt once. A second press (double-click, hotkey,
    /// menu) while this is still running is ignored: otherwise the same call prompt would be
    /// typed into the new chat twice.
    /// </summary>
    async void OnNewChatClick(object sender, RoutedEventArgs e)
    {
        if (_startingNewChat)
        {
            return;
        }
        if (!HasInterviewDetails())
        {
            SetStatus("Add your profile and the job description in Settings first.", error: true);
            OpenSettings("interview");
            return;
        }

        var provider = _settings.Provider;
        string name = ChatBridge.DisplayName(provider);
        _startingNewChat = true;
        NewChatButton.IsEnabled = false;
        _speaker.Stop();
        // A new chat is a new interview: the old captions go, which also keeps the window light.
        _draftEdited = false;
        ClearCaptions();
        // Nothing from the old chat may be typed into the new one, and auto-send waits until the
        // call prompt has gone out.
        _autoSendBlockedUntil = DateTime.MaxValue;
        try
        {
            if (ApiMode)
            {
                StartApiConversation();
                return;
            }
            SetStatus($"Opening a new {name} chat…");
            try
            {
                var bridge = await GetBridgeAsync(provider);
                bridge.CancelPending();
                var core = _views[provider].CoreWebView2;
                // The page's document is enough: sending waits for the message box itself, which is
                // there long before every image and tracker has finished loading.
                var loaded = new TaskCompletionSource();
                void Done(object? s, CoreWebView2DOMContentLoadedEventArgs a) => loaded.TrySetResult();
                var started = DateTime.UtcNow;
                core.DOMContentLoaded += Done;
                core.Navigate(ChatBridge.HomeUrl(provider).ToString());
                await Task.WhenAny(loaded.Task, Task.Delay(TimeSpan.FromSeconds(20)));
                core.DOMContentLoaded -= Done;
                Log.Write($"New chat page loaded in {(DateTime.UtcNow - started).TotalSeconds:0.0}s");
            }
            catch (Exception ex)
            {
                SetStatus($"Could not open a new chat: {ex.Message}", error: true);
                return;
            }
            _tracker.DiscardPending();
            _lastSentQuestion = null;
            RenderCaptions();
            await SendCallPromptAsync();
        }
        finally
        {
            _autoSendBlockedUntil = DateTime.UtcNow;
            _startingNewChat = false;
            NewChatButton.IsEnabled = true;
        }
    }

    bool HasInterviewDetails() =>
        !string.IsNullOrWhiteSpace(_settings.Profile) || !string.IsNullOrWhiteSpace(_settings.JobDescription);

    async Task SendCallPromptAsync()
    {
        string prompt = ApiMode ? WithInterviewStyle(_settings.BuildCallPrompt()) : _settings.BuildCallPrompt();
        _lastSentQuestion = "Call prompt";
        SetStatus($"Typing the call prompt ({prompt.Length:N0} characters)…");
        // A new chat can come with a draft the page restored (e.g. part of an earlier attempt).
        await SendTextAsync(prompt, "call prompt", replace: true);
    }

    // ---------------------------------------------------------------- answer reader

    /// <summary>
    /// Interview view shows the answer reader, unless the chat page itself was chosen. The overlay
    /// always shows the reader: a see-through window cannot display the embedded browser.
    /// </summary>
    bool ReaderVisible => ApiMode || (_settings.CompactMode && (_settings.OverlayMode || !_settings.CompactShowsChatPage));

    void OnInterviewPaneChecked(object sender, RoutedEventArgs e)
    {
        if (!_syncingPane)
        {
            SetShowChatPage(sender == ViewChatTab);
        }
    }

    void SetShowChatPage(bool show)
    {
        _settings.CompactShowsChatPage = show;
        _settings.Save();
        SyncPaneSwitch();
        UpdateChatHost();
    }

    void SyncPaneSwitch()
    {
        _syncingPane = true;
        (_settings.CompactShowsChatPage ? ViewChatTab : ViewAnswerTab).IsChecked = true;
        _syncingPane = false;
    }

    bool OverlayActive => _settings.CompactMode && _settings.OverlayMode;

    /// <summary>
    /// Shows the chat page, or the answer reader in its place. WebView2 is a native window that
    /// always draws above WPF content, so while the reader is shown the page is shrunk to one pixel
    /// in the corner instead of hidden: a hidden page would stop rendering the streamed answer.
    /// </summary>
    void UpdateChatHost()
    {
        bool reader = ReaderVisible;
        ReaderPanel.Visibility = reader ? Visibility.Visible : Visibility.Collapsed;
        foreach (var (provider, view) in _views)
        {
            view.Visibility = provider == _settings.Provider ? Visibility.Visible : Visibility.Collapsed;
            // Kept at a normal page size but placed far outside the window, where Windows clips it
            // away. Shrinking it instead would make pages that only build the messages on screen
            // (DeepSeek's virtual list) leave the newest answer out.
            view.Width = reader ? HiddenPageWidth : double.NaN;
            view.Height = reader ? HiddenPageHeight : double.NaN;
            view.HorizontalAlignment = reader ? HorizontalAlignment.Left : HorizontalAlignment.Stretch;
            view.VerticalAlignment = reader ? VerticalAlignment.Top : VerticalAlignment.Stretch;
            view.Margin = reader ? new Thickness(-HiddenPageOffset, 0, 0, 0) : new Thickness(0);
        }
        if (reader)
        {
            _answerId = null;
            _answerCount = -1;
            UpdateReaderPlaceholder();
            OnAnswerTick(null, EventArgs.Empty);
        }
    }

    async void OnAnswerTick(object? sender, EventArgs e)
    {
        if (ApiMode)
        {
            return; // API answers are shown as they stream in, not read from a page
        }
        if ((!ReaderVisible && !_settings.SpeakAnswers && !_speaker.IsSpeaking && !_speaker.IsFollowing) || _answerPolling
            || !_bridges.TryGetValue(_settings.Provider, out var task) || !task.IsCompletedSuccessfully)
        {
            return;
        }
        _answerPolling = true;
        try
        {
            var snapshot = await task.Result.ReadAnswerAsync();
            if (snapshot != null && (ReaderVisible || _settings.SpeakAnswers || _speaker.IsSpeaking || _speaker.IsFollowing))
            {
                ApplyAnswer(snapshot);
            }
        }
        catch (Exception ex)
        {
            // Runs every 350 ms during the interview: log and carry on, never crash.
            Log.Write($"Answer reader: {ex}");
        }
        finally
        {
            _answerPolling = false;
        }
    }

    /// <summary>
    /// Updates the reader in place: blocks that did not change stay as they are, so the text does
    /// not jump while the answer streams in. A new answer starts again at the top.
    /// </summary>
    void ApplyAnswer(AnswerSnapshot snapshot)
    {
        var document = AnswerBox.Document;
        string? questionType = null;
        if (ApiMode)
        {
            var blocks = snapshot.Blocks.ToList();
            questionType = InterviewStyles.TakeQuestionType(blocks);
            if (blocks.Count != snapshot.Blocks.Count)
            {
                snapshot = snapshot with { Blocks = blocks };
            }
        }
        _lastAnswer = snapshot;
        bool wasAwaiting = _awaitingAnswer;
        // Pages that build only part of the conversation (DeepSeek) change how many messages exist
        // as they scroll, so the message's own id decides when it carries one; the count is a fallback.
        bool isNew = snapshot.MessageId.Length > 0
            ? snapshot.MessageId != _answerId
            : snapshot.MessageId != _answerId || snapshot.MessageCount != _answerCount;
        int length = snapshot.Blocks.Sum(b => b.Runs.Sum(r => r.Text.Length));
        bool firstLook = _answerId == null;
        if (questionType != null)
        {
            QuestionTypeText.Text = questionType;
            QuestionTypeChip.Visibility = Visibility.Visible;
        }
        else if (isNew && !firstLook)
        {
            QuestionTypeChip.Visibility = Visibility.Collapsed;
        }
        if (isNew)
        {
            SelectionPopup.IsOpen = false;
            document.Blocks.Clear();
            _renderedAnswerKeys.Clear();
            _answerId = snapshot.MessageId;
            _answerCount = snapshot.MessageCount;
            // An answer that was already there when the reader opened is not "being written".
            _answerLength = firstLook ? length : 0;
        }
        bool grew = length != _answerLength;
        if (grew)
        {
            _answerLength = length;
            _answerGrewAt = DateTime.UtcNow;
        }
        if (isNew || grew)
        {
            _answerTimedOut = false; // an answer is arriving after all
        }

        // The reply to what was just submitted has arrived once a different answer shows up with
        // text in it. If the previous answer was never seen (sent from full view), wait until the
        // page shows it writing or the text grows, so the old answer is not taken for the reply.
        bool replyArrived = snapshot.MessageId.Length > 0 && _awaitingAfterId != null
            ? snapshot.MessageId != _awaitingAfterId
            : snapshot.Generating || (grew && !firstLook) || (isNew && !firstLook);
        if (_awaitingAnswer && snapshot.Blocks.Count > 0 && replyArrived)
        {
            _awaitingAnswer = false;
        }
        if (_awaitingAnswer && DateTime.UtcNow - _awaitingSince > AnswerWaitLimit)
        {
            _awaitingAnswer = false;
            _answerTimedOut = true;
        }

        int same = 0;
        while (same < _renderedAnswerKeys.Count && same < snapshot.Blocks.Count
               && _renderedAnswerKeys[same] == snapshot.Blocks[same].Key)
        {
            same++;
        }
        while (document.Blocks.Count > same)
        {
            document.Blocks.Remove(document.Blocks.LastBlock);
        }
        _renderedAnswerKeys.RemoveRange(same, _renderedAnswerKeys.Count - same);
        for (int i = same; i < snapshot.Blocks.Count; i++)
        {
            document.Blocks.Add(AnswerRenderer.Render(snapshot.Blocks[i], _settings.AnswerFontSize, Application.Current.Resources,
                lead: i == 0 && snapshot.Blocks[i].Kind == "p"));
            _renderedAnswerKeys.Add(snapshot.Blocks[i].Key);
        }
        if (isNew)
        {
            AnswerBox.ScrollToHome();
        }

        bool hasAnswer = snapshot.Blocks.Count > 0;
        // Writing = the page shows its stop button, or the text grew a moment ago (DeepSeek's stop
        // button carries no label, and every page's text grows while it streams).
        bool writing = !_awaitingAnswer && hasAnswer
            && (snapshot.Generating || DateTime.UtcNow - _answerGrewAt < TimeSpan.FromSeconds(1.5));
        ShowAnswerState(hasAnswer, writing);

        // Read aloud: the reply to a question just sent, or a new answer that appears while
        // watching; never an answer that was already there. While waiting for the reply the page
        // still shows the old answer, or the reply's empty turn, so nothing is followed until the
        // reply has text (an empty turn followed early would stay muted).
        if (!_awaitingAnswer)
        {
            bool readIfNew = _settings.SpeakAnswers && (wasAwaiting || (isNew && !firstLook && !_speechSkipCurrent));
            _speechSkipCurrent = false;
            _speaker.Follow(AnswerKey(snapshot), SpeechText(snapshot),
                complete: hasAnswer && !writing && !snapshot.Generating, readIfNew);
        }

        // While waiting, the question just sent is the one that matters, not the old answer's.
        string? question = _awaitingAnswer ? _lastSentQuestion : snapshot.Question ?? _lastSentQuestion;
        QuestionText.Text = string.IsNullOrWhiteSpace(question) ? "" : "“" + CaptionTracker.CleanForSending(question) + "”";
        QuestionText.ToolTip = question;
        QuestionText.Visibility = string.IsNullOrWhiteSpace(question) ? Visibility.Collapsed : Visibility.Visible;
    }

    /// <summary>
    /// The answer header says exactly what is going on: thinking (sent, nothing back yet, with a
    /// seconds counter), writing (text still arriving), complete, or waiting for a question. The
    /// moving bar runs while thinking or writing, and the previous answer is faded while thinking
    /// so it is never mistaken for the new one.
    /// </summary>
    void ShowAnswerState(bool hasAnswer, bool writing)
    {
        FollowUpChips.Visibility = hasAnswer && !_awaitingAnswer && !writing ? Visibility.Visible : Visibility.Collapsed;
        string text, brush;
        if (_awaitingAnswer)
        {
            int seconds = (int)(DateTime.UtcNow - _awaitingSince).TotalSeconds;
            text = seconds < 1 ? "●  Thinking…" : $"●  Thinking… {seconds}s";
            brush = "Warning";
        }
        else if (writing)
        {
            text = "●  Writing…";
            brush = "Accent";
        }
        else if (_speaker.IsSpeaking)
        {
            text = "●  Reading aloud…";
            brush = "Accent";
        }
        else if (_answerTimedOut)
        {
            text = "No answer yet — check the chat page (Full view)";
            brush = "Danger";
        }
        else if (hasAnswer)
        {
            text = "✓  Ready";
            brush = "Success";
        }
        else
        {
            text = "Listening";
            brush = "Muted";
        }
        AnswerState.Text = text;
        AnswerState.SetResourceReference(TextBlock.ForegroundProperty, brush);
        ReaderEmptyPanel.Visibility = hasAnswer || _awaitingAnswer ? Visibility.Collapsed : Visibility.Visible;
        AnswerBox.Opacity = _awaitingAnswer ? 0.3 : 1;
        SetLoadingBar(_awaitingAnswer || writing);
    }

    /// <summary>
    /// Called after a message was really submitted: the next answer is on its way. The page's own
    /// latest answer from just before Enter is preferred over the reader's: the reader may already
    /// have picked up the reply by the time submitting is confirmed, or not be showing at all.
    /// </summary>
    void BeginAwaitingAnswer(string? answerIdBefore)
    {
        _speaker.Stop();
        _awaitingAnswer = true;
        _answerTimedOut = false;
        _awaitingAfterId = answerIdBefore ?? _answerId;
        _awaitingSince = DateTime.UtcNow;
        if (ReaderVisible)
        {
            ShowAnswerState(hasAnswer: _renderedAnswerKeys.Count > 0, writing: false);
            QuestionText.Text = string.IsNullOrWhiteSpace(_lastSentQuestion) ? "" : "“" + CaptionTracker.CleanForSending(_lastSentQuestion) + "”";
            QuestionText.Visibility = string.IsNullOrWhiteSpace(_lastSentQuestion) ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    /// <summary>A soft highlight sweeping across a thin bar under the answer header.</summary>
    void SetLoadingBar(bool on)
    {
        if (on == _loadingBarOn)
        {
            return;
        }
        _loadingBarOn = on;
        if (!on)
        {
            _loadingSweep?.BeginAnimation(TranslateTransform.XProperty, null);
            LoadingBar.Visibility = Visibility.Hidden;
            return;
        }
        var accent = ThemeManager.ColorOf("Accent");
        var clear = Color.FromArgb(0, accent.R, accent.G, accent.B);
        _loadingSweep = new TranslateTransform();
        LoadingBar.Background = new LinearGradientBrush(
            [new GradientStop(clear, 0.3), new GradientStop(accent, 0.5), new GradientStop(clear, 0.7)], 0)
        {
            RelativeTransform = _loadingSweep,
        };
        LoadingBar.Visibility = Visibility.Visible;
        _loadingSweep.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(-0.7, 0.7, TimeSpan.FromSeconds(1.2))
        {
            RepeatBehavior = RepeatBehavior.Forever,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
        });
    }

    void UpdateReaderPlaceholder()
    {
        var keys = _settings.Hotkeys;
        bool scrollKeys = Hotkey.TryParse(keys.ScrollAnswerDown, out var down) & Hotkey.TryParse(keys.ScrollAnswerUp, out var up);
        ReaderEmpty.Text =
            "The AI's answer appears here in large text. "
            + $"Send the interviewer's question with {HotkeyOr(keys.Send, "the menu ▸ Send")}"
            + (SendSubmits ? "." : $", then submit with {HotkeyOr(keys.SubmitChatBox, "the menu ▸ Submit chat box")}.")
            + (scrollKeys ? $"\nScroll the answer with {down} / {up}." : "\nScroll the answer with the mouse wheel.");
    }

    static string HotkeyOr(string combo, string fallback) => Hotkey.TryParse(combo, out var hotkey) ? hotkey.ToString() : fallback;

    void ScrollAnswer(bool down)
    {
        if (!ReaderVisible)
        {
            return;
        }
        if (down)
        {
            AnswerBox.PageDown();
        }
        else
        {
            AnswerBox.PageUp();
        }
    }

    void OnAnswerFontSmaller(object sender, RoutedEventArgs e) => ChangeAnswerFontSize(-1);

    void OnAnswerFontLarger(object sender, RoutedEventArgs e) => ChangeAnswerFontSize(+1);

    void ChangeAnswerFontSize(double delta)
    {
        _settings.AnswerFontSize = Math.Clamp(_settings.AnswerFontSize + delta, 12, 32);
        _settings.Save();
        ApplyAnswerWidth();
        RedrawAnswer();
    }

    void RedrawAnswer()
    {
        if (ApiMode)
        {
            if (_lastAnswer != null)
            {
                _answerId = null;
                ApplyAnswer(_lastAnswer);
            }
            return;
        }
        _answerId = null;
        _answerCount = -1;
        OnAnswerTick(null, EventArgs.Empty);
    }

    /// <summary>
    /// About 70 characters per line, the most comfortable reading length; a wider window centres
    /// the text instead of stretching the lines.
    /// </summary>
    void ApplyAnswerWidth() => AnswerBox.MaxWidth = _settings.AnswerFontSize * 38 + 22;

    // ---------------------------------------------------------------- views

    void OnToggleCompactClick(object sender, RoutedEventArgs e) => ToggleCompact();

    void ToggleCompact()
    {
        if (!OverlayActive)
        {
            // With the overlay up this window is minimized (or was just restored from the taskbar),
            // so its size says nothing about the interview window.
            SaveBounds();
        }
        SaveCaptionSize();
        _settings.CompactMode = !_settings.CompactMode;
        ApplyLayout(_settings.CompactMode);
        if (!OverlayActive)
        {
            ApplyBounds(_settings.CompactMode ? _settings.CompactBounds ?? DefaultCompactSize : _settings.NormalBounds);
        }
        _settings.Save();
        FollowLatestCaptions();
    }

    /// <summary>
    /// Full view shows the toolbar, status bar, chat page and the full caption panel. Interview view
    /// hides them and keeps the caption text, the answer reader and a one-line status, either inside
    /// this window (each view has its own caption position) or in the see-through overlay.
    /// </summary>
    void ApplyLayout(bool compact)
    {
        bool overlay = compact && _settings.OverlayMode;
        if (!overlay)
        {
            ExitOverlay();
        }

        var shown = compact ? Visibility.Collapsed : Visibility.Visible;
        Toolbar.Visibility = shown;
        StatusBar.Visibility = shown;
        CaptionHeader.Visibility = shown;
        NextPanel.Visibility = shown;
        NextPanelShadow.Visibility = shown;
        CompactBar.Visibility = compact ? Visibility.Visible : Visibility.Collapsed;
        // The overlay has Menu and Full view in its own top bar, and can only show the answer.
        CompactMenuButton.Visibility = overlay ? Visibility.Collapsed : Visibility.Visible;
        CompactFullButton.Visibility = overlay ? Visibility.Collapsed : Visibility.Visible;
        ViewSwitch.Visibility = overlay ? Visibility.Collapsed : Visibility.Visible;
        SyncPaneSwitch();
        Title = compact ? "Interview Assistant · Interview view" : "Interview Assistant";
        ApplyCompactMessageBox();

        CaptionScroll.Margin = compact ? new Thickness(12, 6, 6, 0) : new Thickness(14, 0, 6, 0);
        CaptionStack.Margin = compact ? new Thickness(0, 0, 8, 0) : new Thickness(0, 0, 8, 12);
        ApplyFontSize();
        if (overlay)
        {
            EnterOverlay();
        }
        else
        {
            _lastDocked = null;
            PlaceCaptions(CurrentDock);
        }
        UpdateChatHost();
        ApplyEngineUi();

        foreach (var view in _views.Values)
        {
            if (view.CoreWebView2 != null)
            {
                view.ZoomFactor = CurrentZoom;
            }
        }
    }

    double CurrentZoom => _settings.CompactMode ? _settings.CompactChatZoom : _settings.ChatZoom;

    void OnZoomFactorChanged(object? sender, EventArgs e)
    {
        if (sender is not WebView2 view || view.CoreWebView2 == null)
        {
            return;
        }
        double zoom = Math.Round(view.ZoomFactor, 2);
        if (_settings.CompactMode)
        {
            _settings.CompactChatZoom = zoom;
        }
        else
        {
            _settings.ChatZoom = zoom;
        }
        foreach (var other in _views.Values)
        {
            if (other != view && other.CoreWebView2 != null && Math.Abs(other.ZoomFactor - zoom) > 0.001)
            {
                other.ZoomFactor = zoom;
            }
        }
    }

    /// <summary>Remembers this window's size for the current view; a maximized window keeps its normal size too.</summary>
    void SaveBounds()
    {
        if (WindowState == WindowState.Minimized || !IsLoaded)
        {
            return;
        }
        var bounds = WindowState == WindowState.Maximized
            ? new WindowBounds(RestoreBounds.Left, RestoreBounds.Top, RestoreBounds.Width, RestoreBounds.Height, Maximized: true)
            : new WindowBounds(Left, Top, Width, Height);
        if (_settings.CompactMode)
        {
            _settings.CompactBounds = bounds;
        }
        else
        {
            _settings.NormalBounds = bounds;
        }
    }

    /// <summary>Puts this window at the saved size for the current view (the full view has a default too).</summary>
    void ApplyBounds(WindowBounds? bounds)
    {
        bounds ??= DefaultNormalSize;
        WindowState = WindowState.Normal;
        PlaceWindow(this, bounds);
        if (bounds.Maximized)
        {
            WindowState = WindowState.Maximized;
        }
    }

    static void PlaceWindow(Window window, WindowBounds bounds)
    {
        window.Width = Math.Max(window.MinWidth, bounds.Width);
        window.Height = Math.Max(window.MinHeight, bounds.Height);
        if (double.IsNaN(bounds.Left) || double.IsNaN(bounds.Top))
        {
            return;
        }
        // Keep the window reachable if a monitor was disconnected since it was saved.
        double left = SystemParameters.VirtualScreenLeft, top = SystemParameters.VirtualScreenTop;
        double right = left + SystemParameters.VirtualScreenWidth, bottom = top + SystemParameters.VirtualScreenHeight;
        window.WindowStartupLocation = WindowStartupLocation.Manual;
        window.Left = Math.Clamp(bounds.Left, left, Math.Max(left, right - window.Width));
        window.Top = Math.Clamp(bounds.Top, top, Math.Max(top, bottom - window.Height));
    }

    // ---------------------------------------------------------------- overlay

    /// <summary>
    /// Moves the caption panel and answer reader into the see-through overlay and minimizes this
    /// window. The chat page keeps running while minimized (answers keep streaming), so sending and
    /// reading work exactly as in the in-window interview view.
    /// </summary>
    void EnterOverlay()
    {
        if (_overlay == null)
        {
            _overlay = new OverlayWindow(_settings);
            _overlay.ExitRequested += ToggleCompact;
            _overlay.MenuRequested += anchor =>
            {
                FillMainMenu();
                OpenMenu(_mainMenu, anchor, PlacementMode.Bottom);
            };
            _overlay.Closing += (_, e) =>
            {
                // Alt+F4 on the overlay leaves the overlay instead of closing the app.
                if (!_closingApp)
                {
                    e.Cancel = true;
                    ToggleCompact();
                }
            };
        }

        if (CaptionPanel.Parent is Panel panel)
        {
            panel.Children.Remove(CaptionPanel);
        }
        else if (CaptionPanel.Parent is Window window)
        {
            window.Content = null;
        }
        _floatingWindow?.Hide();
        LayoutRoot.RowDefinitions.Clear();
        LayoutRoot.ColumnDefinitions.Clear();
        ColumnSplitter.Visibility = Visibility.Collapsed;
        RowSplitter.Visibility = Visibility.Collapsed;
        _captionDefinition = null;
        Grid.SetRow(ChatHost, 0);
        Grid.SetColumn(ChatHost, 0);
        ChatHost.Children.Remove(ReaderPanel);

        SetOverlayBackgrounds(true);
        _overlay.Host(CaptionPanel, ReaderPanel);
        _overlay.SetCaptionsConnected(_captionsConnected);
        _overlay.Show();
        _overlay.Activate();
        WindowState = WindowState.Minimized;
    }

    void ExitOverlay()
    {
        if (_overlay is not { IsVisible: true })
        {
            return;
        }
        _overlay.SaveState();
        _overlay.Release();
        ChatHost.Children.Insert(0, ReaderPanel);
        SetOverlayBackgrounds(false);
        _overlay.Hide();
        if (WindowState == WindowState.Minimized)
        {
            WindowState = WindowState.Normal;
        }
        Activate();
    }

    /// <summary>In the overlay the panels are transparent so only the overlay's own see-through background shows.</summary>
    void SetOverlayBackgrounds(bool overlay)
    {
        (FrameworkElement Element, DependencyProperty Property, string Key)[] parts =
        [
            (CaptionPanel, Panel.BackgroundProperty, "PanelBg"),
            (ReaderPanel, Border.BackgroundProperty, "WindowBg"),
            (ReaderHeader, Border.BackgroundProperty, "PanelBg"),
            (CompactBar, Border.BackgroundProperty, "PanelBg"),
        ];
        foreach (var (element, property, key) in parts)
        {
            if (overlay)
            {
                element.SetValue(property, Brushes.Transparent);
            }
            else
            {
                element.SetResourceReference(property, key);
            }
        }
    }

    /// <summary>Restoring the minimized main window (taskbar) while the overlay is up returns to full view.</summary>
    void OnMainWindowStateChanged(object? sender, EventArgs e)
    {
        if (OverlayActive && WindowState != WindowState.Minimized && _overlay is { IsVisible: true })
        {
            ToggleCompact();
        }
    }

    void SetOverlayMode(bool value)
    {
        if (value == _settings.OverlayMode)
        {
            return;
        }
        SaveCaptionSize();
        if (_settings.CompactMode && value)
        {
            SaveBounds(); // remember the in-window interview view size for later
        }
        _settings.OverlayMode = value;
        if (_settings.CompactMode)
        {
            ApplyLayout(true);
            if (!value)
            {
                ApplyBounds(_settings.CompactBounds ?? DefaultCompactSize);
            }
            FollowLatestCaptions();
        }
        _settings.Save();
        SetStatus(value
            ? "Interview view opens as a see-through overlay above other windows."
            : "Interview view opens inside this window.");
    }

    // ---------------------------------------------------------------- theme

    void SetTheme(AppTheme theme)
    {
        _settings.Theme = theme;
        _settings.Save();
        ThemeManager.Apply(theme);
    }

    /// <summary>Text drawn from code holds its own brushes, so it is redrawn in the new colours.</summary>
    void OnThemeChanged()
    {
        RedrawAnswer();
        // ChatGPT and DeepSeek follow the browser's light/dark preference; keep them in step.
        foreach (var view in _views.Values)
        {
            if (view.CoreWebView2 != null)
            {
                view.CoreWebView2.Profile.PreferredColorScheme = PageColorScheme;
            }
        }
    }

    static CoreWebView2PreferredColorScheme PageColorScheme =>
        ThemeManager.IsDark ? CoreWebView2PreferredColorScheme.Dark : CoreWebView2PreferredColorScheme.Light;

    // ---------------------------------------------------------------- caption position

    const double MinCaptionWidth = 160;
    const double MinCaptionHeight = 50;

    /// <summary>Full view keeps the captions on the left; interview view's position is set in Settings.</summary>
    CaptionDock CurrentDock
    {
        get => _settings.CompactMode ? _settings.CompactCaptionDock : CaptionDock.Left;
        set
        {
            if (_settings.CompactMode)
            {
                _settings.CompactCaptionDock = value;
            }
        }
    }

    double CaptionWidth
    {
        get => _settings.CompactMode ? _settings.CompactCaptionWidth : _settings.CaptionPanelWidth;
        set
        {
            if (_settings.CompactMode)
            {
                _settings.CompactCaptionWidth = value;
            }
            else
            {
                _settings.CaptionPanelWidth = value;
            }
        }
    }

    double CaptionHeight
    {
        get => _settings.CompactMode ? _settings.CompactCaptionHeight : _settings.CaptionPanelHeight;
        set
        {
            if (_settings.CompactMode)
            {
                _settings.CompactCaptionHeight = value;
            }
            else
            {
                _settings.CaptionPanelHeight = value;
            }
        }
    }

    void SetCaptionDock(CaptionDock dock)
    {
        SaveCaptionSize();
        CurrentDock = dock;
        PlaceCaptions(dock);
        _settings.Save();
        FollowLatestCaptions();
    }

    /// <summary>
    /// Docks the captions on one side of the chat with a splitter between them, or moves them into
    /// their own window. ChatHost (which holds the WebView2 controls) never changes parent, only its
    /// grid cell, so the chat pages are never reloaded.
    /// </summary>
    void PlaceCaptions(CaptionDock dock)
    {
        if (CaptionPanel.Parent is Panel panel)
        {
            panel.Children.Remove(CaptionPanel);
        }
        else if (CaptionPanel.Parent is Window window)
        {
            window.Content = null;
        }
        LayoutRoot.RowDefinitions.Clear();
        LayoutRoot.ColumnDefinitions.Clear();
        ColumnSplitter.Visibility = Visibility.Collapsed;
        RowSplitter.Visibility = Visibility.Collapsed;
        _captionDefinition = null;
        foreach (UIElement element in new UIElement[] { ChatHost, ColumnSplitter, RowSplitter, CaptionPanel })
        {
            Grid.SetRow(element, 0);
            Grid.SetColumn(element, 0);
        }

        if (dock == CaptionDock.Floating)
        {
            ShowFloatingCaptions();
            return;
        }
        _floatingWindow?.Hide();
        _lastDocked = dock;
        LayoutRoot.Children.Insert(0, CaptionPanel);

        bool beside = dock is CaptionDock.Left or CaptionDock.Right;
        bool captionsFirst = dock is CaptionDock.Left or CaptionDock.Top;
        int captionIndex = captionsFirst ? 0 : 2;
        int chatIndex = captionsFirst ? 2 : 0;
        double chatMin = _settings.CompactMode ? 0 : 300;

        if (beside)
        {
            var caption = new ColumnDefinition { Width = new GridLength(Math.Max(MinCaptionWidth, CaptionWidth)), MinWidth = MinCaptionWidth };
            var chat = new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = chatMin };
            LayoutRoot.ColumnDefinitions.Add(captionsFirst ? caption : chat);
            LayoutRoot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(5) });
            LayoutRoot.ColumnDefinitions.Add(captionsFirst ? chat : caption);
            Grid.SetColumn(CaptionPanel, captionIndex);
            Grid.SetColumn(ChatHost, chatIndex);
            Grid.SetColumn(ColumnSplitter, 1);
            ColumnSplitter.Visibility = Visibility.Visible;
            _captionDefinition = caption;
        }
        else
        {
            var caption = new RowDefinition { Height = new GridLength(Math.Max(MinCaptionHeight, CaptionHeight)), MinHeight = MinCaptionHeight };
            var chat = new RowDefinition { Height = new GridLength(1, GridUnitType.Star), MinHeight = chatMin / 2 };
            LayoutRoot.RowDefinitions.Add(captionsFirst ? caption : chat);
            LayoutRoot.RowDefinitions.Add(new RowDefinition { Height = new GridLength(5) });
            LayoutRoot.RowDefinitions.Add(captionsFirst ? chat : caption);
            Grid.SetRow(CaptionPanel, captionIndex);
            Grid.SetRow(ChatHost, chatIndex);
            Grid.SetRow(RowSplitter, 1);
            RowSplitter.Visibility = Visibility.Visible;
            _captionDefinition = caption;
        }
    }

    void ShowFloatingCaptions()
    {
        if (!IsLoaded)
        {
            // An owned window needs its owner on screen first.
            Dispatcher.BeginInvoke(() =>
            {
                if (CurrentDock == CaptionDock.Floating)
                {
                    PlaceCaptions(CaptionDock.Floating);
                }
            }, DispatcherPriority.Loaded);
            return;
        }
        if (_floatingWindow == null)
        {
            _floatingWindow = new Window
            {
                Title = "Live captions",
                Owner = this,
                ShowInTaskbar = false,
                WindowStyle = WindowStyle.ToolWindow,
                Background = (Brush)FindResource("PanelBg"),
                Foreground = (Brush)FindResource("Text"),
                FontFamily = FontFamily,
                FontSize = FontSize,
                MinWidth = 220,
                MinHeight = 90,
                WindowStartupLocation = WindowStartupLocation.Manual,
            };
            _floatingWindow.Closing += OnFloatingClosing;
            PlaceWindow(_floatingWindow, _settings.FloatingCaptionBounds
                ?? new WindowBounds(Left + Math.Max(0, ActualWidth - 460), Top + 80, 420, 300));
        }
        _floatingWindow.Topmost = Topmost;
        _floatingWindow.Content = CaptionPanel;
        _floatingWindow.Show();
    }

    void OnFloatingClosing(object? sender, CancelEventArgs e)
    {
        if (_closingApp)
        {
            return;
        }
        // Closing the caption window puts the captions back beside the chat instead of losing them.
        e.Cancel = true;
        SetCaptionDock(_lastDocked ?? (_settings.CompactMode ? CaptionDock.Bottom : CaptionDock.Left));
    }

    void SaveCaptionSize()
    {
        if (_captionDefinition is ColumnDefinition column && column.ActualWidth > 0)
        {
            CaptionWidth = column.ActualWidth;
        }
        else if (_captionDefinition is RowDefinition row && row.ActualHeight > 0)
        {
            CaptionHeight = row.ActualHeight;
        }
        if (_floatingWindow is { IsVisible: true, WindowState: WindowState.Normal } floating)
        {
            _settings.FloatingCaptionBounds = new WindowBounds(floating.Left, floating.Top, floating.Width, floating.Height);
        }
    }

    // ---------------------------------------------------------------- menu

    void OpenMenu(ContextMenu menu, object sender, PlacementMode placement)
    {
        menu.PlacementTarget = (UIElement)sender;
        menu.Placement = placement;
        menu.IsOpen = true;
    }

    void OnMainMenuClick(object sender, RoutedEventArgs e)
    {
        FillMainMenu();
        OpenMenu(_mainMenu, sender, PlacementMode.Top);
    }

    /// <summary>A menu entry; <paramref name="isChecked"/> null means not a toggle.</summary>
    MenuItem MenuItemFor(string header, Action action, bool? isChecked = null, string? hotkey = null, bool enabled = true)
    {
        var item = new MenuItem
        {
            Header = header,
            IsEnabled = enabled,
            InputGestureText = hotkey != null && Hotkey.TryParse(hotkey, out var key) ? key.ToString() : "",
        };
        if (isChecked == true)
        {
            item.Icon = new TextBlock { Text = "✓", Foreground = (Brush)FindResource("Accent"), FontWeight = FontWeights.Bold };
        }
        item.Click += (_, _) => action();
        return item;
    }

    /// <summary>
    /// Only what is needed during the interview; everything that is set once lives in Settings.
    /// </summary>
    void FillMainMenu()
    {
        var menu = _mainMenu;
        menu.Items.Clear();
        var keys = _settings.Hotkeys;

        void Add(string header, Action action, string? hotkey = null, bool enabled = true) =>
            menu.Items.Add(MenuItemFor(header, action, null, hotkey, enabled));

        bool waiting = _tracker.PendingWordCount > 0 || (_draftEdited && DraftText.Length > 0);
        Add("Send", () => _ = SendPendingAsync(), keys.Send, waiting);
        Add("Discard", DiscardPending, keys.Discard, waiting);
        Add("Submit chat box", () => _ = SubmitChatBoxAsync(), keys.SubmitChatBox);
        Add("Clear chat box", () => _ = ClearChatBoxAsync(), keys.ClearChatBox);
        menu.Items.Add(new Separator());

        if (OverlayActive)
        {
            Add("More see-through", () => ChangeSeeThrough(+0.1), keys.MoreSeeThrough);
            Add("More solid", () => ChangeSeeThrough(-0.1), keys.LessSeeThrough);
        }
        else if (_settings.CompactMode)
        {
            Add(_settings.CompactShowsChatPage ? "Show the answer" : "Show the chat page",
                () => SetShowChatPage(!_settings.CompactShowsChatPage));
        }
        if (ReaderVisible)
        {
            Add("Larger answer text", () => ChangeAnswerFontSize(+1));
            Add("Smaller answer text", () => ChangeAnswerFontSize(-1));
        }
        Add(_speaker.IsSpeaking ? "Stop listening" : SelectedAnswerText().Length > 0 ? "Listen to the selected text" : "Listen to the answer",
            () => _ = ListenAsync(), keys.StopVoice);
        if (ReaderVisible)
        {
            Add(SelectedAnswerText().Length > 0 ? "Copy the selected text" : "Copy the answer", CopyAnswer);
        }
        if (_settings.CompactMode)
        {
            Add(_settings.CompactMessageBox ? "Hide the message box" : "Show the message box",
                () => SetCompactMessageBox(!_settings.CompactMessageBox));
        }
        menu.Items.Add(MenuItemFor("Read new answers automatically", () => SetSpeakAnswers(!_settings.SpeakAnswers),
            _settings.SpeakAnswers, keys.ToggleVoice));
        Add("Clear captions", ClearCaptions);
        Add("Larger caption text", () => ChangeFontSize(+1));
        Add("Smaller caption text", () => ChangeFontSize(-1));
        if (!_captionsConnected)
        {
            Add("Start Live Captions", TryLaunchLiveCaptions);
        }
        menu.Items.Add(new Separator());

        Add("New chat + call prompt", () => OnNewChatClick(this, new RoutedEventArgs()));
        Add("Settings…", () => OnSetupClick(this, new RoutedEventArgs()));
        Add(_settings.CompactMode ? "Full view" : "Interview view", ToggleCompact, keys.ToggleCompact);
    }

    // ---------------------------------------------------------------- options

    /// <summary>The hotkey switches Automatic on and off; the other send modes are chosen in Settings.</summary>
    void SetAutoSend(bool value)
    {
        _settings.AutoSend = value;
        _settings.Save();
        UpdateModeText();
        UpdateReaderPlaceholder();
        SetStatus(value ? "Automatic: the question is sent when the interviewer pauses."
            : $"Automatic off. Send with {HotkeyTip(_settings.Hotkeys.Send)}.");
    }

    /// <summary>Send submits in "right away" and in Automatic mode; otherwise it only fills the chat box.</summary>
    bool SendSubmits => _settings.SubmitAutomatically || _settings.AutoSend;

    void SetAlwaysOnTop(bool value)
    {
        _settings.AlwaysOnTop = value;
        Topmost = value;
        if (_floatingWindow != null)
        {
            _floatingWindow.Topmost = value;
        }
    }

    void SetHideLiveCaptions(bool value)
    {
        _settings.HideLiveCaptionsWindow = value;
        if (value)
        {
            _lcMover.Hide(_reader.WindowHandle);
        }
        else
        {
            _lcMover.Restore();
        }
    }

    string ModeSummary(bool shortForm) =>
        _settings.AutoSend ? (shortForm ? "automatic" : "Automatic: sends when the interviewer pauses")
        : _settings.SubmitAutomatically ? (shortForm ? "sends right away" : "Send goes to the AI right away")
        : (shortForm ? "you press Enter" : "Send fills the chat box, you press Enter");

    void UpdateModeText() => ModeText.Text = ModeSummary(shortForm: false);

    // ---------------------------------------------------------------- settings + panel

    void OnSetupClick(object sender, RoutedEventArgs e) => OpenSettings();

    void OpenSettings(string? tab = null)
    {
        // Global hotkeys would swallow the keys pressed while recording new ones.
        _hotkeys?.UnregisterAll();
        // While the overlay is up this window is minimized, and a dialog owned by it would be hidden.
        var dialog = new SetupWindow(_settings, tab) { Owner = OverlayActive && _overlay != null ? _overlay : this };
        dialog.TestVoiceChanged += (speaking, heard) =>
        {
            _testVoiceSpeaking = speaking;
            OnVoiceChanged(speaking, heard);
        };
        bool speakAnswersBefore = _settings.SpeakAnswers;
        bool saved = dialog.ShowDialog() == true;
        _testVoiceSpeaking = false;
        if (saved)
        {
            ApplyFontSize();
            ApplyChosenSettings(dialog, speakAnswersBefore);
            _settings.Save();
        }
        var failed = RegisterHotkeys();
        if (failed.Count > 0)
        {
            SetStatus($"Hotkeys already used by another app: {string.Join(", ", failed)}. Pick different ones in Settings.", error: true);
        }
        else if (saved)
        {
            SetStatus("Settings saved.");
        }
    }

    /// <summary>Applies the Settings choices that change the running app, in an order that avoids extra moves.</summary>
    void ApplyChosenSettings(SetupWindow dialog, bool speakAnswersBefore)
    {
        _settings.SubmitAutomatically = dialog.ChosenSubmitAutomatically;
        _settings.AutoSend = dialog.ChosenAutoSend;
        UpdateModeText();
        UpdateReaderPlaceholder();

        if (dialog.ChosenTheme != _settings.Theme)
        {
            SetTheme(dialog.ChosenTheme);
        }
        if (dialog.ChosenAlwaysOnTop != _settings.AlwaysOnTop)
        {
            SetAlwaysOnTop(dialog.ChosenAlwaysOnTop);
        }
        if (dialog.ChosenHideLiveCaptions != _settings.HideLiveCaptionsWindow)
        {
            SetHideLiveCaptions(dialog.ChosenHideLiveCaptions);
        }
        if (dialog.ChosenCaptionDock != _settings.CompactCaptionDock)
        {
            if (_settings.CompactMode && !OverlayActive)
            {
                SetCaptionDock(dialog.ChosenCaptionDock);
            }
            else
            {
                _settings.CompactCaptionDock = dialog.ChosenCaptionDock; // used next time the window view opens
            }
        }
        if (dialog.ChosenOverlay != _settings.OverlayMode)
        {
            SetOverlayMode(dialog.ChosenOverlay);
        }
        if (!_settings.SpeakAnswers)
        {
            _speaker.Stop();
        }
        else if (!speakAnswersBefore)
        {
            _speechSkipCurrent = true; // just switched on: the answer already on the page is not read
        }
        UpdateListenButton();
        _ = ApplyVoiceSettingsAsync();
        ApplyEngineUi();
        UpdateChatHost();
    }

    // ---------------------------------------------------------------- answers from an AI API

    // The conversation with the API since the last New chat (the instructions are added to every
    // request, built from the current settings, so a changed interview round applies at once).
    readonly List<ChatMessage> _conversation = [];
    CancellationTokenSource? _apiRequest;
    int _apiAnswerNumber;
    const int ApiHistoryMessages = 24;

    /// <summary>Answers come from an AI API rather than the chat page (Settings ▸ Answers).</summary>
    bool ApiMode => _settings.AnswerEngine != AnswerEngine.ChatPage;

    string? ApiKey => _settings.AnswerEngine switch
    {
        AnswerEngine.OpenAi => ProtectedText.Unprotect(_settings.OpenAiKeyProtected),
        AnswerEngine.DeepSeek => ProtectedText.Unprotect(_settings.DeepSeekKeyProtected),
        _ => null,
    };

    string ApiModel
    {
        get => _settings.AnswerEngine == AnswerEngine.DeepSeek ? _settings.DeepSeekModel : _settings.OpenAiModel;
        set
        {
            if (_settings.AnswerEngine == AnswerEngine.DeepSeek)
            {
                _settings.DeepSeekModel = value;
            }
            else
            {
                _settings.OpenAiModel = value;
            }
        }
    }

    /// <summary>
    /// Starts answering <paramref name="text"/> and returns at once; the answer streams into the
    /// reader. In "fill the box" mode the text is put in the message box for review instead.
    /// </summary>
    SendResult SendToApi(string text, string what, bool submit)
    {
        string name = DirectChat.DisplayName(_settings.AnswerEngine);
        if (!submit)
        {
            StartEditedDraft(text);
            SetStatus("In the message box: check or edit it, then press Enter to send.");
            return SendResult.Ok;
        }
        string? key = ApiKey;
        if (key == null)
        {
            SetStatus($"Add your {name} key in Settings ▸ Answers, or switch back to the chat page there.", error: true);
            return SendResult.Fail("No API key.");
        }
        _apiRequest?.Cancel(); // a newer question replaces an answer still being written
        var request = _apiRequest = new CancellationTokenSource();
        BeginAwaitingAnswer(_answerId ?? "");
        _conversation.Add(new ChatMessage("user", text));
        SetStatus($"Sent {what} message to the {name}: “{Shorten(text)}”");
        _ = StreamApiAnswerAsync(key, request, _lastSentQuestion ?? text);
        return SendResult.Ok;
    }

    async Task StreamApiAnswerAsync(string key, CancellationTokenSource request, string question)
    {
        var engine = _settings.AnswerEngine;
        string id = $"api-{++_apiAnswerNumber}";
        var text = new System.Text.StringBuilder();
        var shownAt = DateTime.MinValue;
        try
        {
            string model = await EnsureApiModelAsync(engine, key, request.Token);
            var messages = new List<ChatMessage> { new("system", ApiInstructions()) };
            messages.AddRange(_conversation.TakeLast(ApiHistoryMessages));
            await foreach (string piece in DirectChat.StreamAsync(engine, key, model, messages, request.Token))
            {
                text.Append(piece);
                // About ten updates a second: smooth to read, light on the window.
                if (DateTime.UtcNow - shownAt > TimeSpan.FromMilliseconds(90))
                {
                    shownAt = DateTime.UtcNow;
                    ShowApiAnswer(id, text.ToString(), writing: true, question);
                }
            }
            _awaitingAnswer = false;
            _answerTimedOut = false;
            ShowApiAnswer(id, text.ToString(), writing: false, question);
            _conversation.Add(new ChatMessage("assistant", text.ToString()));
            Log.Write($"[{DirectChat.DisplayName(engine)}] answered with {text.Length} characters ({model})");
            if (_settings.SpeakAnswers && _lastAnswer != null)
            {
                _speaker.Listen(AnswerKey(_lastAnswer), SpeechText(_lastAnswer), complete: true, slowly: false);
            }
        }
        catch (OperationCanceledException) when (request.IsCancellationRequested)
        {
            if (text.Length > 0 && request == _apiRequest)
            {
                _conversation.Add(new ChatMessage("assistant", text.ToString()));
            }
            if (request == _apiRequest)
            {
                _awaitingAnswer = false;
            }
        }
        catch (Exception ex)
        {
            string message = ex is DirectChatException ? ex.Message : $"The {DirectChat.DisplayName(engine)} failed: {ex.Message}";
            Log.Write(message);
            if (request == _apiRequest)
            {
                // The question did not get an answer: take it back so it is not part of the next request.
                if (_conversation.Count > 0 && _conversation[^1].Role == "user")
                {
                    _conversation.RemoveAt(_conversation.Count - 1);
                }
                _awaitingAnswer = false;
                _answerTimedOut = false;
                ShowAnswerState(_lastAnswer is { Blocks.Count: > 0 }, writing: false);
                SetStatus(message, error: true);
            }
        }
    }

    void ShowApiAnswer(string id, string markdown, bool writing, string question)
    {
        ApplyAnswer(new AnswerSnapshot(id, _apiAnswerNumber, writing, question, MarkdownAnswer.Parse(markdown)));
    }

    /// <summary>The model to use: the one picked in Settings, or else the service's first quick model.</summary>
    async Task<string> EnsureApiModelAsync(AnswerEngine engine, string key, CancellationToken token)
    {
        if (ApiModel.Length > 0)
        {
            return ApiModel;
        }
        var models = await DirectChat.ModelsAsync(engine, key, token);
        if (models.Count == 0)
        {
            throw new DirectChatException($"The {DirectChat.DisplayName(engine)} offers no chat model for this key.");
        }
        ApiModel = models[0];
        _settings.Save();
        ApplyEngineUi();
        return models[0];
    }

    /// <summary>
    /// The instructions for every API request: the call prompt (profile, company, job description,
    /// resume) and the rules for this interview round. The call prompt's "reply Ready" line is for
    /// the chat page's first message and is left out.
    /// </summary>
    string ApiInstructions() =>
        ReadyLine().Replace(_settings.BuildCallPrompt(), "").Trim()
        + "\n\n" + InterviewStyles.Instructions(_settings.InterviewType, _settings.AnswerLength)
        + "\n\nEvery message from now on is what the interviewer just said (or my request to rework your last answer).";

    /// <summary>The call prompt for the chat page, with the rules for this round before its "reply Ready" line.</summary>
    string WithInterviewStyle(string prompt)
    {
        string style = InterviewStyles.Instructions(_settings.InterviewType, _settings.AnswerLength);
        var ready = ReadyLine().Match(prompt);
        return ready.Success ? prompt.Insert(ready.Index, style + "\n\n") : prompt + "\n\n" + style;
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"^[^\n]*\breply\b[^\n]*\bready\b[^\n]*$",
        System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Multiline)]
    private static partial System.Text.RegularExpressions.Regex ReadyLine();

    /// <summary>New chat with an API: a fresh conversation and an empty reader.</summary>
    void StartApiConversation()
    {
        _apiRequest?.Cancel();
        _conversation.Clear();
        _tracker.DiscardPending();
        _lastSentQuestion = null;
        RenderCaptions();
        AnswerBox.Document.Blocks.Clear();
        _renderedAnswerKeys.Clear();
        _answerId = null;
        _lastAnswer = null;
        _awaitingAnswer = false;
        QuestionText.Visibility = Visibility.Collapsed;
        QuestionTypeChip.Visibility = Visibility.Collapsed;
        ShowAnswerState(hasAnswer: false, writing: false);
        string key = ApiKey == null ? " Add your key in Settings ▸ Answers first." : "";
        SetStatus($"New chat: questions go straight to the {DirectChat.DisplayName(_settings.AnswerEngine)} ({InterviewStyles.Name(_settings.InterviewType)} round).{key}",
            error: key.Length > 0);
    }

    /// <summary>Controls that only make sense for one engine; the round shown above the answer.</summary>
    void ApplyEngineUi()
    {
        bool api = ApiMode;
        ProviderSwitch.Visibility = api ? Visibility.Collapsed : Visibility.Visible;
        EnginePill.Visibility = api ? Visibility.Visible : Visibility.Collapsed;
        EngineText.Text = DirectChat.DisplayName(_settings.AnswerEngine) + (ApiModel.Length > 0 ? " · " + ApiModel : "");
        ChatBoxTools.Visibility = api ? Visibility.Collapsed : Visibility.Visible;
        // With an API there is no chat page to switch to; the overlay never shows the page.
        ViewSwitch.Visibility = api || OverlayActive ? Visibility.Collapsed : Visibility.Visible;
        NewChatText.Text = api ? "New chat" : "New chat + call prompt";
        NewChatButton.ToolTip = api
            ? "Start a fresh conversation (your details and the interview round go with every question)"
            : "Open a fresh chat and send your call prompt (profile, company, job description, resume)";
        InterviewTypeText.Text = InterviewStyles.Name(_settings.InterviewType);
    }

    void OnInterviewTypeClick(object sender, RoutedEventArgs e)
    {
        var menu = new ContextMenu();
        foreach (var type in InterviewStyles.All)
        {
            menu.Items.Add(MenuItemFor(InterviewStyles.Name(type), () => SetInterviewType(type), type == _settings.InterviewType));
        }
        OpenMenu(menu, sender, PlacementMode.Bottom);
    }

    void SetInterviewType(InterviewType type)
    {
        _settings.InterviewType = type;
        _settings.Save();
        ApplyEngineUi();
        SetStatus(ApiMode
            ? $"{InterviewStyles.Name(type)} round: the next answers follow it."
            : $"{InterviewStyles.Name(type)} round: the chat page gets it with the next New chat + call prompt.");
    }

    /// <summary>Shorter / Example / More detail / STAR: asks the AI to rework its last answer.</summary>
    async void OnFollowUpClick(object sender, RoutedEventArgs e)
    {
        if (_lastAnswer is not { Blocks.Count: > 0 })
        {
            SetStatus("No answer to rework yet.");
            return;
        }
        string kind = (string)((Button)sender).Tag;
        await SendTextAsync(InterviewStyles.FollowUp(kind), "follow-up", submit: true);
    }

    // ---------------------------------------------------------------- read aloud

    Task ApplyVoiceSettingsAsync() => _speaker.ConfigureAsync(_settings.VoiceService,
        ProtectedText.Unprotect(_settings.GoogleKeyProtected) ?? "", _settings.GoogleVoice, _settings.VoiceId,
        _settings.VoiceRate, _settings.VoiceDeviceId);

    void OnListenClick(object sender, RoutedEventArgs e) => _ = ListenAsync();

    void SetSpeakAnswers(bool on)
    {
        _settings.SpeakAnswers = on;
        _settings.Save();
        if (on)
        {
            _speechSkipCurrent = true; // the answer already on the page is not read; Replay reads it
        }
        else
        {
            _speaker.Stop();
        }
        UpdateListenButton();
        SetStatus(on ? "Automatic reading on: each new answer is read as it arrives."
            : "Automatic reading off. Press Listen to hear an answer.");
    }

    /// <summary>
    /// Like Google Translate's Listen button: reads the latest answer (following it while it is still
    /// being written); pressed while speaking it stops; pressed again after the answer was read to the
    /// end it reads it slower, and the time after that at normal speed again.
    /// </summary>
    async Task ListenAsync()
    {
        if (_speaker.IsSpeaking)
        {
            _speaker.Stop();
            SetStatus("Stopped.");
            return;
        }
        var bridge = _bridges.TryGetValue(_settings.Provider, out var task) && task.IsCompletedSuccessfully ? task.Result : null;

        // Selected text is read instead of the whole answer: in the answer reader, or else on the chat page.
        string selection = SelectedAnswerText();
        if (selection.Length == 0 && !ReaderVisible && bridge != null)
        {
            selection = await bridge.ReadSelectionAsync();
        }
        if (selection.Length > 0)
        {
            string selectionKey = "selection:" + selection;
            bool slower = selectionKey == _lastListenKey && _speaker.FinishedReading && !_speaker.ReadSlowly;
            _lastListenKey = selectionKey;
            SetStatus(!_speaker.Speak(selection, slower) ? "The selected text has nothing to read out."
                : slower ? "Listening to the selection again, slower." : "Listening to the selected text…");
            return;
        }

        AnswerSnapshot? snapshot = ApiMode ? _lastAnswer : bridge == null ? null : await bridge.ReadAnswerAsync();
        if (snapshot != null && !ApiMode)
        {
            var blocks = snapshot.Blocks.ToList();
            InterviewStyles.TakeQuestionType(blocks);
            snapshot = snapshot with { Blocks = blocks };
        }
        if (snapshot == null || snapshot.Blocks.Count == 0)
        {
            SetStatus("No answer to listen to yet.");
            return;
        }
        string id = AnswerKey(snapshot);
        bool slowly = "answer:" + id == _lastListenKey && id == _speaker.AnswerId && _speaker.FinishedReading && !_speaker.ReadSlowly;
        _lastListenKey = "answer:" + id;
        // Finished only if the reader has been watching it stop growing; otherwise the page is read on
        // (IsFollowing) and the next look decides, so an answer still being written is read to its end.
        bool watched = ReaderVisible || _settings.SpeakAnswers;
        bool complete = watched && !snapshot.Generating && !_awaitingAnswer && DateTime.UtcNow - _answerGrewAt > TimeSpan.FromSeconds(1.5);
        if (_speaker.Listen(id, SpeechText(snapshot), complete, slowly))
        {
            SetStatus(slowly ? "Listening again, slower." : "Listening…");
        }
        else
        {
            SetStatus("This answer has nothing to read out (only code or symbols).");
        }
    }

    static string AnswerKey(AnswerSnapshot snapshot) =>
        snapshot.MessageId.Length > 0 ? snapshot.MessageId : $"#{snapshot.MessageCount}";

    // What Listen read last ("answer:<id>" or "selection:<text>"): the same again after it ended is read slower.
    string _lastListenKey = "";

    // ---------------------------------------------------------------- listening to a selection

    Window? _popupWindow;

    /// <summary>The text selected in the answer reader, "" when none (or the reader is not shown).</summary>
    string SelectedAnswerText() => ReaderVisible && !AnswerBox.Selection.IsEmpty ? AnswerBox.Selection.Text.Trim() : "";

    void OnAnswerMouseUp(object sender, MouseButtonEventArgs e)
    {
        var at = e.GetPosition(AnswerBox);
        // The selection is final only after the box has handled the mouse release.
        Dispatcher.BeginInvoke(() => ShowSelectionPopup(at), DispatcherPriority.Input);
    }

    /// <summary>Shows the small Listen button just below the mouse, inside the reader.</summary>
    void ShowSelectionPopup(Point at)
    {
        if (SelectedAnswerText().Length == 0)
        {
            SelectionPopup.IsOpen = false;
            return;
        }
        SelectionPopup.HorizontalOffset = Math.Clamp(at.X - 20, 4, Math.Max(4, AnswerBox.ActualWidth - 200));
        SelectionPopup.VerticalOffset = Math.Clamp(at.Y + 16, 4, Math.Max(4, AnswerBox.ActualHeight - 40));
        // A popup does not move with its window; it closes instead when the window moves or loses focus.
        var window = Window.GetWindow(AnswerBox);
        if (window != _popupWindow)
        {
            if (_popupWindow != null)
            {
                _popupWindow.LocationChanged -= HideSelectionPopup;
                _popupWindow.Deactivated -= HideSelectionPopup;
            }
            _popupWindow = window;
            if (window != null)
            {
                window.LocationChanged += HideSelectionPopup;
                window.Deactivated += HideSelectionPopup;
            }
        }
        UpdateListenButton();
        SelectionPopup.IsOpen = true;
    }

    void HideSelectionPopup(object? sender, EventArgs e) => SelectionPopup.IsOpen = false;

    void OnAnswerSelectionChanged(object sender, RoutedEventArgs e)
    {
        if (AnswerBox.Selection.IsEmpty)
        {
            SelectionPopup.IsOpen = false;
        }
    }

    void OnAnswerLostFocus(object sender, KeyboardFocusChangedEventArgs e) => SelectionPopup.IsOpen = false;

    void OnAnswerScrolled(object sender, ScrollChangedEventArgs e)
    {
        if (e.VerticalChange != 0 || e.HorizontalChange != 0)
        {
            SelectionPopup.IsOpen = false;
        }
    }

    void OnSelectionListenClick(object sender, RoutedEventArgs e) => _ = ListenAsync();

    // ---------------------------------------------------------------- copy

    // The latest answer read from the page, for Copy.
    AnswerSnapshot? _lastAnswer;
    DispatcherTimer? _copiedTimer;

    void OnCopyAnswerClick(object sender, RoutedEventArgs e) => CopyAnswer();

    /// <summary>Copies the selected text, or else the whole answer as plain text with its bullets.</summary>
    void CopyAnswer()
    {
        string selection = SelectedAnswerText();
        string text = selection.Length > 0 ? selection
            : _lastAnswer is { Blocks.Count: > 0 } answer ? PlainText(answer) : "";
        if (text.Length == 0)
        {
            SetStatus("No answer to copy yet.");
            return;
        }
        if (!NativeMethods.SetClipboardText(new WindowInteropHelper(this).Handle, text))
        {
            SetStatus("Could not copy: another app is using the clipboard. Try again.", error: true);
            return;
        }
        SetStatus(selection.Length > 0 ? "Copied the selected text."
            : $"Copied the answer ({CaptionTracker.CountWords(text)} words).");
        ShowCopied(true);
        _copiedTimer ??= new DispatcherTimer(TimeSpan.FromSeconds(1.6), DispatcherPriority.Normal,
            (_, _) => { _copiedTimer!.Stop(); ShowCopied(false); }, Dispatcher);
        _copiedTimer.Stop();
        _copiedTimer.Start();
    }

    /// <summary>"✓ Copied" in green for a moment, then "Copy" again.</summary>
    void ShowCopied(bool copied)
    {
        foreach (var (glyph, label) in new[] { (CopyGlyph, CopyText), (SelectionCopyGlyph, SelectionCopyText) })
        {
            glyph.Text = copied ? "\uE73E" : "\uE8C8";
            glyph.SetResourceReference(TextBlock.ForegroundProperty, copied ? "Success" : "Accent");
            label.Text = copied ? "Copied" : "Copy";
        }
    }

    /// <summary>The answer as plain text: headings and paragraphs, bullets and numbers kept, code as is.</summary>
    static string PlainText(AnswerSnapshot answer)
    {
        var text = new System.Text.StringBuilder();
        AnswerBlock? previous = null;
        foreach (var block in answer.Blocks)
        {
            // List items follow each other line by line; other blocks are separated by a blank line.
            if (previous != null && !(previous.Kind == "li" && block.Kind == "li"))
            {
                text.AppendLine();
            }
            string content = string.Concat(block.Runs.Select(r => r.Text));
            string indent = new(' ', Math.Max(0, block.Level - 1) * 2);
            switch (block.Kind)
            {
                case "hr":
                    text.AppendLine("---");
                    break;
                case "code":
                    text.AppendLine(content);
                    break;
                case "li":
                    text.Append(indent).Append(block.Marker).Append(' ').AppendLine(content);
                    break;
                case "p":
                    // A paragraph inside a list item lines up with the item's text.
                    text.Append(block.Level > 0 ? indent + "  " : "").AppendLine(content);
                    break;
                default: // headings (their Level is the heading size, not an indent)
                    text.AppendLine(content);
                    break;
            }
            previous = block;
        }
        return text.ToString().TrimEnd();
    }

    void OnSpeakingChanged()
    {
        UpdateListenButton();
        OnVoiceChanged(_speaker.IsSpeaking, _speaker.HeardByCaptions);
    }

    // The Settings ▸ Voice ▸ Test voice, which Live Captions hears as well.
    bool _testVoiceSpeaking;

    void OnVoiceChanged(bool speaking, bool heardByCaptions)
    {
        if (speaking)
        {
            if (DateTime.UtcNow >= _voiceEchoUntil)
            {
                _voiceStartedAt = DateTime.UtcNow;
                // The voice's captions are dropped when it ends, together with everything waiting.
                // Words the interviewer said before it started go into the message box first, so
                // they are kept (and sent with Send) instead of being dropped with the echo.
                if (_settings.VoiceSkipsCaptions && heardByCaptions && !_draftEdited && _tracker.PendingWordCount > 0)
                {
                    StartEditedDraft(_tracker.Pending);
                    SetStatus("The interviewer's words are kept in the message box while the voice speaks.");
                }
            }
            _voiceHeardByCaptions = heardByCaptions;
            _voiceEchoPending = true;
        }
        else
        {
            _voiceEchoUntil = DateTime.UtcNow + VoiceEchoDelay;
        }
    }

    /// <summary>True while the voice (or its delayed captions) may be coming in as caption text.</summary>
    bool VoiceEchoActive => _settings.VoiceSkipsCaptions && _voiceHeardByCaptions
        && (_speaker.IsSpeaking || _testVoiceSpeaking || DateTime.UtcNow < _voiceEchoUntil);

    /// <summary>Listen while quiet, Stop while speaking (as on Google Translate).</summary>
    void UpdateListenButton()
    {
        bool speaking = _speaker.IsSpeaking;
        var keys = _settings.Hotkeys;
        foreach (var (glyph, label) in new[] { (ListenGlyph, ListenText), (ToolbarListenGlyph, ToolbarListenText), (SelectionListenGlyph, SelectionListenText) })
        {
            glyph.Text = speaking ? "\uE71A" : "\uE767";
            label.Text = speaking ? "Stop" : "Listen";
        }
        ToolbarListenButton.ToolTip = speaking
            ? $"Stop ({HotkeyTip(keys.StopVoice)})"
            : $"Listen to the text selected on the chat page, or else the latest answer ({HotkeyTip(keys.StopVoice)}).";
        SelectionListenButton.ToolTip = speaking ? "Stop" : "Listen to the selected text";
        ListenButton.ToolTip = speaking
            ? $"Stop ({HotkeyTip(keys.StopVoice)})"
            : $"Listen to the answer, or to the text you selected in it ({HotkeyTip(keys.StopVoice)}). Press again after it ends to hear it slower."
              + (_settings.SpeakAnswers ? " New answers are also read automatically." : "");
    }

    /// <summary>The answer as plain sentences: code blocks are left out, and each block ends a sentence.</summary>
    static string SpeechText(AnswerSnapshot snapshot) => string.Join("\n", snapshot.Blocks
        .Where(b => b.Kind is not ("code" or "hr"))
        .Select(b => string.Concat(b.Runs.Where(r => !r.Code || r.Text.Length < 40).Select(r => r.Text)).Replace('\n', ' ').Trim())
        .Where(t => t.Length > 0)
        .Select(t => ".!?:;".Contains(t[^1]) ? t : t + "."));

    void OnStartLiveCaptionsClick(object sender, RoutedEventArgs e) => TryLaunchLiveCaptions();

    void TryLaunchLiveCaptions()
    {
        try
        {
            LiveCaptionsReader.Launch();
        }
        catch (Exception ex)
        {
            SetStatus($"Could not start Live Captions (Win+Ctrl+L): {ex.Message}", error: true);
        }
    }

    async void OnSendNowClick(object sender, RoutedEventArgs e) => await SendPendingAsync();

    void OnDiscardClick(object sender, RoutedEventArgs e) => DiscardPending();

    async void OnSubmitChatClick(object sender, RoutedEventArgs e) => await SubmitChatBoxAsync();

    async void OnClearChatClick(object sender, RoutedEventArgs e) => await ClearChatBoxAsync();

    void OnFontSmaller(object sender, RoutedEventArgs e) => ChangeFontSize(-1);

    void OnFontLarger(object sender, RoutedEventArgs e) => ChangeFontSize(+1);

    void ChangeFontSize(double delta)
    {
        _settings.CaptionFontSize = Math.Clamp(_settings.CaptionFontSize + delta, 10, 32);
        ApplyFontSize();
        _settings.Save();
    }

    void ApplyFontSize()
    {
        CaptionStack.SetValue(TextElement.FontSizeProperty, _settings.CaptionFontSize);
        CaptionStack.SetValue(TextBlock.LineHeightProperty, Math.Round(_settings.CaptionFontSize * 1.45));
        DraftBox.FontSize = Math.Max(12, _settings.CaptionFontSize - 1);
        DraftPreview.FontSize = DraftBox.FontSize;
        DraftBox.Height = Math.Round(DraftBox.FontSize * 1.36 * 3 + 20); // three lines and the padding
        RenderCaptions();
    }

    void OnSplitterDragCompleted(object sender, DragCompletedEventArgs e)
    {
        SaveCaptionSize();
        _settings.Save();
    }

    void SetStatus(string message, bool error = false)
    {
        Log.Write((error ? "ERROR " : "") + message);
        StatusText.Text = message;
        StatusText.SetResourceReference(TextBlock.ForegroundProperty, error ? "Danger" : "Muted");
        _compactStatusUntil = DateTime.UtcNow.AddSeconds(error ? 8 : 4);
        _compactStatusIsError = error;
    }

    static string Shorten(string text)
    {
        string flat = CaptionTracker.CleanForSending(text);
        return flat.Length <= 90 ? flat : flat[..87] + "…";
    }
}
