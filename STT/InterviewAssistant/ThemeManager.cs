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
    // Dark: deep ink with a violet tint. Light: soft lavender paper with white cards. One friendly
    // violet accent, plus pastel pairs (background, glyph) for icon chips.
    static readonly (string Key, string Dark, string Light)[] Palette =
    [
        ("WindowBg", "#15131F", "#F4F3FA"),
        ("PanelBg", "#1C1A29", "#FFFFFF"),
        ("Surface", "#242236", "#FFFFFF"),
        ("InputBg", "#18162A", "#F9F8FD"),
        ("TrackBg", "#121020", "#EDEBF6"),
        ("HoverBg", "#2B2842", "#F0EEFB"),
        ("PressedBg", "#353150", "#E4E0F8"),
        ("Border", "#2E2B45", "#E6E3F1"),
        ("BorderStrong", "#45405F", "#D0CBE4"),
        ("Text", "#DEDBF0", "#2D2944"),
        ("Strong", "#F7F5FF", "#17142B"),
        ("Muted", "#9C97B8", "#6B6688"),
        ("Faint", "#6C6788", "#9C97B4"),
        ("Accent", "#AA9EFF", "#6A58E6"),
        ("AccentDim", "#6C5CE7", "#6C5CE7"),
        ("AccentBorder", "#4A3CC0", "#4F3FD0"),
        ("AccentHover", "#7E70F2", "#7D6EF0"),
        ("Highlight", "#C8BFFF", "#5442D6"),
        ("PendingBg", "#29244E", "#EFECFF"),
        ("GradStart", "#8B7BFF", "#8473FF"),
        ("GradEnd", "#5B5CE6", "#5A55E3"),
        ("Success", "#4ADE9B", "#16A06F"),
        ("Danger", "#FF7A80", "#E0444B"),
        ("ScrollThumb", "#3A3654", "#D6D2E8"),
        ("ScrollThumbHover", "#544E72", "#B8B2D4"),
        ("LilacBg", "#2C2654", "#ECE8FF"),
        ("LilacFg", "#B5AAFF", "#6A58E6"),
        ("MintBg", "#173A31", "#DCF6EB"),
        ("MintFg", "#5FE0A9", "#13996A"),
        ("PeachBg", "#45291F", "#FFE7DC"),
        ("PeachFg", "#FFA27E", "#D9602F"),
        ("SkyBg", "#182D47", "#DDEEFF"),
        ("SkyFg", "#7CBCFF", "#2575CF"),
        ("SunBg", "#3D3318", "#FFF2C7"),
        ("SunFg", "#FFD36B", "#B07D05"),
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
