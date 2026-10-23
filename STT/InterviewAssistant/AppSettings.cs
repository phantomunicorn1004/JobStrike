using System.IO;
using System.Text.Json;

namespace InterviewAssistant;

public sealed class AppSettings
{
    public const string DefaultCallPrompt =
        """
        You are my real-time interview assistant. I am in a live job interview right now.
        Every message after this one is what the interviewer just said, captured by speech recognition. It can contain misheard words, missing punctuation, or be a fragment of a longer question.

        For each message, write what I should say back, in first person, as me:
        - Start with a one-sentence direct answer I can say immediately.
        - Then 2-4 short bullet points I can expand on, using concrete examples from my background.
        - Keep it under 120 words unless it is a coding or system design question.
        - Use natural spoken English.
        - Only use facts from my profile and resume. Never invent employers, titles, dates or numbers.
        - If the message is small talk or not a question (e.g. "okay", "great"), reply with just "-".
        - If the transcript is unclear, answer the most likely intended question.

        My profile:
        {profile}

        Company I am interviewing with:
        {company}

        Job description:
        {job_description}

        My resume:
        {resume}

        Reply only "Ready." to this message.
        """;

    public string Profile { get; set; } = "";
    public string Company { get; set; } = "";
    public string JobDescription { get; set; } = "";
    public string Resume { get; set; } = "";
    public string CallPromptTemplate { get; set; } = DefaultCallPrompt;

    /// <summary>JobStrike connection: the site, who signed in, and the API key it issued, encrypted
    /// for this Windows account (DPAPI). The password is never stored.</summary>
    public string JobStrikeUrl { get; set; } = JobStrikeClient.DefaultUrl;
    public string JobStrikeUser { get; set; } = "";
    public string JobStrikeKeyProtected { get; set; } = "";

    public ChatProvider Provider { get; set; } = ChatProvider.ChatGpt;
    public bool AutoSend { get; set; }
    public double PauseSeconds { get; set; } = 1.6;
    public int MinWords { get; set; } = 3;
    public bool AlwaysOnTop { get; set; }
    public bool HideLiveCaptionsWindow { get; set; }
    public double CaptionFontSize { get; set; } = 15;

    // Where the captions go in each layout, and their size when docked left/right (width) or
    // above/below (height) the chat.
    public CaptionDock NormalCaptionDock { get; set; } = CaptionDock.Left;
    public CaptionDock CompactCaptionDock { get; set; } = CaptionDock.Top;
    public double CaptionPanelWidth { get; set; } = 400;
    public double CaptionPanelHeight { get; set; } = 240;
    public double CompactCaptionWidth { get; set; } = 200;
    public WindowBounds? FloatingCaptionBounds { get; set; }

    public HotkeySettings Hotkeys { get; set; } = new();

    /// <summary>True: interviewer messages are submitted. False: they are only put in the chat box.</summary>
    public bool SubmitAutomatically { get; set; } = true;

    /// <summary>Interview view: chat page replaced by the answer reader plus the caption strip.</summary>
    public bool CompactMode { get; set; }
    /// <summary>In interview view, show the real chat page instead of the answer reader.</summary>
    public bool CompactShowsChatPage { get; set; }
    public double AnswerFontSize { get; set; } = 18;

    public AppTheme Theme { get; set; } = AppTheme.Dark;

    /// <summary>Interview view as a borderless, see-through window above the meeting.</summary>
    public bool OverlayMode { get; set; }
    /// <summary>Overlay background opacity, 0.15 (mostly see-through) to 1 (solid). Text stays solid.</summary>
    public double OverlayOpacity { get; set; } = 0.6;
    public WindowBounds? OverlayBounds { get; set; }
    public double OverlayCaptionHeight { get; set; } = 120;
    public double CompactCaptionHeight { get; set; } = 110;
    public double ChatZoom { get; set; } = 1.0;
    public double CompactChatZoom { get; set; } = 0.85;
    public WindowBounds? NormalBounds { get; set; }
    public WindowBounds? CompactBounds { get; set; }

    public string BuildCallPrompt()
    {
        static string Value(string text) => string.IsNullOrWhiteSpace(text) ? "(not provided)" : text.Trim();
        return CallPromptTemplate
            .Replace("{profile}", Value(Profile))
            .Replace("{company}", Value(Company))
            .Replace("{job_description}", Value(JobDescription))
            .Replace("{resume}", Value(Resume))
            .Trim();
    }

    /// <summary>Settings, log and browser profile. INTERVIEW_ASSISTANT_DATA points a second copy elsewhere.</summary>
    public static string DataFolder { get; } =
        Environment.GetEnvironmentVariable("INTERVIEW_ASSISTANT_DATA") is { Length: > 0 } custom
            ? custom
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InterviewAssistant");

    static string FilePath => Path.Combine(DataFolder, "settings.json");

    static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    static string BackupPath => FilePath + ".bak";

