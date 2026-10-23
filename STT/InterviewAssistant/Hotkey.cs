using System.Windows.Input;

namespace InterviewAssistant;

/// <summary>A global hotkey such as "Ctrl+Alt+S" or "F9", stored in settings as text.</summary>
public readonly record struct Hotkey(ModifierKeys Modifiers, Key Key)
{
    static readonly (ModifierKeys Flag, string Name)[] ModifierNames =
    [
        (ModifierKeys.Control, "Ctrl"),
        (ModifierKeys.Alt, "Alt"),
        (ModifierKeys.Shift, "Shift"),
        (ModifierKeys.Windows, "Win"),
    ];

    /// <summary>Function keys may be used alone; anything else needs Ctrl, Alt or Win so typing is not hijacked.</summary>
    public bool IsValid =>
        Key != Key.None && !IsModifierKey(Key)
        && ((Modifiers & ~ModifierKeys.Shift) != ModifierKeys.None || Key is >= Key.F1 and <= Key.F24);

    public uint NativeModifiers =>
        ((Modifiers & ModifierKeys.Alt) != 0 ? 0x1u : 0)
        | ((Modifiers & ModifierKeys.Control) != 0 ? 0x2u : 0)
        | ((Modifiers & ModifierKeys.Shift) != 0 ? 0x4u : 0)
        | ((Modifiers & ModifierKeys.Windows) != 0 ? 0x8u : 0);

    public uint VirtualKey => (uint)KeyInterop.VirtualKeyFromKey(Key);

    public override string ToString()
    {
        var modifiers = Modifiers;
        var parts = ModifierNames.Where(m => (modifiers & m.Flag) != 0).Select(m => m.Name).ToList();
        parts.Add(KeyName(Key));
        return string.Join("+", parts);
    }

    public static bool TryParse(string? text, out Hotkey hotkey)
    {
        hotkey = default;
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }
        var modifiers = ModifierKeys.None;
        Key key = Key.None;
        foreach (string raw in text.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var modifier = ModifierNames.FirstOrDefault(m => m.Name.Equals(raw, StringComparison.OrdinalIgnoreCase)
                || (m.Flag == ModifierKeys.Control && raw.Equals("Control", StringComparison.OrdinalIgnoreCase)));
            if (modifier.Name != null)
            {
                modifiers |= modifier.Flag;
            }
            else if (raw.Length == 1 && char.IsDigit(raw[0]))
            {
                key = Key.D0 + (raw[0] - '0');
            }
            else if (raw is "=" or "-")
            {
                key = raw == "=" ? Key.OemPlus : Key.OemMinus;
            }
            else if (!Enum.TryParse(raw, ignoreCase: true, out key))
            {
                return false;
            }
        }
        hotkey = new Hotkey(modifiers, key);
        return hotkey.IsValid;
    }

    public static bool IsModifierKey(Key key) => key is Key.LeftCtrl or Key.RightCtrl or Key.LeftAlt or Key.RightAlt
        or Key.LeftShift or Key.RightShift or Key.LWin or Key.RWin;

    static string KeyName(Key key) => key switch
    {
        >= Key.D0 and <= Key.D9 => ((int)(key - Key.D0)).ToString(),
        Key.Enter => "Enter", // same value as Key.Return
        Key.PageDown => "PageDown", // same value as Key.Next
        Key.PageUp => "PageUp", // same value as Key.Prior
        Key.OemPlus => "=", // the "= +" key next to Backspace
        Key.OemMinus => "-",
        _ => key.ToString(),
    };
}
