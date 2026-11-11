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

    /// <summary>
    /// Where answers come from: the chat page (Provider above), or an AI API with the user's key
    /// (encrypted for this Windows account) and the model picked for it.
    /// </summary>
    public AnswerEngine AnswerEngine { get; set; } = AnswerEngine.ChatPage;
    public string OpenAiKeyProtected { get; set; } = "";
    public string OpenAiModel { get; set; } = "";
    public string DeepSeekKeyProtected { get; set; } = "";
    public string DeepSeekModel { get; set; } = "";

    /// <summary>The kind of round (sets what answers focus on) and how long answers are.</summary>
    public InterviewType InterviewType { get; set; } = InterviewType.Screening;
    public AnswerLength AnswerLength { get; set; } = AnswerLength.Normal;
    public bool AutoSend { get; set; }
    public double PauseSeconds { get; set; } = 1.6;
    public int MinWords { get; set; } = 3;
    public bool AlwaysOnTop { get; set; }
    public bool HideFromCapture { get; set; }
    public bool HideLiveCaptionsWindow { get; set; }
    public double CaptionFontSize { get; set; } = 15;

    // Reading the answer aloud: the service (Google with the user's API key, encrypted for this
    // Windows account, or the Windows voices), the voice of each ("" = default), speed (1 = normal),
    // output device id ("" = default speaker), and whether captions heard while it speaks are skipped.
    public bool SpeakAnswers { get; set; }
    public VoiceService VoiceService { get; set; } = VoiceService.Google;
    public string GoogleKeyProtected { get; set; } = "";
    public string GoogleVoice { get; set; } = GoogleSpeech.DefaultVoice;
    public string VoiceId { get; set; } = "";
    public double VoiceRate { get; set; } = 1.1;
    public string VoiceDeviceId { get; set; } = "";
    public bool VoiceSkipsCaptions { get; set; } = true;

    // Where the captions go in each layout, and their width when docked beside the chat (above or
    // below the answer they are one line).
    public CaptionDock NormalCaptionDock { get; set; } = CaptionDock.Left;
    // Interview view: the answer on top (near the camera, read like a teleprompter), captions below.
    public CaptionDock CompactCaptionDock { get; set; } = CaptionDock.Bottom;
    public double CaptionPanelWidth { get; set; } = 400;
    public double CompactCaptionWidth { get; set; } = 200;
    public WindowBounds? FloatingCaptionBounds { get; set; }

    public HotkeySettings Hotkeys { get; set; } = new();

    /// <summary>
    /// Hotkeys that are also everyday shortcuts (Ctrl+X, Ctrl+Space, …) act as hotkeys only while
    /// Interview Assistant or an app matching one of these words (name or window title) is in front,
    /// and keep their normal job everywhere else, unless CommonHotkeysEverywhere is set.
    /// </summary>
    public string HotkeyApps { get; set; } = DefaultHotkeyApps;
    public bool CommonHotkeysEverywhere { get; set; }

    public const string DefaultHotkeyApps = "Zoom, Teams, Webex, Meet, Slack, Discord, Skype, Whereby, Jitsi, GoTo, AnyDesk";

    /// <summary>True: interviewer messages are submitted. False: they are only put in the chat box.</summary>
    public bool SubmitAutomatically { get; set; } = true;

    /// <summary>Interview view: chat page replaced by the answer reader plus the caption strip.</summary>
    public bool CompactMode { get; set; }
    /// <summary>In interview view, show the real chat page instead of the answer reader.</summary>
    public bool CompactShowsChatPage { get; set; }
    /// <summary>Interview view shows the message box under the captions (opened to type, then it can be hidden).</summary>
    public bool CompactMessageBox { get; set; }
    public double AnswerFontSize { get; set; } = 18;

    public AppTheme Theme { get; set; } = AppTheme.Dark;

    /// <summary>Interview view as a borderless, see-through window above the meeting.</summary>
    public bool OverlayMode { get; set; }
    /// <summary>Overlay background opacity, 0.15 (mostly see-through) to 1 (solid). Text stays solid.</summary>
    public double OverlayOpacity { get; set; } = 0.6;
    public WindowBounds? OverlayBounds { get; set; }
    /// <summary>
    /// Bumped when a layout change needs older saved settings adjusted (2: captions below the answer;
    /// 3: the interview view's message box closed until opened to type).
    /// </summary>
    public int LayoutVersion { get; set; }
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
        return new AppSettings().Normalized();
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
        VoiceId ??= "";
        VoiceDeviceId ??= "";
        GoogleKeyProtected ??= "";
        OpenAiKeyProtected ??= "";
        OpenAiModel ??= "";
        DeepSeekKeyProtected ??= "";
        DeepSeekModel ??= "";
        if (!Enum.IsDefined(AnswerEngine)) AnswerEngine = AnswerEngine.ChatPage;
        if (!Enum.IsDefined(InterviewType)) InterviewType = InterviewType.Screening;
        if (!Enum.IsDefined(AnswerLength)) AnswerLength = AnswerLength.Normal;
        if (string.IsNullOrWhiteSpace(GoogleVoice)) GoogleVoice = GoogleSpeech.DefaultVoice;
        if (!Enum.IsDefined(VoiceService)) VoiceService = VoiceService.Google;
        VoiceRate = Clamp(VoiceRate, 0.5, 2.5, 1.1);
        if (!Uri.TryCreate(JobStrikeUrl, UriKind.Absolute, out var site) || site.Scheme != Uri.UriSchemeHttps)
        {
            JobStrikeUrl = JobStrikeClient.DefaultUrl;
        }
        if (string.IsNullOrWhiteSpace(CallPromptTemplate))
        {
            CallPromptTemplate = DefaultCallPrompt;
        }
        Hotkeys ??= new HotkeySettings();
        HotkeyApps ??= DefaultHotkeyApps;
        Hotkeys.Normalize();

        if (!Enum.IsDefined(Provider)) Provider = ChatProvider.ChatGpt;
        if (!Enum.IsDefined(Theme)) Theme = AppTheme.Dark;
        if (!Enum.IsDefined(CompactCaptionDock)) CompactCaptionDock = CaptionDock.Bottom;
        if (!Enum.IsDefined(NormalCaptionDock)) NormalCaptionDock = CaptionDock.Left;

        PauseSeconds = Clamp(PauseSeconds, 0.3, 10, 1.6);
        MinWords = Math.Clamp(MinWords, 1, 50);
        CaptionFontSize = Clamp(CaptionFontSize, 10, 32, 15);
        AnswerFontSize = Clamp(AnswerFontSize, 12, 32, 18);
        OverlayOpacity = Clamp(OverlayOpacity, 0.15, 1, 0.6);
        CaptionPanelWidth = Clamp(CaptionPanelWidth, 160, 4000, 400);
        CompactCaptionWidth = Clamp(CompactCaptionWidth, 160, 4000, 200);
        if (LayoutVersion < 2)
        {
            // The teleprompter layout: answer above, captions below (other choices are kept).
            if (CompactCaptionDock == CaptionDock.Top)
            {
                CompactCaptionDock = CaptionDock.Bottom;
            }
            LayoutVersion = 2;
        }
        if (LayoutVersion < 3)
        {
            // The interview view's message box opens only to type (the pencil button).
            CompactMessageBox = false;
            LayoutVersion = 3;
        }
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
    public string ToggleVoice { get; set; } = "Ctrl+Alt+V";
    public string StopVoice { get; set; } = "Ctrl+Alt+R";
    public string ShowHide { get; set; } = "Ctrl+Alt+H";

    /// <summary>A null entry (hand-edited or older file) means "no hotkey".</summary>
    public void Normalize()
    {
        ToggleVoice ??= "";
        StopVoice ??= "";
        ShowHide ??= "";
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

/// <summary>Text encrypted for this Windows account (DPAPI), stored as Base64: the access keys in settings.json.</summary>
public static class ProtectedText
{
    public static string Protect(string text) =>
        Convert.ToBase64String(System.Security.Cryptography.ProtectedData.Protect(
            System.Text.Encoding.UTF8.GetBytes(text), null, System.Security.Cryptography.DataProtectionScope.CurrentUser));

    /// <summary>The text, or null when there is none or it was saved by another Windows account (or is damaged).</summary>
    public static string? Unprotect(string protectedText)
    {
        if (string.IsNullOrEmpty(protectedText))
        {
            return null;
        }
        try
        {
            return System.Text.Encoding.UTF8.GetString(System.Security.Cryptography.ProtectedData.Unprotect(
                Convert.FromBase64String(protectedText), null, System.Security.Cryptography.DataProtectionScope.CurrentUser));
        }
        catch (Exception ex) when (ex is System.Security.Cryptography.CryptographicException or FormatException)
        {
            return null;
        }
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
