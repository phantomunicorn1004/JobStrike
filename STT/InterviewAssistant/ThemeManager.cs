using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;

namespace InterviewAssistant;

public enum AppTheme
{
    Dark,
    Light,
    /// <summary>Follows the Windows "app mode" setting (Settings → Personalization → Colors).</summary>
    System,
}

/// <summary>
/// Swaps the colour brushes in the application resources. XAML refers to them with
/// DynamicResource, so every window updates immediately when the theme changes.
/// </summary>
public static class ThemeManager
{
    // Dark: low-glare slate. Light: soft paper tones rather than pure white, same calm blue accent.
    static readonly (string Key, string Dark, string Light)[] Palette =
    [
        ("WindowBg", "#14161B", "#F3F4F7"),
        ("PanelBg", "#191C22", "#EBEDF1"),
        ("Surface", "#1F232B", "#FAFBFC"),
        ("InputBg", "#1B1F26", "#FFFFFF"),
        ("HoverBg", "#272C36", "#E1E5EC"),
        ("PressedBg", "#2E3440", "#D6DCE5"),
        ("Border", "#2A2F38", "#D3D8E0"),
        ("BorderStrong", "#3A414D", "#B9C1CD"),
        ("Text", "#D5DBE5", "#2A3140"),
        ("Strong", "#F0F3F8", "#10141B"),
        ("Muted", "#8B94A5", "#5F6878"),
        ("Faint", "#5F6878", "#8A93A2"),
        ("Accent", "#7DA2F5", "#3A60C6"),
        ("AccentDim", "#34508F", "#3A60C6"),
        ("AccentBorder", "#4F6DBF", "#2F53B3"),
        ("AccentHover", "#3D5DA6", "#486ED4"),
        ("Highlight", "#A9C3FF", "#2C52B5"),
        ("PendingBg", "#22304D", "#DBE5FA"),
        ("Success", "#6FCF97", "#2C9A58"),
        ("Danger", "#E87E7E", "#C74646"),
        ("ScrollThumb", "#343B47", "#C3C9D3"),
        ("ScrollThumbHover", "#4A5263", "#A6AFBC"),
    ];

    public static bool IsDark { get; private set; } = true;

    public static event Action? Changed;

    static AppTheme _current = AppTheme.Dark;

    public static void Apply(AppTheme theme)
    {
        _current = theme;
        IsDark = theme switch
        {
            AppTheme.Light => false,
            AppTheme.System => !WindowsUsesLightTheme(),
            _ => true,
        };
        var resources = Application.Current.Resources;
        foreach (var (key, dark, light) in Palette)
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(IsDark ? dark : light));
            brush.Freeze();
            resources[key] = brush;
        }
        foreach (Window window in Application.Current.Windows)
        {
            NativeMethods.ApplyWindowChrome(window);
        }
        Changed?.Invoke();
    }

    /// <summary>Re-applies "Match Windows" when the user switches Windows between light and dark.</summary>
    public static void WatchSystemTheme()
    {
        SystemEvents.UserPreferenceChanged += (_, e) =>
        {
            if (e.Category == UserPreferenceCategory.General && _current == AppTheme.System)
            {
                Application.Current.Dispatcher.BeginInvoke(() => Apply(AppTheme.System));
            }
        };
    }

    public static Color ColorOf(string key) => ((SolidColorBrush)Application.Current.Resources[key]).Color;

    static bool WindowsUsesLightTheme()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int value && value == 1;
    }
}
