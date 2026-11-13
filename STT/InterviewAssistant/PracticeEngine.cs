using System.Text;
using System.Text.RegularExpressions;

namespace InterviewAssistant;

public static partial class PracticeEngine
{
    public static string BuildEvalPrompt(AppSettings settings, PracticeQuestion question, string userAnswer)
    {
        var sb = new StringBuilder();
        sb.AppendLine("You are an interview coach evaluating a practice answer.");
        sb.AppendLine();
        sb.AppendLine($"Round type: {InterviewStyles.Name(question.RoundType)}");
        sb.AppendLine($"Question: {question.Text}");
        sb.AppendLine($"Candidate's answer: {userAnswer}");
        sb.AppendLine();
        if (settings.Profile.Trim().Length > 0)
            sb.AppendLine($"Candidate profile: {settings.Profile.Trim()}");
        var stories = settings.Stories?.Where(s => !s.IsEmpty).ToList() ?? [];
        if (stories.Count > 0)
        {
            sb.AppendLine("Candidate's stories:");
            for (int i = 0; i < stories.Count; i++)
                sb.AppendLine(stories[i].Format(i + 1));
        }
        sb.AppendLine();
        sb.AppendLine("""
            Evaluate the answer and respond in EXACTLY this format:

            SCORE: <1-10>
            FEEDBACK: <2-3 sentences on what was good and what to improve. Be specific and actionable.>
            FOLLOW_UP: <A follow-up question the interviewer would likely ask next, based on the answer.>
            """);
        return sb.ToString();
    }

    public sealed record EvalResult(int Score, string Feedback, string FollowUp);

    public static async Task<EvalResult> EvaluateAsync(AppSettings settings, PracticeQuestion question, string userAnswer, CancellationToken token)
    {
        string key = settings.AnswerEngine == AnswerEngine.DeepSeek
            ? ProtectedText.Unprotect(settings.DeepSeekKeyProtected) ?? ""
            : ProtectedText.Unprotect(settings.OpenAiKeyProtected) ?? "";
        string model = settings.AnswerEngine == AnswerEngine.DeepSeek
            ? settings.DeepSeekModel
            : settings.OpenAiModel;

        if (key.Length == 0 || model.Length == 0)
            throw new DirectChatException("An API key and model are needed for practice mode. Set them in Settings > Answers.");

        var messages = new List<ChatMessage>
        {
            new("system", "You are a professional interview coach. Give honest, actionable feedback."),
            new("user", BuildEvalPrompt(settings, question, userAnswer)),
        };

        var result = new StringBuilder();
        await foreach (string chunk in DirectChat.StreamAsync(settings.AnswerEngine, key, model, messages, token))
        {
            result.Append(chunk);
        }
        return ParseEval(result.ToString());
    }

    static EvalResult ParseEval(string text)
    {
        int score = 5;
        string feedback = "";
        string followUp = "";

        var scoreMatch = ScorePattern().Match(text);
        if (scoreMatch.Success && int.TryParse(scoreMatch.Groups[1].Value, out int s))
            score = Math.Clamp(s, 1, 10);

        var feedbackMatch = FeedbackPattern().Match(text);
        if (feedbackMatch.Success)
            feedback = feedbackMatch.Groups[1].Value.Trim();

        var followUpMatch = FollowUpPattern().Match(text);
        if (followUpMatch.Success)
            followUp = followUpMatch.Groups[1].Value.Trim();

        if (feedback.Length == 0)
            feedback = text.Trim();

        return new EvalResult(score, feedback, followUp);
    }

    [GeneratedRegex(@"SCORE:\s*(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex ScorePattern();

    [GeneratedRegex(@"FEEDBACK:\s*(.+?)(?=FOLLOW_UP:|$)", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex FeedbackPattern();

    [GeneratedRegex(@"FOLLOW_UP:\s*(.+?)$", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex FollowUpPattern();
}
