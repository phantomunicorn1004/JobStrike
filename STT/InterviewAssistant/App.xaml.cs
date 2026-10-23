using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Threading;

namespace InterviewAssistant;

public partial class App : Application
{
    Mutex? _singleInstance;

    /// <summary>
    /// Two copies on the same data folder would fight over the browser profile, the hotkeys and the
    /// settings file, so a second launch only tells the user the app is already open. The main
    /// window is created here (not via StartupUri) so a second copy never builds one.
    /// </summary>
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(AppSettings.DataFolder.ToLowerInvariant()));
        string name = "InterviewAssistant-" + Convert.ToHexString(hash, 0, 8);
        _singleInstance = new Mutex(initiallyOwned: true, name, out bool createdNew);
        if (!createdNew)
        {
            MessageBox.Show("Interview Assistant is already running. Check the taskbar.", "Interview Assistant");
            Shutdown();
            return;
        }

        // An unexpected error during an interview is logged; the app keeps running.
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            Log.Write($"Unobserved task error: {args.Exception}");
            args.SetObserved();
        };
        AppDomain.CurrentDomain.UnhandledException += (_, args) => Log.Write($"Fatal error: {args.ExceptionObject}");

        // Colours first, so no window ever shows the wrong theme.
        ThemeManager.Apply(AppSettings.Load().Theme);
        ThemeManager.WatchSystemTheme();
        // Every window (main, Settings, caption window, overlay, sign-in popups) gets a matching title bar.
        EventManager.RegisterClassHandler(typeof(Window), FrameworkElement.LoadedEvent,
            new RoutedEventHandler((sender, _) => NativeMethods.ApplyWindowChrome((Window)sender)));

        MainWindow = new MainWindow();
        MainWindow.Show();
    }

    protected override void OnSessionEnding(SessionEndingCancelEventArgs e)
    {
        (MainWindow as MainWindow)?.SaveForExit();
        base.OnSessionEnding(e);
    }

    static void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        Log.Write($"Unexpected error: {e.Exception}");
        e.Handled = true;
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _singleInstance?.Dispose();
        base.OnExit(e);
    }
}
