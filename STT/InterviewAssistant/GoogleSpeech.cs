using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace InterviewAssistant;

public sealed class GoogleSpeechException(string message) : Exception(message);

/// <summary>
/// Google Cloud Text-to-Speech (the voices behind Google Translate's Listen button) with the user's
/// own API key, which is stored encrypted for this Windows account like the JobStrike key.
/// </summary>
public static class GoogleSpeech
{
    public const string DefaultVoice = "en-US-Neural2-F";
    public const string ConsoleUrl = "https://console.cloud.google.com/apis/library/texttospeech.googleapis.com";

    // Full addresses: "text:synthesize" on its own would be read as a URI with the scheme "text".
    const string Api = "https://texttospeech.googleapis.com/v1/";

    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    /// <summary>MP3 audio of <paramref name="text"/> (at most about 5,000 bytes per request).</summary>
    public static async Task<byte[]> SynthesizeAsync(string key, string voice, double rate, string text, CancellationToken token)
    {
        string language = LanguageOf(voice);
        object Body(bool withRate) => new
        {
            input = new { text },
            voice = new { languageCode = language, name = voice },
            audioConfig = withRate ? (object)new { audioEncoding = "MP3", speakingRate = Math.Clamp(rate, 0.25, 4) } : new { audioEncoding = "MP3" },
        };
        using var response = await Http.PostAsJsonAsync($"{Api}text:synthesize?key={Uri.EscapeDataString(key)}", Body(true), token);
        if (response.IsSuccessStatusCode)
        {
            return await AudioOf(response, token);
        }
        string error = await ErrorOf(response, token);
        // Some voices (e.g. the newest ones) do not take a speed; read those at their own pace.
        if ((int)response.StatusCode == 400 && error.Contains("rate", StringComparison.OrdinalIgnoreCase))
        {
            using var retry = await Http.PostAsJsonAsync($"{Api}text:synthesize?key={Uri.EscapeDataString(key)}", Body(false), token);
            if (retry.IsSuccessStatusCode)
            {
                return await AudioOf(retry, token);
            }
            error = await ErrorOf(retry, token);
        }
        throw new GoogleSpeechException(error);
    }

    /// <summary>English voices, the most natural kinds first.</summary>
    public static async Task<IReadOnlyList<VoiceChoice>> VoicesAsync(string key, CancellationToken token = default)
    {
        using var response = await Http.GetAsync($"{Api}voices?languageCode=en&key={Uri.EscapeDataString(key)}", token);
        if (!response.IsSuccessStatusCode)
        {
            throw new GoogleSpeechException(await ErrorOf(response, token));
        }
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
        var voices = new List<(int Rank, string Name, string Label)>();
        foreach (var v in doc.RootElement.GetProperty("voices").EnumerateArray())
        {
            string name = v.GetProperty("name").GetString() ?? "";
            if (!name.StartsWith("en-", StringComparison.Ordinal))
            {
                continue;
            }
            string gender = v.TryGetProperty("ssmlGender", out var g) ? (g.GetString() ?? "").ToLowerInvariant() : "";
            var (rank, kind) = KindOf(name);
            voices.Add((rank, name, $"{name[..5]} · {name[6..]} · {gender} · {kind}"));
        }
        return voices
            .OrderBy(v => v.Name.StartsWith("en-US", StringComparison.Ordinal) ? 0 : 1)
            .ThenBy(v => v.Rank).ThenBy(v => v.Name)
            .Select(v => new VoiceChoice(v.Name, v.Label))
            .ToList();
    }

    static (int Rank, string Kind) KindOf(string name) =>
        name.Contains("Chirp3-HD") ? (0, "most natural")
        : name.Contains("Chirp-HD") || name.Contains("Studio") ? (1, "very natural")
        : name.Contains("Neural2") ? (2, "natural")
        : name.Contains("Wavenet") ? (3, "natural")
        : name.Contains("Standard") ? (5, "basic")
        : (4, "natural");

    static string LanguageOf(string voice) => voice.Length >= 5 && voice[2] == '-' ? voice[..5] : "en-US";

    static async Task<byte[]> AudioOf(HttpResponseMessage response, CancellationToken token)
    {
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
        return Convert.FromBase64String(doc.RootElement.GetProperty("audioContent").GetString() ?? "");
    }

    /// <summary>Google's own error message, made clear for the common cases.</summary>
    static async Task<string> ErrorOf(HttpResponseMessage response, CancellationToken token)
    {
        string message = $"HTTP {(int)response.StatusCode}";
        try
        {
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
            message = doc.RootElement.GetProperty("error").GetProperty("message").GetString() ?? message;
        }
        catch (Exception)
        {
        }
        if (message.Contains("API key not valid", StringComparison.OrdinalIgnoreCase))
        {
            return "Google says the API key is not valid. Copy it again from Google Cloud ▸ Credentials.";
        }
        if (message.Contains("has not been used", StringComparison.OrdinalIgnoreCase) || message.Contains("is disabled", StringComparison.OrdinalIgnoreCase))
        {
            return "The Cloud Text-to-Speech API is not enabled for this key's project. Enable it in Google Cloud (and add billing), then try again.";
        }
        if (message.Contains("billing", StringComparison.OrdinalIgnoreCase))
        {
            return "Google Cloud needs a billing account on this project (the free monthly allowance still applies).";
        }
        return "Google voice: " + message;
    }
}
