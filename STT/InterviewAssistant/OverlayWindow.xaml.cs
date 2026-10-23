using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;

namespace InterviewAssistant;

/// <summary>
/// Interview view as a borderless, always-on-top window above the meeting. Only the background is
/// see-through (the slider sets its alpha); captions and answer stay solid, with a soft halo in the
/// background colour so they remain readable over video. The main window lends it the caption
/// panel and answer reader while it is shown.
/// </summary>
public partial class OverlayWindow : Window
{
    const double MinOpacity = 0.15;
    readonly AppSettings _settings;

    public event Action? ExitRequested;
    public event Action<UIElement>? MenuRequested;

    public OverlayWindow(AppSettings settings)
    {
        InitializeComponent();
        _settings = settings;
        // The slider shows how see-through the background is: 0 = solid, right = more see-through.
        OpacitySlider.Value = 1 - Math.Clamp(settings.OverlayOpacity, MinOpacity, 1);
        CaptionRow.Height = new GridLength(Math.Max(40, settings.OverlayCaptionHeight));

        var area = SystemParameters.WorkArea;
        var bounds = settings.OverlayBounds
            ?? new WindowBounds(area.Right - 560 - 24, area.Top + 80, 560, Math.Min(720, area.Height - 120));
        Left = Math.Clamp(bounds.Left, SystemParameters.VirtualScreenLeft,
            SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 100);
        Top = Math.Clamp(bounds.Top, SystemParameters.VirtualScreenTop,
            SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 100);
        Width = Math.Max(MinWidth, bounds.Width);
        Height = Math.Max(MinHeight, bounds.Height);

        OpacitySlider.ValueChanged += (_, e) =>
        {
            _settings.OverlayOpacity = Math.Round(1 - e.NewValue, 2);
            ApplyLook();
        };
        MenuButton.Click += (_, _) => MenuRequested?.Invoke(MenuButton);
        ExitButton.Click += (_, _) => ExitRequested?.Invoke();
        // Double-clicking the top bar (or Win+Up) would maximize a borderless window with no way back.
        StateChanged += (_, _) =>
        {
            if (WindowState == WindowState.Maximized)
            {
                WindowState = WindowState.Normal;
            }
        };
        ThemeManager.Changed += ApplyLook;
        ApplyLook();
    }

    public void Host(UIElement captions, UIElement reader)
    {
        CaptionSlot.Content = captions;
        ReaderSlot.Content = reader;
    }

    public void Release()
    {
        CaptionSlot.Content = null;
        ReaderSlot.Content = null;
    }

    /// <summary>Makes the background more (positive) or less (negative) see-through.</summary>
    public void ChangeTransparency(double delta) =>
        OpacitySlider.Value = Math.Clamp(OpacitySlider.Value + delta, OpacitySlider.Minimum, OpacitySlider.Maximum);

    public void SaveState()
    {
        if (CaptionRow.ActualHeight > 0)
        {
            _settings.OverlayCaptionHeight = CaptionRow.ActualHeight;
        }
        if (WindowState == WindowState.Normal && IsVisible)
        {
            _settings.OverlayBounds = new WindowBounds(Left, Top, Width, Height);
        }
    }

    public void SetCaptionsConnected(bool connected) =>
        LiveDot.SetResourceReference(Shape.FillProperty, connected ? "Success" : "Danger");

    void ApplyLook()
    {
        double opacity = Math.Clamp(_settings.OverlayOpacity, MinOpacity, 1);
        var background = ThemeManager.ColorOf("WindowBg");
        var border = ThemeManager.ColorOf("BorderStrong");
        Frame.Background = new SolidColorBrush(Color.FromArgb((byte)Math.Round(255 * opacity), background.R, background.G, background.B));
        Frame.BorderBrush = new SolidColorBrush(Color.FromArgb(170, border.R, border.G, border.B));
        OpacityLabel.Text = $"{Math.Round((1 - opacity) * 100)}%";

        // Over a busy or bright video, a halo in the background colour keeps every glyph legible.
        Body.Effect = opacity < 0.9
            ? new DropShadowEffect { Color = background, BlurRadius = 8, ShadowDepth = 0, Opacity = 1, RenderingBias = RenderingBias.Quality }
            : null;
    }

    protected override void OnClosed(EventArgs e)
    {
        ThemeManager.Changed -= ApplyLook;
        base.OnClosed(e);
    }
}
