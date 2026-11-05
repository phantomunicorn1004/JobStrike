using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace InterviewAssistant;

/// <summary>Where answers come from: the ChatGPT / DeepSeek page in the app's browser, or an AI API.</summary>
public enum AnswerEngine
{
    ChatPage,
    OpenAi,
    DeepSeek,
}

public sealed record ChatMessage(string Role, string Content);

public sealed class DirectChatException(string message) : Exception(message);

/// <summary>
/// Answers straight from an OpenAI-compatible chat API (OpenAI or DeepSeek), streamed as they are
/// written: no page to type into or read from, so answers start in about a second.
/// </summary>
public static class DirectChat
{
    // Long answers stream for a while; each read has its own timeout below instead.
    static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };
    static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(20);

    /// <summary>INTERVIEW_ASSISTANT_API_BASE points both services at another address (for testing).</summary>
    static string BaseUrl(AnswerEngine engine) =>
        Environment.GetEnvironmentVariable("INTERVIEW_ASSISTANT_API_BASE") is { Length: > 0 } custom ? custom.TrimEnd('/')
        : engine == AnswerEngine.DeepSeek ? "https://api.deepseek.com"
        : "https://api.openai.com/v1";

    public static string DisplayName(AnswerEngine engine) => engine switch
    {
        AnswerEngine.OpenAi => "OpenAI API",
        AnswerEngine.DeepSeek => "DeepSeek API",
        _ => "chat page",
    };

    /// <summary>The chat models this key can use, the likely best default first.</summary>
    public static async Task<IReadOnlyList<string>> ModelsAsync(AnswerEngine engine, string key, CancellationToken token = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, BaseUrl(engine) + "/models");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(ConnectTimeout);
        using var response = await Http.SendAsync(request, timeout.Token);
        if (!response.IsSuccessStatusCode)
        {
            throw new DirectChatException(await ErrorOf(engine, response, timeout.Token));
        }
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        var ids = doc.RootElement.GetProperty("data").EnumerateArray()
            .Select(m => m.GetProperty("id").GetString() ?? "")
            .Where(IsChatModel)
            .Distinct()
            .ToList();
        // Quick, inexpensive models suit live answers best; list them first.
        return ids.OrderBy(id => Preference(engine, id)).ThenBy(id => id, StringComparer.OrdinalIgnoreCase).ToList();
    }

    static bool IsChatModel(string id)
    {
        string[] notChat = ["embedding", "tts", "whisper", "transcribe", "audio", "realtime", "image", "dall-e", "moderation",
            "search", "instruct", "babbage", "davinci", "computer-use", "codex", "sora"];
        return id.Length > 0 && !notChat.Any(word => id.Contains(word, StringComparison.OrdinalIgnoreCase));
    }

    static int Preference(AnswerEngine engine, string id)
    {
        string lower = id.ToLowerInvariant();
        if (engine == AnswerEngine.DeepSeek)
        {
            return lower.Contains("chat") || lower.Contains("flash") ? 0 : lower.Contains("reason") ? 2 : 1;
        }
        return lower.Contains("mini") && lower.StartsWith("gpt") ? 0
            : lower.StartsWith("gpt") ? 1
            : 2;
    }

    /// <summary>The answer as it is written, piece by piece.</summary>
    public static async IAsyncEnumerable<string> StreamAsync(AnswerEngine engine, string key, string model,
        IReadOnlyList<ChatMessage> messages, [EnumeratorCancellation] CancellationToken token)
    {
        var body = new
        {
            model,
            stream = true,
            messages = messages.Select(m => new { role = m.Role, content = m.Content }),
        };
        using var request = new HttpRequestMessage(HttpMethod.Post, BaseUrl(engine) + "/chat/completions")
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        using var connect = CancellationTokenSource.CreateLinkedTokenSource(token);
        connect.CancelAfter(ConnectTimeout);
        HttpResponseMessage response;
        try
        {
            response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, connect.Token);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        {
            throw new DirectChatException($"The {DisplayName(engine)} did not answer within {ConnectTimeout.TotalSeconds:0} seconds.");
        }
        catch (HttpRequestException ex)
        {
            throw new DirectChatException($"Could not reach the {DisplayName(engine)}: {ex.Message}");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new DirectChatException(await ErrorOf(engine, response, token));
            }
            using var stream = await response.Content.ReadAsStreamAsync(token);
            using var reader = new StreamReader(stream);
            // Server-sent events: "data: {json}" lines, ending with "data: [DONE]".
            while (await reader.ReadLineAsync(token) is { } line)
            {
                if (!line.StartsWith("data:", StringComparison.Ordinal))
                {
                    continue;
                }
                string data = line[5..].Trim();
                if (data == "[DONE]")
                {
                    yield break;
                }
                string? piece = null;
                try
                {
                    using var doc = JsonDocument.Parse(data);
                    if (doc.RootElement.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0
                        && choices[0].TryGetProperty("delta", out var delta)
                        && delta.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.String)
                    {
                        piece = content.GetString();
                    }
                }
                catch (JsonException)
                {
                    // A line that is not an answer piece (keep-alive, comment): skip it.
                }
                if (!string.IsNullOrEmpty(piece))
                {
                    yield return piece;
                }
            }
        }
    }

    /// <summary>The service's own error message, made clear for the common cases.</summary>
    static async Task<string> ErrorOf(AnswerEngine engine, HttpResponseMessage response, CancellationToken token)
    {
        string name = DisplayName(engine);
        string message = "";
        try
        {
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
            message = doc.RootElement.GetProperty("error").GetProperty("message").GetString() ?? "";
        }
        catch (Exception)
        {
        }
        return (int)response.StatusCode switch
        {
            401 => $"The {name} key is not valid. Check it in Settings ▸ Answers.",
            402 => $"The {name} account has no balance left. Add credit, or switch to the chat page in Settings ▸ Answers.",
            403 => $"The {name} key may not use this model or service. {message}".Trim(),
            404 => $"The {name} does not know that model. Pick another in Settings ▸ Answers. {message}".Trim(),
            429 => $"The {name} says too many requests or the quota is used up. {message}".Trim(),
            >= 500 => $"The {name} had a problem ({(int)response.StatusCode}). Try again in a moment.",
            _ => $"The {name} refused the request ({(int)response.StatusCode}). {message}".Trim(),
        };
    }
}
