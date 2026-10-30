using System.ComponentModel;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
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
    (int Stable, int Sent, bool Compact) _renderedHistory = (-1, -1, false);
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
#else
        if (!LiveCaptionsReader.IsWindowOpen())
        {
            TryLaunchLiveCaptions();
        }
        _reader.Start();
#endif
        _tick.Start();
        _answerTimer.Start();

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
        _activeHotkeys.Clear();
        var all = new List<string>();
        foreach (var (name, combo, action) in HotkeyActions())
        {
            if (!Hotkey.TryParse(combo, out var hotkey))
            {
                continue;
            }
            // Switching views brings a window to the front, which only a real Windows hotkey may do.
            if (_hotkeys.Register(hotkey, action, activates: combo == _settings.Hotkeys.ToggleCompact))
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
    /// Shows the whole transcript. The part Live Captions has already dropped can no longer change,
    /// so it is only rebuilt when it grows or the sent marker moves inside it; the live part (a few
    /// thousand characters at most) is rebuilt on every change. The view follows new text unless the
    /// user has scrolled up to read something.
    /// </summary>
    void RenderCaptions()
    {
        string transcript = _tracker.Transcript;
        int sent = Math.Min(_tracker.SentUpTo, transcript.Length);
        int stable = Math.Min(_tracker.StableLength, transcript.Length);
        bool follow = _followCaptions;

        var historyKey = (stable, Math.Min(sent, stable), _settings.CompactMode);
        if (historyKey != _renderedHistory)
        {
            _renderedHistory = historyKey;
            string history = transcript[..stable];
            bool endsParagraph = history.EndsWith('\n');
            FillRuns(HistoryText, history.TrimEnd('\n'), Math.Min(sent, stable));
            HistoryText.Visibility = stable > 0 ? Visibility.Visible : Visibility.Collapsed;
            // A paragraph break between the two blocks becomes spacing instead of an empty line.
            LiveText.Margin = new Thickness(0, endsParagraph && !_settings.CompactMode ? HistoryText.LineHeight : 0, 0, 0);
        }
        FillRuns(LiveText, transcript[stable..], Math.Max(0, sent - stable));

        if (follow)
        {
            CaptionScroll.ScrollToEnd();
        }

        string pending = _tracker.Pending;
        PendingText.Text = pending.Length > 0 ? pending : "Waiting for the interviewer…";
        PendingText.Foreground = (Brush)FindResource(pending.Length > 0 ? "Text" : "Muted");
    }

    // Paragraph breaks in Live Captions mark longer pauses; a blank line makes them easy to scan.
    // The interview view strip has no room for blank lines.
    string ForDisplay(string text) => _settings.CompactMode ? text : text.Replace("\n", "\n\n");

    /// <summary>Text before <paramref name="sentLength"/> is shown as sent (grey), the rest as waiting.</summary>
    void FillRuns(TextBlock block, string text, int sentLength)
    {
        sentLength = Math.Clamp(sentLength, 0, text.Length);
        block.Inlines.Clear();
        block.Inlines.Add(new Run(ForDisplay(text[..sentLength])) { Foreground = (Brush)FindResource("Muted") });
        // Waiting words stand out in the accent colour (a background would look like selected text).
        block.Inlines.Add(new Run(ForDisplay(text[sentLength..]))
        {
            Foreground = (Brush)FindResource("Highlight"),
        });
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
        int words = _tracker.PendingWordCount;
        double pause = Math.Max(0.3, _settings.PauseSeconds);
        double silent = (DateTime.UtcNow - _lastCaptionChange).TotalSeconds;
        bool auto = _settings.AutoSend;

        string wordsText = words == 1 ? "1 word" : $"{words} words";
        if (words == 0)
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
        bool sendKey = !auto && words > 0 && _activeHotkeys.Contains("Send");
        string sendText = sendKey ? HotkeyTip(_settings.Hotkeys.Send) : "";
        SetText(SendKeyText, sendText);
        SetText(CompactKeyText, sendText);
        SendKeyChip.Visibility = sendKey ? Visibility.Visible : Visibility.Collapsed;

        bool showStatus = DateTime.UtcNow < _compactStatusUntil;
        SetText(CompactInfo, showStatus ? StatusText.Text
            : !_captionsConnected ? "Live Captions is not running · Menu ▸ Start Live Captions"
            : words == 0 ? "Listening…"
            : auto ? $"{wordsText} waiting · sends when the interviewer pauses"
            : $"{wordsText} waiting");
        CompactKeyChip.Visibility = sendKey && !showStatus && _captionsConnected ? Visibility.Visible : Visibility.Collapsed;
        CompactInfo.ToolTip = showStatus ? StatusText.Text : ModeSummary(shortForm: false);
        CompactInfo.Foreground = (Brush)FindResource(showStatus ? (_compactStatusIsError ? "Danger" : "Text")
            : !_captionsConnected ? "Danger" : "Muted");

        if (auto && words >= _settings.MinWords && silent >= pause && DateTime.UtcNow >= _autoSendBlockedUntil)
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

    void DiscardPending()
    {
        _tracker.DiscardPending();
        RenderCaptions();
        SetStatus("Discarded the waiting caption text.");
    }

    // ---------------------------------------------------------------- chat

    async Task<SendResult> SendTextAsync(string text, string what, bool submit = true, bool replace = false)
    {
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
        // Nothing from the old chat may be typed into the new one, and auto-send waits until the
        // call prompt has gone out.
        _autoSendBlockedUntil = DateTime.MaxValue;
        try
        {
            SetStatus($"Opening a new {name} chat…");
            try
            {
                var bridge = await GetBridgeAsync(provider);
                bridge.CancelPending();
                var core = _views[provider].CoreWebView2;
                var loaded = new TaskCompletionSource();
                void Done(object? s, CoreWebView2NavigationCompletedEventArgs a) => loaded.TrySetResult();
                core.NavigationCompleted += Done;
                core.Navigate(ChatBridge.HomeUrl(provider).ToString());
                await Task.WhenAny(loaded.Task, Task.Delay(TimeSpan.FromSeconds(20)));
                core.NavigationCompleted -= Done;
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
        string prompt = _settings.BuildCallPrompt();
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
    bool ReaderVisible => _settings.CompactMode && (_settings.OverlayMode || !_settings.CompactShowsChatPage);

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
        if (!ReaderVisible || _answerPolling
            || !_bridges.TryGetValue(_settings.Provider, out var task) || !task.IsCompletedSuccessfully)
        {
            return;
        }
        _answerPolling = true;
        try
        {
            var snapshot = await task.Result.ReadAnswerAsync();
            if (snapshot != null && ReaderVisible)
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
        // Pages that build only part of the conversation (DeepSeek) change how many messages exist
        // as they scroll, so the message's own id decides when it carries one; the count is a fallback.
        bool isNew = snapshot.MessageId.Length > 0
            ? snapshot.MessageId != _answerId
            : snapshot.MessageId != _answerId || snapshot.MessageCount != _answerCount;
        int length = snapshot.Blocks.Sum(b => b.Runs.Sum(r => r.Text.Length));
        bool firstLook = _answerId == null;
        if (isNew)
        {
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
            document.Blocks.Add(AnswerRenderer.Render(snapshot.Blocks[i], _settings.AnswerFontSize, Application.Current.Resources));
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

        // While waiting, the question just sent is the one that matters, not the old answer's.
        string? question = _awaitingAnswer ? _lastSentQuestion : snapshot.Question ?? _lastSentQuestion;
        QuestionText.Text = string.IsNullOrWhiteSpace(question) ? "" : "Q: " + CaptionTracker.CleanForSending(question);
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
        string text, brush;
        if (_awaitingAnswer)
        {
            int seconds = (int)(DateTime.UtcNow - _awaitingSince).TotalSeconds;
            text = seconds < 1 ? "●  Thinking…" : $"●  Thinking… {seconds}s";
            brush = "Accent";
        }
        else if (writing)
        {
            text = "●  Writing…";
            brush = "Accent";
        }
        else if (_answerTimedOut)
        {
            text = "No answer yet — check the chat page (Full view)";
            brush = "Danger";
        }
        else if (hasAnswer)
        {
            text = "✓  Complete";
            brush = "Success";
        }
        else
        {
            text = "Waiting for a question";
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
        _awaitingAnswer = true;
        _answerTimedOut = false;
        _awaitingAfterId = answerIdBefore ?? _answerId;
        _awaitingSince = DateTime.UtcNow;
        if (ReaderVisible)
        {
            ShowAnswerState(hasAnswer: _renderedAnswerKeys.Count > 0, writing: false);
            QuestionText.Text = string.IsNullOrWhiteSpace(_lastSentQuestion) ? "" : "Q: " + CaptionTracker.CleanForSending(_lastSentQuestion);
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
        _renderedHistory = (-1, -1, false);
        RenderCaptions();
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
        SetCaptionDock(_lastDocked ?? (_settings.CompactMode ? CaptionDock.Top : CaptionDock.Left));
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

        bool waiting = _tracker.PendingWordCount > 0;
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
        bool saved = dialog.ShowDialog() == true;
        if (saved)
        {
            ApplyFontSize();
            ApplyChosenSettings(dialog);
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
    void ApplyChosenSettings(SetupWindow dialog)
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
    }

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
        double lineHeight = Math.Round(_settings.CaptionFontSize * 1.45);
        foreach (var block in new[] { HistoryText, LiveText })
        {
            block.FontSize = _settings.CaptionFontSize;
            block.LineHeight = lineHeight;
        }
        PendingText.FontSize = Math.Max(12, _settings.CaptionFontSize - 1);
        _renderedHistory = (-1, -1, false);
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
