namespace InterviewAssistant;

public sealed class RoundRecord
{
    public string Date { get; set; } = "";
    public InterviewType InterviewType { get; set; }
    public string InterviewerName { get; set; } = "";
    public string InterviewerRole { get; set; } = "";
    public List<string> StoriesUsed { get; set; } = [];
    public List<string> KeyPoints { get; set; } = [];
    public string SalaryMentioned { get; set; } = "";

    public string Summary()
    {
        var parts = new List<string>();
        parts.Add($"{InterviewStyles.Name(InterviewType)}");
        if (InterviewerName.Length > 0) parts.Add($"with {InterviewerName}");
        if (Date.Length > 0) parts.Add($"on {Date}");
        return string.Join(" ", parts);
    }

    public string DetailSummary()
    {
        var lines = new List<string> { Summary() };
        if (StoriesUsed.Count > 0) lines.Add($"Stories used: {string.Join(", ", StoriesUsed)}");
        if (SalaryMentioned.Length > 0) lines.Add($"Salary mentioned: {SalaryMentioned}");
        if (KeyPoints.Count > 0) lines.Add($"Key points: {string.Join("; ", KeyPoints)}");
        return string.Join("\n", lines);
    }
}
