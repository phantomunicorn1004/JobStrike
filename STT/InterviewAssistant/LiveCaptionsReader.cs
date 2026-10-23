using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace InterviewAssistant;

public enum CaptionSourceState
{
    NotRunning,
    Connected,
}

/// <summary>
/// Polls the Windows 11 Live Captions window through UI Automation. The caption buffer is the
/// Name of the TextBlock with AutomationId "CaptionsTextBlock"; it is read as-is, never parsed
/// from the rest of the window.
/// </summary>
public sealed class LiveCaptionsReader : IDisposable
{
    const string WindowClass = "LiveCaptionsDesktopWindow";
    const string TextBlockId = "CaptionsTextBlock";
    static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(120);
    static readonly TimeSpan SearchInterval = TimeSpan.FromSeconds(1);

    readonly CancellationTokenSource _cts = new();
    readonly Thread _thread;
    AutomationElement? _textBlock;
    string? _lastText;
    CaptionSourceState? _lastState;

    /// <summary>Raised on a background thread with the full caption buffer whenever it changes.</summary>
    public event Action<string>? TextChanged;
    public event Action<CaptionSourceState>? StateChanged;

    public IntPtr WindowHandle { get; private set; }

    public LiveCaptionsReader()
    {
        _thread = new Thread(Run) { IsBackground = true, Name = "LiveCaptionsReader" };
    }

    public void Start() => _thread.Start();

    /// <summary>True when the Live Captions window is open (captions can only be read from it).</summary>
    public static bool IsWindowOpen() => NativeMethods.FindWindow(WindowClass, null) != IntPtr.Zero;

    /// <summary>
    /// Opens Live Captions with Windows' own shortcut, Win+Ctrl+L. Starting LiveCaptions.exe again
    /// does nothing when an earlier Live Captions process is still running without its window; the
    /// shortcut brings it back. It also toggles, so it is only sent while no window is open.
    /// </summary>
    public static void Launch()
    {
        if (IsWindowOpen())
        {
            return;
        }
        const byte LeftWin = 0x5B, Control = 0x11, L = 0x4C;
        NativeMethods.PressKeys(LeftWin, Control, L);
    }

    void Run()
    {
        var token = _cts.Token;
        var wait = token.WaitHandle;
        while (!token.IsCancellationRequested)
        {
            try
            {
                if (_textBlock == null && !TryAttach())
                {
                    // A UI Automation hiccup while the window is still open is not a restart: keep the
                    // last caption text, or the whole buffer would come back as new words.
                    if (!IsWindowOpen() || _lastState == null)
                    {
                        SetState(CaptionSourceState.NotRunning);
                    }
                    wait.WaitOne(SearchInterval);
                    continue;
                }

                string text;
                try
                {
                    text = _textBlock!.Current.Name ?? "";
                }
                catch (Exception ex) when (ex is ElementNotAvailableException or COMException or InvalidOperationException)
                {
                    // Window closed or recreated; find it again on the next pass.
                    _textBlock = null;
                    WindowHandle = IntPtr.Zero;
                    continue;
                }

                SetState(CaptionSourceState.Connected);
                if (text != _lastText)
                {
                    _lastText = text;
                    TextChanged?.Invoke(text);
                }
                wait.WaitOne(PollInterval);
            }
            catch (Exception ex)
            {
                // An unexpected UI Automation error must not end captioning (or the app): retry shortly.
                Log.Write($"Live Captions reader: {ex.GetType().Name}: {ex.Message}");
                _textBlock = null;
                WindowHandle = IntPtr.Zero;
                wait.WaitOne(SearchInterval);
            }
        }
    }

    bool TryAttach()
    {
        try
        {
            var window = AutomationElement.RootElement.FindFirst(
                TreeScope.Children,
                new PropertyCondition(AutomationElement.ClassNameProperty, WindowClass));
            if (window == null)
            {
                return false;
            }
            var textBlock = window.FindFirst(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.AutomationIdProperty, TextBlockId));
            if (textBlock == null)
            {
                return false;
            }
            WindowHandle = new IntPtr(window.Current.NativeWindowHandle);
            _textBlock = textBlock;
            return true;
        }
        catch (Exception ex) when (ex is ElementNotAvailableException or COMException or InvalidOperationException)
        {
            return false;
        }
    }

    void SetState(CaptionSourceState state)
    {
        if (_lastState == state)
        {
            return;
        }
        _lastState = state;
        if (state == CaptionSourceState.NotRunning)
        {
            // A restarted Live Captions starts with an empty buffer; report that so the
            // tracker begins a new block instead of aligning against stale text.
            _lastText = "";
            TextChanged?.Invoke("");
        }
        StateChanged?.Invoke(state);
    }

    public void Dispose()
    {
        _cts.Cancel();
        // A UI Automation call can block for a while; only release the token once the thread is done
        // with it (the thread is a background thread, so it never keeps the app alive).
        if (!_thread.IsAlive || _thread.Join(TimeSpan.FromSeconds(2)))
        {
            _cts.Dispose();
        }
    }
}
