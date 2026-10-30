using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;

namespace InterviewAssistant;

/// <summary>
/// Signs in to JobStrike (once) and lets the user pick the application they are interviewing for.
/// On Load, <see cref="Result"/> holds the application with its resume text and profile details.
/// </summary>
public partial class JobStrikeWindow : Window
{
    readonly AppSettings _settings;
    readonly JobStrikeClient _client;
    readonly DispatcherTimer _searchDelay;
    readonly CancellationTokenSource _closing = new();
    CancellationTokenSource? _listing;
    Dictionary<string, string> _stageNames = [];

    public JobStrikeDetails? Result { get; private set; }

    /// <summary>Whether the profile details should replace "My profile".</summary>
    public bool ReplaceProfile => ProfileToggle.IsChecked == true;

    public JobStrikeWindow(AppSettings settings, bool profileIsEmpty)
    {
        InitializeComponent();
        _settings = settings;
        _client = new JobStrikeClient(settings);
        ProfileToggle.IsChecked = profileIsEmpty;
        SiteText.Text = new Uri(settings.JobStrikeUrl).Host;
        UserBox.Text = settings.JobStrikeUser;
        _searchDelay = new DispatcherTimer(TimeSpan.FromMilliseconds(400), DispatcherPriority.Normal,
            (_, _) => { _searchDelay!.Stop(); _ = RefreshListAsync(); }, Dispatcher);
        _searchDelay.Stop();
        Closed += (_, _) =>
        {
            // Work still running when the window closes is dropped; the client is released after.
            _searchDelay.Stop();
            _closing.Cancel();
            _listing?.Cancel();
            _client.Dispose();
        };
        Loaded += (_, _) => ShowState();
    }

    void ShowState()
    {
        bool signedIn = _client.IsSignedIn;
        SignInPanel.Visibility = signedIn ? Visibility.Collapsed : Visibility.Visible;
        ListPanel.Visibility = signedIn ? Visibility.Visible : Visibility.Collapsed;
        LoadButton.Visibility = signedIn ? Visibility.Visible : Visibility.Collapsed;
        FooterText.Text = signedIn ? ListHint : "";
        if (signedIn)
        {
            SignedInText.Text = $"Signed in as {_settings.JobStrikeUser}";
            if (FilterInterview.IsChecked != true && FilterScreening.IsChecked != true && FilterAll.IsChecked != true)
            {
                FilterInterview.IsChecked = true; // loads the list
            }
            else
            {
                _ = RefreshListAsync();
            }
            SearchBox.Focus();
        }
        else
        {
            (UserBox.Text.Length == 0 ? (Control)UserBox : PasswordBox).Focus();
        }
    }

    // ---------------------------------------------------------------- sign in

