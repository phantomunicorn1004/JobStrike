namespace InterviewAssistant;

public static class ThankYouDraft
{
    public static string BuildPrompt(AppSettings settings, RoundRecord round)
    {
        var parts = new List<string>
        {
            "Write a brief, warm thank-you email I can send after this interview. Keep it under 100 words.",
            $"I am: {settings.Profile.Trim()}",
            $"Company: {settings.Company.Trim()}",
            $"Round type: {InterviewStyles.Name(round.InterviewType)}",
        };
        if (round.InterviewerName.Length > 0)
            parts.Add($"Interviewer: {round.InterviewerName}{(round.InterviewerRole.Length > 0 ? $", {round.InterviewerRole}" : "")}");
        if (round.StoriesUsed.Count > 0)
            parts.Add($"Stories I discussed: {string.Join(", ", round.StoriesUsed)}");
        if (round.KeyPoints.Count > 0)
            parts.Add($"Key topics covered: {string.Join("; ", round.KeyPoints)}");
        parts.Add("Make it specific to the conversation, not generic. Use my name from the profile. Address the interviewer by first name if known.");
        parts.Add("Format: Subject line, then the email body. No markdown, just plain text ready to paste.");
        return string.Join("\n", parts);
    }

    public static async Task<string> GenerateAsync(AppSettings settings, RoundRecord round, CancellationToken token)
    {
        string key = settings.AnswerEngine == AnswerEngine.DeepSeek
            ? ProtectedText.Unprotect(settings.DeepSeekKeyProtected) ?? ""
            : ProtectedText.Unprotect(settings.OpenAiKeyProtected) ?? "";
        string model = settings.AnswerEngine == AnswerEngine.DeepSeek
            ? settings.DeepSeekModel
            : settings.OpenAiModel;

        if (key.Length == 0 || model.Length == 0)
            throw new DirectChatException("An API key and model are needed to generate the thank-you draft. Set them in Settings > Answers.");

        var messages = new List<ChatMessage>
        {
            new("system", "You write concise, warm professional emails."),
            new("user", BuildPrompt(settings, round)),
        };

        var result = new System.Text.StringBuilder();
        await foreach (string chunk in DirectChat.StreamAsync(settings.AnswerEngine, key, model, messages, token))
        {
            result.Append(chunk);
        }
        return result.ToString().Trim();
    }
}
