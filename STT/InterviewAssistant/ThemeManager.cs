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
    // Dark: graphite. Light: cool paper with white panels. One blue accent; green, amber and red
    // only for status. The icon-tile pairs are quiet neutrals, with the accent pair for the main item.
    static readonly (string Key, string Dark, string Light)[] Palette =
    [
        ("WindowBg", "#0F1115", "#F5F6F8"),
        ("PanelBg", "#15181E", "#FFFFFF"),
        ("Surface", "#1B1F26", "#FFFFFF"),
        ("InputBg", "#12151A", "#F8F9FB"),
        ("TrackBg", "#0C0E12", "#EEF0F3"),
        ("HoverBg", "#222731", "#F0F2F5"),
        ("PressedBg", "#2A303B", "#E4E7EC"),
        ("Border", "#262B34", "#E3E6EB"),
        ("BorderStrong", "#353C48", "#CBD1DA"),
        ("Text", "#D9DEE7", "#1F2633"),
        ("Strong", "#F3F5F9", "#0D121B"),
        ("Muted", "#8C95A6", "#5D6676"),
        ("Faint", "#5E6777", "#8C95A4"),
        ("Accent", "#7AB2FF", "#2563EB"),
        ("AccentDim", "#2F6FDB", "#2563EB"),
        ("AccentBorder", "#255BB5", "#1D4FBF"),
        ("AccentHover", "#3B7BE6", "#3B74F0"),
        ("Highlight", "#A8CBFF", "#1D4ED8"),
        ("PendingBg", "#18263D", "#EAF1FE"),
        ("GradStart", "#3478E8", "#2F6FEA"),
        ("GradEnd", "#2F6FDB", "#2563EB"),
        ("Success", "#3FCF8E", "#12925C"),
        ("Warning", "#F2B24C", "#B7791F"),
        ("Danger", "#F2676A", "#D23F44"),
        ("ScrollThumb", "#2E343F", "#CDD2DA"),
        ("ScrollThumbHover", "#454D5B", "#AEB5C1"),
        ("LilacBg", "#1A2A44", "#E8F0FE"),
        ("LilacFg", "#7AB2FF", "#2563EB"),
        ("MintBg", "#1E232B", "#F0F2F5"),
        ("MintFg", "#9AA4B5", "#4B5563"),
        ("PeachBg", "#1E232B", "#F0F2F5"),
        ("PeachFg", "#9AA4B5", "#4B5563"),
        ("SkyBg", "#1E232B", "#F0F2F5"),
        ("SkyFg", "#9AA4B5", "#4B5563"),
        ("SunBg", "#1E232B", "#F0F2F5"),
        ("SunFg", "#9AA4B5", "#4B5563"),
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
        var gradient = new LinearGradientBrush(ColorOf("GradStart"), ColorOf("GradEnd"), new Point(0, 0), new Point(1, 1));
        gradient.Freeze();
        resources["AccentGradient"] = gradient;
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
