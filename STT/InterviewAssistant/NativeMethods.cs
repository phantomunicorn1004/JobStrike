using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace InterviewAssistant;

static partial class NativeMethods
{
    public const int WmHotkey = 0x0312;
    public const uint ModNoRepeat = 0x4000;

    const uint CfUnicodeText = 13;
    const uint GmemMoveable = 0x0002;

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool OpenClipboard(IntPtr owner);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CloseClipboard();

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool EmptyClipboard();

    [LibraryImport("user32.dll")]
    private static partial IntPtr SetClipboardData(uint format, IntPtr data);

    [LibraryImport("kernel32.dll")]
    private static partial IntPtr GlobalAlloc(uint flags, nuint bytes);

    [LibraryImport("kernel32.dll")]
    private static partial IntPtr GlobalLock(IntPtr memory);

    [LibraryImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GlobalUnlock(IntPtr memory);

    [LibraryImport("kernel32.dll")]
    private static partial IntPtr GlobalFree(IntPtr memory);

    /// <summary>
    /// Puts text on the clipboard with the plain Windows calls. WPF's Clipboard also "flushes" the
    /// data afterwards, which fails (after blocking for seconds) when clipboard history or a
    /// clipboard manager opens the clipboard right after the change, although the text is already in.
    /// Only opening the clipboard is retried, briefly, if another app holds it at that moment.
    /// </summary>
    public static bool SetClipboardText(IntPtr owner, string text)
    {
        bool opened = false;
        for (int attempt = 0; attempt < 10 && !(opened = OpenClipboard(owner)); attempt++)
        {
            Thread.Sleep(20);
        }
        if (!opened)
        {
            return false;
        }
        try
        {
            EmptyClipboard();
            nuint bytes = (nuint)((text.Length + 1) * 2);
            IntPtr memory = GlobalAlloc(GmemMoveable, bytes);
            if (memory == IntPtr.Zero)
            {
                return false;
            }
            IntPtr target = GlobalLock(memory);
            if (target == IntPtr.Zero)
            {
                GlobalFree(memory);
                return false;
            }
            Marshal.Copy(text.ToCharArray(), 0, target, text.Length);
            Marshal.WriteInt16(target, text.Length * 2, 0);
            GlobalUnlock(memory);
            if (SetClipboardData(CfUnicodeText, memory) == IntPtr.Zero)
            {
                GlobalFree(memory); // still ours only when Windows did not take it
                return false;
            }
            return true;
        }
        finally
        {
            CloseClipboard();
        }
    }

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool UnregisterHotKey(IntPtr hWnd, int id);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect
    {
        public int Left, Top, Right, Bottom;
    }

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

    public const uint SwpNoSize = 0x0001;
    public const uint SwpNoZOrder = 0x0004;
    public const uint SwpNoActivate = 0x0010;

    [LibraryImport("user32.dll", EntryPoint = "FindWindowW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial IntPtr FindWindow(string? className, string? windowName);

    [LibraryImport("user32.dll")]
    public static partial void keybd_event(byte vk, byte scan, uint flags, UIntPtr extraInfo);

    /// <summary>Presses a key combination system-wide (keys down in order, then up in reverse).</summary>
    public static void PressKeys(params byte[] keys)
    {
        const uint KeyUp = 0x0002;
        foreach (byte key in keys)
        {
            keybd_event(key, 0, 0, UIntPtr.Zero);
        }
        for (int i = keys.Length - 1; i >= 0; i--)
        {
            keybd_event(keys[i], 0, KeyUp, UIntPtr.Zero);
        }
    }

    public delegate IntPtr LowLevelKeyboardProc(int code, IntPtr message, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    public struct KbdLlHookStruct
    {
        public uint VkCode, ScanCode, Flags, Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Msg
    {
        public IntPtr Hwnd;
        public uint Message;
        public IntPtr WParam, LParam;
        public uint Time;
        public int X, Y;
    }

    [LibraryImport("user32.dll", EntryPoint = "SetWindowsHookExW", SetLastError = true)]
    public static partial IntPtr SetWindowsHookEx(int hookType, IntPtr proc, IntPtr module, uint threadId);

    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool UnhookWindowsHookEx(IntPtr hook);

    [LibraryImport("user32.dll")]
    public static partial IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

    [LibraryImport("user32.dll")]
    public static partial short GetAsyncKeyState(int vk);

    [LibraryImport("user32.dll", EntryPoint = "GetMessageW")]
    public static partial int GetMessage(out Msg msg, IntPtr hwnd, uint filterMin, uint filterMax);

    [LibraryImport("user32.dll", EntryPoint = "PostThreadMessageW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);

    [LibraryImport("kernel32.dll")]
    public static partial uint GetCurrentThreadId();

    [LibraryImport("kernel32.dll", EntryPoint = "GetModuleHandleW", StringMarshalling = StringMarshalling.Utf16)]
    public static partial IntPtr GetModuleHandle(string? name);

    [LibraryImport("user32.dll")]
    public static partial IntPtr GetForegroundWindow();

    [LibraryImport("user32.dll")]
    public static partial uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    /// <summary>Process name of the window in front, for the log.</summary>
    [LibraryImport("user32.dll", EntryPoint = "GetWindowTextW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial int GetWindowText(IntPtr hWnd, [Out] char[] text, int maxCount);

    /// <summary>A window's title (for another process's window this reads the stored title, no message is sent).</summary>
    public static string WindowTitle(IntPtr hwnd)
    {
        var buffer = new char[256];
        int length = GetWindowText(hwnd, buffer, buffer.Length);
        return length > 0 ? new string(buffer, 0, length) : "";
    }

    public static string ForegroundAppName()
    {
        GetWindowThreadProcessId(GetForegroundWindow(), out uint pid);
        return ProcessName(pid) is { Length: > 0 } name ? name : "an unknown app";
    }

    /// <summary>A process's name such as "chrome", or "" when it cannot be read.</summary>
    public static string ProcessName(uint pid)
    {
        try
        {
            return System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
        }
        catch (Exception)
        {
            return "";
        }
    }

    [LibraryImport("dwmapi.dll")]
    public static partial int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    const int DwmwaUseImmersiveDarkMode = 20;
    const int DwmwaBorderColor = 34;
    const int DwmwaCaptionColor = 35;
    const int DwmwaTextColor = 36;

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    const uint WdaNone = 0x00000000;
    const uint WdaExcludeFromCapture = 0x00000011;

    /// <summary>
    /// Hides or unhides a window from screen capture, screenshots and screen
    /// sharing (Windows 10 2004+). When hidden the window is visible on the
    /// physical display but shows as black in any capture.
    /// </summary>
    public static bool SetCaptureExclusion(IntPtr hwnd, bool exclude) =>
        SetWindowDisplayAffinity(hwnd, exclude ? WdaExcludeFromCapture : WdaNone);

    /// <summary>
    /// Title bar in the current theme's panel colour, so it joins the toolbar (Windows 11; older versions keep the dark/light
    /// mode flag and ignore the colours).
    /// </summary>
    public static void ApplyWindowChrome(System.Windows.Window window)
    {
        IntPtr hwnd = new WindowInteropHelper(window).EnsureHandle();
        int dark = ThemeManager.IsDark ? 1 : 0;
        DwmSetWindowAttribute(hwnd, DwmwaUseImmersiveDarkMode, ref dark, sizeof(int));
        int caption = ColorRef(ThemeManager.ColorOf("PanelBg"));
        int border = ColorRef(ThemeManager.ColorOf("Border"));
        int text = ColorRef(ThemeManager.ColorOf("Text"));
        DwmSetWindowAttribute(hwnd, DwmwaCaptionColor, ref caption, sizeof(int));
        DwmSetWindowAttribute(hwnd, DwmwaBorderColor, ref border, sizeof(int));
        DwmSetWindowAttribute(hwnd, DwmwaTextColor, ref text, sizeof(int));
    }

    static int ColorRef(System.Windows.Media.Color c) => c.R | (c.G << 8) | (c.B << 16);
}

/// <summary>
/// System-wide hotkeys that work while another app (the meeting) has focus. A combination is
/// reserved with RegisterHotKey and also caught by a low-level keyboard hook: keyboard tools that
/// hook the keyboard themselves (hotkey managers, remapping and capture software) can swallow a key
/// before Windows checks registered hotkeys, but a newer hook sees the key before theirs.
/// RegisterHotKey still fires if the hook is unavailable.
/// </summary>
sealed class GlobalHotkeys : IDisposable
{
    readonly HwndSource _source;
    readonly Dictionary<int, (Hotkey Hotkey, Action Action, bool Activates, bool Scoped)> _actions = [];
    readonly KeyboardHook _hook;
    int _nextId = 0x5100;

    public GlobalHotkeys(IntPtr windowHandle)
    {
        _source = HwndSource.FromHwnd(windowHandle);
        _source.AddHook(WndProc);
        _hook = new KeyboardHook(id => _source.Dispatcher.BeginInvoke(() => Fire(id, "keyboard")));
    }

    /// <summary>Words (app names or window titles) where scoped hotkeys work; see <see cref="Register"/>.</summary>
    public void SetScope(string words) => _hook.SetScope(words);

    /// <summary>
    /// Returns false if another app already owns the combination. <paramref name="activates"/> marks an
    /// action that brings a window to the front: Windows only allows that after a real WM_HOTKEY, so
    /// such a combination is left to RegisterHotKey alone. A <paramref name="scoped"/> hotkey (an
    /// everyday shortcut such as Ctrl+X) is handled by the keyboard hook only, and only while Interview
    /// Assistant or an app in the scope is in front; everywhere else the key keeps its normal job.
    /// (Registered with Windows it would be taken from every app.)
    /// </summary>
    public bool Register(Hotkey hotkey, Action action, bool activates = false, bool scoped = false)
    {
        scoped &= !activates && !_hook.Failed;
        int id = _nextId++;
        bool ok = NativeMethods.RegisterHotKey(
            _source.Handle, id, hotkey.NativeModifiers | NativeMethods.ModNoRepeat, hotkey.VirtualKey);
        if (ok)
        {
            if (scoped)
            {
                NativeMethods.UnregisterHotKey(_source.Handle, id); // registered only to see that no other app owns it
            }
            _actions[id] = (hotkey, action, activates, scoped);
            UpdateHook();
        }
        return ok;
    }

    public void UnregisterAll()
    {
        foreach (var (id, entry) in _actions)
        {
            if (!entry.Scoped)
            {
                NativeMethods.UnregisterHotKey(_source.Handle, id);
            }
        }
        _actions.Clear();
        UpdateHook();
    }

    void UpdateHook() => _hook.Combos = _actions.Where(a => !a.Value.Activates)
        .Select(a => (a.Value.Hotkey.NativeModifiers, a.Value.Hotkey.VirtualKey, a.Key, a.Value.Scoped)).ToArray();

    IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == NativeMethods.WmHotkey && _actions.ContainsKey(wParam.ToInt32()))
        {
            Fire(wParam.ToInt32(), "system");
            handled = true;
        }
        return IntPtr.Zero;
    }

    void Fire(int id, string via)
    {
        if (_actions.TryGetValue(id, out var entry))
        {
            Log.Write($"Hotkey {entry.Hotkey} ({via}) while {NativeMethods.ForegroundAppName()} is in front");
            entry.Action();
        }
    }

    public void Dispose()
    {
        _hook.Dispose();
        UnregisterAll();
        _source.RemoveHook(WndProc);
    }
}

/// <summary>
/// WH_KEYBOARD_LL hook on its own thread (so a busy UI thread can never make Windows drop it) that
/// swallows the registered combinations and reports them by id.
/// </summary>
sealed class KeyboardHook : IDisposable
{
    const int WhKeyboardLl = 13;
    const int WmKeyDown = 0x0100, WmKeyUp = 0x0101, WmSysKeyDown = 0x0104, WmSysKeyUp = 0x0105;
    const uint WmQuit = 0x0012;
    const uint MaskKey = 0xE8; // unassigned; tapped so a swallowed Alt/Win combination does not open a menu

    readonly Action<int> _pressed;
    readonly NativeMethods.LowLevelKeyboardProc _proc; // kept alive while the hook is installed
    readonly Thread _thread;
    readonly HashSet<uint> _swallowed = [];
    volatile uint _threadId;

    /// <summary>(modifiers as RegisterHotKey takes them, virtual key, id, scoped); replaced as a whole.</summary>
    public volatile (uint Modifiers, uint Key, int Id, bool Scoped)[] Combos = [];

    /// <summary>
    /// True when Windows refused the hook; hotkeys then rely on RegisterHotKey alone. Waits (briefly)
    /// until the hook thread has tried, so hotkeys registered right after start-up see the outcome.
    /// </summary>
    public bool Failed
    {
        get
        {
            _tried.Wait(TimeSpan.FromSeconds(2));
            return _failed;
        }
    }

    readonly ManualResetEventSlim _tried = new();
    volatile bool _failed;

    // Where scoped combinations act as hotkeys: this app, Live Captions, and apps whose name or
    // window title contains one of the user's words (whole words, so "Meet" is not "Meeting notes").
    static readonly uint OwnProcessId = (uint)Environment.ProcessId;
    volatile System.Text.RegularExpressions.Regex? _scope;
    readonly Dictionary<uint, string> _processNames = [];

    public void SetScope(string words)
    {
        var parts = (words ?? "").Split([',', ';', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Append("LiveCaptions").Select(System.Text.RegularExpressions.Regex.Escape);
        _scope = new System.Text.RegularExpressions.Regex($@"\b(?:{string.Join("|", parts)})\b",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    }

    /// <summary>Runs on the hook thread for every scoped combination pressed, so it stays quick.</summary>
    bool InScope()
    {
        IntPtr window = NativeMethods.GetForegroundWindow();
        NativeMethods.GetWindowThreadProcessId(window, out uint pid);
        if (pid == OwnProcessId)
        {
            return true;
        }
        if (!_processNames.TryGetValue(pid, out string? name))
        {
            name = NativeMethods.ProcessName(pid);
            if (_processNames.Count > 200)
            {
                _processNames.Clear();
            }
            _processNames[pid] = name;
        }
        var scope = _scope;
        return scope != null && (scope.IsMatch(name) || scope.IsMatch(NativeMethods.WindowTitle(window)));
    }

    public KeyboardHook(Action<int> pressed)
    {
        _pressed = pressed;
        _proc = HookProc;
        // Every key press on the system waits for this thread, so it must never queue behind others.
        _thread = new Thread(Run) { IsBackground = true, Name = "KeyboardHook", Priority = ThreadPriority.Highest };
        _thread.Start();
    }

    void Run()
    {
        _threadId = NativeMethods.GetCurrentThreadId();
        IntPtr hook = NativeMethods.SetWindowsHookEx(WhKeyboardLl, Marshal.GetFunctionPointerForDelegate(_proc),
            NativeMethods.GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero)
        {
            _failed = true;
            _tried.Set();
            Log.Write($"Keyboard hook unavailable (error {Marshal.GetLastPInvokeError()}); hotkeys use Windows' hotkey list only.");
            return;
        }
        _tried.Set();
        while (NativeMethods.GetMessage(out _, IntPtr.Zero, 0, 0) > 0)
        {
        }
        NativeMethods.UnhookWindowsHookEx(hook);
    }

    IntPtr HookProc(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            var info = Marshal.PtrToStructure<NativeMethods.KbdLlHookStruct>(data);
            int msg = message.ToInt32();
            bool down = msg is WmKeyDown or WmSysKeyDown;
            if (info.VkCode != MaskKey && (down || msg is WmKeyUp or WmSysKeyUp))
            {
                if (!down)
                {
                    if (_swallowed.Remove(info.VkCode))
                    {
                        return 1; // the app in front never saw the key go down either
                    }
                }
                else if (_swallowed.Contains(info.VkCode))
                {
                    return 1; // auto-repeat of a held hotkey
                }
                else
                {
                    uint modifiers = CurrentModifiers();
                    uint vk = NormalizeKey(info.VkCode);
                    foreach (var (mods, key, id, scoped) in Combos)
                    {
                        // "+" and "-" can be typed several ways: the keys next to Backspace (with or
                        // without Shift, since "+" is Shift+=) or the numeric keypad. All of them count.
                        bool plusMinus = key is VkOemPlus or VkOemMinus;
                        uint wanted = plusMinus ? mods & ~ShiftBit : mods;
                        uint pressed = plusMinus ? modifiers & ~ShiftBit : modifiers;
                        if (key == vk && wanted == pressed)
                        {
                            if (scoped && !InScope())
                            {
                                break; // an everyday shortcut outside the meeting: the app in front gets it
                            }
                            _swallowed.Add(info.VkCode);
                            if ((modifiers & 0x2) == 0 && (modifiers & 0x9) != 0)
                            {
                                NativeMethods.keybd_event((byte)MaskKey, 0, 0, UIntPtr.Zero);
                                NativeMethods.keybd_event((byte)MaskKey, 0, 0x2, UIntPtr.Zero);
                            }
                            _pressed(id);
                            return 1;
                        }
                    }
                }
            }
        }
        return NativeMethods.CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    const uint VkOemPlus = 0xBB, VkOemMinus = 0xBD, VkAdd = 0x6B, VkSubtract = 0x6D, ShiftBit = 0x4;

    /// <summary>The keypad's + and - act like the main keyboard's = (+) and - keys.</summary>
    static uint NormalizeKey(uint vk) => vk switch
    {
        VkAdd => VkOemPlus,
        VkSubtract => VkOemMinus,
        _ => vk,
    };

    /// <summary>Alt 1, Ctrl 2, Shift 4, Win 8, as RegisterHotKey takes them.</summary>
    static uint CurrentModifiers()
    {
        static bool Down(int vk) => NativeMethods.GetAsyncKeyState(vk) < 0;
        return (Down(0x12) ? 0x1u : 0) | (Down(0x11) ? 0x2u : 0) | (Down(0x10) ? 0x4u : 0)
            | (Down(0x5B) || Down(0x5C) ? 0x8u : 0);
    }

    public void Dispose()
    {
        if (_threadId != 0)
        {
            NativeMethods.PostThreadMessage(_threadId, WmQuit, IntPtr.Zero, IntPtr.Zero);
        }
    }
}

/// <summary>
/// Moves the Live Captions window off-screen (it keeps captioning) and puts it back later.
/// </summary>
sealed class LiveCaptionsWindowMover
{
    const int OffscreenX = -32000;
    IntPtr _hwnd;
    NativeMethods.Rect? _original;

    public bool IsHidden => _original != null;

    public void Hide(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || (IsHidden && hwnd == _hwnd))
        {
            return;
        }
        if (!NativeMethods.GetWindowRect(hwnd, out var rect))
        {
            return;
        }
        if (rect.Left <= OffscreenX / 2)
        {
            // Already off-screen (e.g. left there by a previous run): restore to a visible spot.
            rect = new NativeMethods.Rect { Left = 100, Top = 100, Right = 700, Bottom = 340 };
        }
        _hwnd = hwnd;
        _original = rect;
        NativeMethods.SetWindowPos(hwnd, IntPtr.Zero, OffscreenX, rect.Top, 0, 0,
            NativeMethods.SwpNoSize | NativeMethods.SwpNoZOrder | NativeMethods.SwpNoActivate);
    }

    public void Restore()
    {
        if (_original is { } rect && _hwnd != IntPtr.Zero)
        {
            NativeMethods.SetWindowPos(_hwnd, IntPtr.Zero, rect.Left, rect.Top, 0, 0,
                NativeMethods.SwpNoSize | NativeMethods.SwpNoZOrder | NativeMethods.SwpNoActivate);
        }
        _original = null;
        _hwnd = IntPtr.Zero;
    }
}
