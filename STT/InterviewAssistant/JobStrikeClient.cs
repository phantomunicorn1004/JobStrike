using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace InterviewAssistant;

/// <summary>One application (bid) in JobStrike's Resume DB.</summary>
public sealed record JobStrikeApplication(
    int Id,
    string Company,
    string JobTitle,
    string CandidateName,
    int? ProfileId,
    string? StageId,
    string Date,
    string JobLink,
    string JobDescription,
    bool HasResume);

/// <summary>A pipeline stage as JobStrike names it (Screening, HR, Technical…).</summary>
public sealed record JobStrikeStage(string Id, string Name);

/// <summary>
/// What the interview needs from one application. <paramref name="ResumeProblem"/> says why the
/// resume could not be read; everything else is still loaded.
/// </summary>
public sealed record JobStrikeDetails(JobStrikeApplication Application, string Resume, string ResumeFileName, string Profile,
    string? ResumeProblem);

/// <summary>Which applications to list.</summary>
public enum JobStrikeFilter
{
    /// <summary>Every pipeline stage after screening, except rejected (HR, Technical, Final, and any the user added).</summary>
    InterviewStages,
    Screening,
    All,
}

/// <summary>
/// Reads interview details from JobStrike with the same API key the browser extension uses. Signing
/// in exchanges the username and password for that key once; only the key is kept, encrypted for
/// this Windows account. Nothing is written to JobStrike.
/// </summary>
public sealed class JobStrikeClient : IDisposable
{
    public const string DefaultUrl = "https://job-strike.vercel.app";

    /// <summary>The list shows at most this many per stage; searching narrows it down.</summary>
    public const int PageSize = 100;

    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    readonly HttpClient _http;
    readonly AppSettings _settings;
    List<JobStrikeStage>? _stages;

    public JobStrikeClient(AppSettings settings)
    {
        _settings = settings;
        _http = new HttpClient { BaseAddress = new Uri(settings.JobStrikeUrl.TrimEnd('/') + "/"), Timeout = TimeSpan.FromSeconds(60) };
    }

    public bool IsSignedIn => Key != null;

    string? Key
    {
        get
        {
            if (string.IsNullOrEmpty(_settings.JobStrikeKeyProtected))
            {
                return null;
            }
            try
            {
                byte[] plain = ProtectedData.Unprotect(Convert.FromBase64String(_settings.JobStrikeKeyProtected), null,
                    DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(plain);
            }
            catch (Exception ex) when (ex is CryptographicException or FormatException)
            {
                return null; // saved by another Windows account or damaged: sign in again
            }
        }
    }

    /// <exception cref="JobStrikeException">Wrong credentials, or the site could not be reached.</exception>
    public async Task SignInAsync(string username, string password)
    {
        using var response = await SendAsync(() => _http.PostAsJsonAsync("api/auth/login", new { username, password }));
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.BadRequest)
        {
            throw new JobStrikeException(await ErrorMessageAsync(response) ?? "Wrong username or password.");
        }
        await EnsureSuccessAsync(response);
        var login = await response.Content.ReadFromJsonAsync<LoginResponse>(Json);
        if (string.IsNullOrEmpty(login?.ExtensionApiKey))
        {
            throw new JobStrikeException("JobStrike did not return an access key for this account.");
        }
        byte[] protectedKey = ProtectedData.Protect(Encoding.UTF8.GetBytes(login.ExtensionApiKey), null, DataProtectionScope.CurrentUser);
        _settings.JobStrikeKeyProtected = Convert.ToBase64String(protectedKey);
        _settings.JobStrikeUser = login.User?.Username ?? username;
        _settings.Save();
    }

    public void SignOut()
    {
        _settings.JobStrikeKeyProtected = "";
        _settings.JobStrikeUser = "";
        _settings.Save(dropBackup: true);
    }