    void OnPasswordKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && SignInButton.IsEnabled)
        {
            OnSignInClick(sender, e);
        }
    }

    async void OnSignInClick(object sender, RoutedEventArgs e)
    {
        if (UserBox.Text.Trim().Length == 0 || PasswordBox.Password.Length == 0)
        {
            ShowSignInError("Enter your JobStrike username and password.");
            return;
        }
        SignInButton.IsEnabled = false;
        SignInButton.Content = "Signing in…";
        SignInError.Visibility = Visibility.Collapsed;
        try
        {
            await _client.SignInAsync(UserBox.Text.Trim(), PasswordBox.Password);
            PasswordBox.Clear();
            Log.Write($"Signed in to JobStrike as {_settings.JobStrikeUser}");
            ShowState();
        }
        catch (JobStrikeException ex)
        {
            ShowSignInError(ex.Message);
        }
        finally
        {
            SignInButton.IsEnabled = true;
            SignInButton.Content = "Sign in";
        }
    }

    void ShowSignInError(string message)
    {
        SignInError.Text = message;
        SignInError.Visibility = Visibility.Visible;
    }

    void OnSignOutClick(object sender, RoutedEventArgs e)
    {
        _listing?.Cancel();
        _client.SignOut();
        ApplicationList.ItemsSource = null;
        Log.Write("Signed out of JobStrike");
        ShowState();
    }

    // ---------------------------------------------------------------- list

    void OnFilterChecked(object sender, RoutedEventArgs e)
    {
        if (IsLoaded)
        {
            _ = RefreshListAsync();
        }
    }

    void OnSearchChanged(object sender, TextChangedEventArgs e)
    {
        SearchHint.Visibility = SearchBox.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        _searchDelay.Stop();
        _searchDelay.Start();
    }

    JobStrikeFilter SelectedFilter() =>
        FilterScreening.IsChecked == true ? JobStrikeFilter.Screening
        : FilterAll.IsChecked == true ? JobStrikeFilter.All
        : JobStrikeFilter.InterviewStages;

    const string ListHint = "Double-click an application, or select it and press Load.";

    async Task RefreshListAsync()
    {
        _listing?.Cancel();
        var listing = _listing = CancellationTokenSource.CreateLinkedTokenSource(_closing.Token);
        ListMessage.Text = "Loading…";
        LoadButton.IsEnabled = false;
        try
        {
            var (applications, stages, total) = await _client.ListAsync(SelectedFilter(), SearchBox.Text, listing.Token);
            if (listing.IsCancellationRequested)
            {
                return;
            }
            _stageNames = stages.ToDictionary(s => s.Id, s => s.Name);
            ApplicationList.ItemsSource = applications.Select(a => new Row(a, StageName(a.StageId))).ToList();
            FooterText.Text = total > applications.Count
                ? $"Showing the newest {applications.Count} of {total}. Search to find others."
                : ListHint;
            ListMessage.Text = applications.Count > 0 ? ""
                : SearchBox.Text.Trim().Length > 0 ? "No applications match this search."
                : SelectedFilter() == JobStrikeFilter.InterviewStages
                    ? "No applications in the interview stages yet. Move a card there on the JobStrike board, or look under Screening or All."
                    : "No applications here yet.";
        }
        catch (Exception ex)
        {
            if (listing.IsCancellationRequested)
            {
                return; // replaced by a newer search, or the window closed
            }
            ApplicationList.ItemsSource = null;
            ListMessage.Text = ex is JobStrikeException ? ex.Message : "Could not load the list. Try again.";
            Log.Write($"JobStrike list: {ex.GetType().Name}: {ex.Message}");
            if (!_client.IsSignedIn)
            {
                ShowState();
                ShowSignInError(ex.Message);
            }
        }
    }

    string StageName(string? stageId) =>
        stageId == null ? "Registered" : _stageNames.TryGetValue(stageId, out var name) ? name : stageId;

    void OnSelectionChanged(object sender, SelectionChangedEventArgs e) =>
        LoadButton.IsEnabled = ApplicationList.SelectedItem != null;

    void OnListDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (ApplicationList.SelectedItem != null && e.OriginalSource is FrameworkElement { DataContext: Row })
        {
            OnLoadClick(sender, e);
        }
    }

    async void OnLoadClick(object sender, RoutedEventArgs e)
    {
        if (ApplicationList.SelectedItem is not Row row || !LoadButton.IsEnabled)
        {
            return;
        }
        LoadButton.IsEnabled = false;
        ApplicationList.IsEnabled = false;
        FooterText.Text = row.Application.HasResume ? "Loading the job description and downloading the resume…" : "Loading…";
        try
        {
            Result = await _client.LoadAsync(row.Application.Id, _closing.Token);
            Log.Write($"Loaded JobStrike application #{row.Application.Id}");
            DialogResult = true;
        }
        catch (Exception ex)
        {
            if (_closing.IsCancellationRequested)
            {
                return;
            }
            Log.Write($"JobStrike load #{row.Application.Id}: {ex.GetType().Name}: {ex.Message}");
            LoadButton.IsEnabled = true;
            ApplicationList.IsEnabled = true;
            if (!_client.IsSignedIn)
            {
                ShowState();
                ShowSignInError(ex.Message);
                return;
            }
            FooterText.Text = ex is JobStrikeException ? ex.Message : "Could not load this application. Try again.";
        }
    }

    /// <summary>What a list row shows.</summary>
    sealed record Row(JobStrikeApplication Application, string Stage)
    {
        public string Company => Application.Company.Length > 0 ? Application.Company : "(no company)";
        public string TitleSuffix => Application.JobTitle.Length > 0 ? "  ·  " + Application.JobTitle : "";
        static readonly string[] AvatarColors = ["#6C5CE7", "#13996A", "#E0703C", "#2F80D8", "#D9508C", "#0E9AA7", "#9B5DE5"];

        public string Initials => string.Concat(Application.Company
            .Split([' ', '-', '&', ',', '.', '(', ')'], StringSplitOptions.RemoveEmptyEntries)
            .Where(w => char.IsLetterOrDigit(w[0])).Take(2).Select(w => char.ToUpperInvariant(w[0]))) is { Length: > 0 } letters
            ? letters : "?";

        /// <summary>Same company, same colour (a stable hash, not string.GetHashCode which changes per run).</summary>
        public System.Windows.Media.Brush AvatarBrush
        {
            get
            {
                int hash = Application.Company.Aggregate(17, (h, c) => unchecked(h * 31 + char.ToLowerInvariant(c)));
                var brush = (System.Windows.Media.Brush)new System.Windows.Media.BrushConverter()
                    .ConvertFromString(AvatarColors[(hash & int.MaxValue) % AvatarColors.Length])!;
                brush.Freeze();
                return brush;
            }
        }

        public string Details => string.Join("   ·   ", new[]
        {
            Application.CandidateName, Application.Date,
            Application.HasResume ? "" : "no resume file",
            Application.JobDescription.Length > 0 ? "" : "no job description",
        }.Where(s => !string.IsNullOrWhiteSpace(s)));
    }
}