    /// <summary>
    /// Loads the settings, falling back to the backup copy if the file is damaged, and repairs
    /// missing or out-of-range values (e.g. from an older version) instead of failing later.
    /// </summary>
    public static AppSettings Load()
    {
        foreach (string path in new[] { FilePath, BackupPath })
        {
            try
            {
                if (File.Exists(path) && JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path), JsonOptions) is { } settings)
                {
                    return settings.Normalized();
                }
            }
            catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException or NotSupportedException)
            {
                Log.Write($"Settings file {Path.GetFileName(path)} could not be read: {ex.Message}");
            }
        }
        return new AppSettings();
    }

    /// <summary>
    /// Writes to a temporary file and swaps it in, keeping the previous file as a backup, so a crash
    /// or power cut mid-save never leaves the profile, resume and prompt half-written.
    /// </summary>
    /// <summary>
    /// Saves, and with <paramref name="dropBackup"/> also deletes the previous copy (settings.json.bak),
    /// e.g. after signing out so the old access key does not linger there.
    /// </summary>
    public void Save(bool dropBackup)
    {
        Save();
        if (dropBackup)
        {
            try
            {
                File.Delete(BackupPath);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Log.Write($"Old settings copy could not be deleted: {ex.Message}");
            }
        }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(DataFolder);
            string temp = FilePath + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(this, JsonOptions));
            if (File.Exists(FilePath))
            {
                File.Replace(temp, FilePath, BackupPath, ignoreMetadataErrors: true);
            }
            else
            {
                File.Move(temp, FilePath);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // e.g. the file is briefly locked by antivirus or OneDrive: keep running, try again next save.
            Log.Write($"Settings could not be saved: {ex.Message}");
        }
    }

    AppSettings Normalized()
    {
        Profile ??= "";
        Company ??= "";
        JobDescription ??= "";
        Resume ??= "";
        JobStrikeUser ??= "";
        JobStrikeKeyProtected ??= "";
        if (!Uri.TryCreate(JobStrikeUrl, UriKind.Absolute, out var site) || site.Scheme != Uri.UriSchemeHttps)
        {
            JobStrikeUrl = JobStrikeClient.DefaultUrl;
        }
        if (string.IsNullOrWhiteSpace(CallPromptTemplate))
        {
            CallPromptTemplate = DefaultCallPrompt;
        }
        Hotkeys ??= new HotkeySettings();
        Hotkeys.Normalize();

        if (!Enum.IsDefined(Provider)) Provider = ChatProvider.ChatGpt;
        if (!Enum.IsDefined(Theme)) Theme = AppTheme.Dark;
        if (!Enum.IsDefined(CompactCaptionDock)) CompactCaptionDock = CaptionDock.Top;
        if (!Enum.IsDefined(NormalCaptionDock)) NormalCaptionDock = CaptionDock.Left;

        PauseSeconds = Clamp(PauseSeconds, 0.3, 10, 1.6);
        MinWords = Math.Clamp(MinWords, 1, 50);
        CaptionFontSize = Clamp(CaptionFontSize, 10, 32, 15);
        AnswerFontSize = Clamp(AnswerFontSize, 12, 32, 18);
        OverlayOpacity = Clamp(OverlayOpacity, 0.15, 1, 0.6);
        CaptionPanelWidth = Clamp(CaptionPanelWidth, 160, 4000, 400);
        CaptionPanelHeight = Clamp(CaptionPanelHeight, 50, 4000, 240);
        CompactCaptionWidth = Clamp(CompactCaptionWidth, 160, 4000, 200);
        CompactCaptionHeight = Clamp(CompactCaptionHeight, 50, 4000, 110);
        OverlayCaptionHeight = Clamp(OverlayCaptionHeight, 40, 4000, 120);
        ChatZoom = Clamp(ChatZoom, 0.25, 5, 1);
        CompactChatZoom = Clamp(CompactChatZoom, 0.25, 5, 0.85);
        NormalBounds = Valid(NormalBounds);
        CompactBounds = Valid(CompactBounds);
        OverlayBounds = Valid(OverlayBounds);
        FloatingCaptionBounds = Valid(FloatingCaptionBounds);
        return this;

        static double Clamp(double value, double min, double max, double fallback) =>
            double.IsFinite(value) ? Math.Clamp(value, min, max) : fallback;

        static WindowBounds? Valid(WindowBounds? b) =>
            b != null && double.IsFinite(b.Width) && double.IsFinite(b.Height) && b.Width >= 100 && b.Height >= 100 ? b : null;
    }
}

/// <summary>Hotkey text per action; an empty string leaves the action without a hotkey.</summary>
public sealed class HotkeySettings
{
    public string Send { get; set; } = "Ctrl+Alt+S";
    public string Discard { get; set; } = "Ctrl+Alt+D";
    public string ClearChatBox { get; set; } = "Ctrl+Alt+X";
    public string SubmitChatBox { get; set; } = "Ctrl+Alt+Enter";
    public string ToggleAutoSend { get; set; } = "Ctrl+Alt+A";
    public string ToggleCompact { get; set; } = "Ctrl+Alt+C";
    public string ScrollAnswerDown { get; set; } = "Ctrl+Alt+PageDown";
    public string ScrollAnswerUp { get; set; } = "Ctrl+Alt+PageUp";
    // Not Ctrl+Alt+arrows: some graphics drivers rotate the screen with those.
    public string LessSeeThrough { get; set; } = "Ctrl+Alt+=";
    public string MoreSeeThrough { get; set; } = "Ctrl+Alt+-";

    /// <summary>A null entry (hand-edited or older file) means "no hotkey".</summary>
    public void Normalize()
    {
        Send ??= "";
        Discard ??= "";
        ClearChatBox ??= "";
        SubmitChatBox ??= "";
        ToggleAutoSend ??= "";
        ToggleCompact ??= "";
        ScrollAnswerDown ??= "";
        ScrollAnswerUp ??= "";
        LessSeeThrough ??= "";
        MoreSeeThrough ??= "";
    }
}

public sealed record WindowBounds(double Left, double Top, double Width, double Height, bool Maximized = false);

public enum CaptionDock
{
    Left,
    Right,
    Top,
    Bottom,
    /// <summary>A separate window that can be moved anywhere, including another monitor.</summary>
    Floating,
}