    /// <summary>
    /// Applications for <paramref name="filter"/>, newest first, optionally matching
    /// <paramref name="search"/>; <c>Total</c> counts all matches, of which at most
    /// <see cref="PageSize"/> per stage are returned.
    /// </summary>
    public async Task<(List<JobStrikeApplication> Applications, List<JobStrikeStage> Stages, int Total)> ListAsync(
        JobStrikeFilter filter, string search, CancellationToken token)
    {
        var stages = await StagesAsync(token);
        string[] statuses = filter switch
        {
            JobStrikeFilter.Screening => ["applied"],
            JobStrikeFilter.All => ["__all__"],
            _ => stages.Where(IsInterviewStage).Select(s => s.Id).ToArray(),
        };
        string searchQuery = string.IsNullOrWhiteSpace(search) ? "" : "&search=" + Uri.EscapeDataString(search.Trim());
        var pages = await Task.WhenAll(statuses.Select(status => GetJsonAsync<ListResponse>(
            $"api/resume-db?status={Uri.EscapeDataString(status)}&pageSize={PageSize}{searchQuery}", token)));
        var applications = pages.SelectMany(p => p.Resumes ?? []).Select(ToApplication)
            .DistinctBy(a => a.Id).OrderByDescending(a => a.Id).ToList();
        return (applications, stages, pages.Sum(p => p.Total ?? 0));
    }

    /// <summary>The user's pipeline stages (they can rename, add and remove them on the JobStrike board).</summary>
    async Task<List<JobStrikeStage>> StagesAsync(CancellationToken token)
    {
        if (_stages == null)
        {
            var page = await GetJsonAsync<ListResponse>("api/resume-db?status=__all__&pageSize=1", token);
            _stages = (page.PipelineStages ?? []).Where(s => !string.IsNullOrEmpty(s.Id))
                .Select(s => new JobStrikeStage(s.Id!, string.IsNullOrWhiteSpace(s.Name) ? s.Id! : s.Name!)).ToList();
        }
        return _stages;
    }

    static bool IsInterviewStage(JobStrikeStage stage) =>
        stage.Id != "applied"
        && !stage.Id.Contains("reject", StringComparison.OrdinalIgnoreCase)
        && !stage.Name.Contains("reject", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The full application, its resume as text (the file is downloaded and read here, like a loaded
    /// resume), and the candidate's public profile details.
    /// </summary>
    public async Task<JobStrikeDetails> LoadAsync(int id, CancellationToken token)
    {
        var single = await GetJsonAsync<SingleResponse>($"api/resume-db?id={id}", token);
        var application = ToApplication(single.Resume ?? throw new JobStrikeException("This application no longer exists in JobStrike."));

        // A resume that cannot be fetched or read (e.g. JobStrike's Google Drive sign-in expired, or a
        // scanned PDF) must not stop the job description and company from loading.
        string resume = "", fileName = "";
        string? problem = application.HasResume ? null : "JobStrike has no resume file for this application.";
        if (application.HasResume)
        {
            try
            {
                (resume, fileName) = await DownloadResumeAsync(id, token);
            }
            catch (Exception ex) when (ex is JobStrikeException or InvalidDataException or IOException or UnauthorizedAccessException)
            {
                problem = $"The resume could not be loaded: {ex.Message}";
                Log.Write($"JobStrike resume for #{id}: {ex.GetType().Name}: {ex.Message}");
            }
        }
        string profile = application.ProfileId is int profileId ? await ProfileTextAsync(profileId, token) : "";
        return new JobStrikeDetails(application, resume, fileName, profile, problem);
    }

    async Task<(string Text, string FileName)> DownloadResumeAsync(int id, CancellationToken token)
    {
        using var response = await SendAsync(() => _http.SendAsync(Request($"api/resume-db/download?id={id}"), token));
        await EnsureSuccessAsync(response);
        string fileName = response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"')
            ?? "resume.docx";
        byte[] bytes = await response.Content.ReadAsByteArrayAsync(token);
        // The file's own header decides how to read it; a stored name can be wrong or missing.
        string extension = bytes.AsSpan().StartsWith("%PDF"u8) ? ".pdf"
            : bytes.AsSpan().StartsWith("PK"u8) ? ".docx"
            : Path.GetExtension(fileName);
        if (!ResumeReader.IsSupported("resume" + extension))
        {
            throw new InvalidDataException($"{fileName} is not a PDF or Word (.docx) file.");
        }
        string temp = Path.Combine(Path.GetTempPath(), $"InterviewAssistant-{Guid.NewGuid():N}{extension}");
        try
        {
            await File.WriteAllBytesAsync(temp, bytes, token);
            return (ResumeReader.ReadText(temp), fileName);
        }
        finally
        {
            try
            {
                File.Delete(temp);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // a virus scanner may still hold it; the temp folder is cleaned up by Windows
            }
        }
    }

    /// <summary>
    /// Only what helps in an interview: name, education, LinkedIn and city. Personal data JobStrike
    /// keeps for application forms (SSN, date of birth, phone, address, emails) is never read here.
    /// </summary>
    async Task<string> ProfileTextAsync(int profileId, CancellationToken token)
    {
        var profiles = await GetJsonAsync<ProfilesResponse>("api/profiles?full=1", token);
        var profile = profiles.Profiles?.FirstOrDefault(p => p.Id == profileId);
        if (profile == null)
        {
            return "";
        }
        var lines = new List<string>();
        void Add(string label, string? value)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                lines.Add($"{label}: {value.Trim()}");
            }
        }
        Add("Name", profile.FullName);
        Add("Education", profile.University);
        Add("LinkedIn", profile.Linkedin);
        Add("Location", string.Join(", ", new[] { profile.City, profile.State }.Where(v => !string.IsNullOrWhiteSpace(v))));
        return string.Join(Environment.NewLine, lines);
    }

    async Task<T> GetJsonAsync<T>(string path, CancellationToken token)
    {
        using var response = await SendAsync(() => _http.SendAsync(Request(path), token));
        await EnsureSuccessAsync(response);
        try
        {
            return await response.Content.ReadFromJsonAsync<T>(Json, token)
                ?? throw new JobStrikeException("JobStrike sent an empty answer.");
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException)
        {
            throw new JobStrikeException("JobStrike sent an answer this app does not understand. Is the JobStrike site up to date?");
        }
    }

    HttpRequestMessage Request(string path)
    {
        string key = Key ?? throw new JobStrikeException("Sign in to JobStrike first.");
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("X-Extension-Key", key);
        return request;
    }

    static async Task<HttpResponseMessage> SendAsync(Func<Task<HttpResponseMessage>> send)
    {
        try
        {
            return await send();
        }
        catch (HttpRequestException ex)
        {
            throw new JobStrikeException($"Could not reach JobStrike ({ex.Message}). Check the internet connection.");
        }
        catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException)
        {
            throw new JobStrikeException("JobStrike did not answer in time. Try again.");
        }
    }

    async Task EnsureSuccessAsync(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            SignOut(); // the key was revoked or reset on the site
            throw new JobStrikeException("JobStrike no longer accepts this sign-in. Sign in again.");
        }
        string? message = await ErrorMessageAsync(response);
        throw new JobStrikeException($"JobStrike error {(int)response.StatusCode}{(message == null ? "" : ": " + message)}");
    }

    static async Task<string?> ErrorMessageAsync(HttpResponseMessage response)
    {
        try
        {
            var error = await response.Content.ReadFromJsonAsync<ErrorResponse>(Json);
            return string.IsNullOrWhiteSpace(error?.Error) ? null : error.Error;
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException or InvalidOperationException)
        {
            return null;
        }
    }

    static JobStrikeApplication ToApplication(ApplicationRow row) => new(
        row.Id,
        (row.Company ?? "").Trim(),
        (row.JobTitle ?? row.RoleTitle ?? "").Trim(),
        (row.CandidateName ?? "").Trim(),
        row.ProfileId,
        row.PipelineStageId,
        row.Date ?? row.AppliedAt ?? "",
        row.JobLink ?? "",
        (row.Note ?? "").Trim(),
        !string.IsNullOrWhiteSpace(row.ResumeUrl) || !string.IsNullOrWhiteSpace(row.ResumeStoragePath)
            || !string.IsNullOrWhiteSpace(row.ResumeDriveFileId));

    public void Dispose() => _http.Dispose();

    sealed record LoginResponse(LoginUser? User, string? ExtensionApiKey);
    sealed record LoginUser(string? Username);
    sealed record ListResponse(List<ApplicationRow>? Resumes, List<StageRow>? PipelineStages, int? Total);
    sealed record SingleResponse(ApplicationRow? Resume);
    sealed record StageRow(string? Id, string? Name);
    sealed record ErrorResponse(string? Error);
    sealed record ProfilesResponse(List<ProfileRow>? Profiles);

    sealed record ProfileRow(
        int Id,
        [property: JsonPropertyName("full_name")] string? FullName,
        string? University,
        string? Linkedin,
        string? City,
        string? State);

    sealed record ApplicationRow(
        int Id,
        string? Company,
        string? JobTitle,
        string? RoleTitle,
        string? CandidateName,
        int? ProfileId,
        string? PipelineStageId,
        string? Date,
        string? AppliedAt,
        string? JobLink,
        string? Note,
        string? ResumeUrl,
        string? ResumeStoragePath,
        string? ResumeDriveFileId);
}

public sealed class JobStrikeException(string message) : Exception(message);
