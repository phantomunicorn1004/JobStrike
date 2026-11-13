namespace InterviewAssistant;

public sealed class StoryEntry
{
    public string Title { get; set; } = "";
    public string Competency { get; set; } = "";
    public string Action { get; set; } = "";
    public string Result { get; set; } = "";

    public bool IsEmpty => Title.Trim().Length == 0 && Action.Trim().Length == 0;

    public string Format(int index)
    {
        string line = $"{index}. {Title.Trim()}";
        if (Competency.Trim().Length > 0) line += $" ({Competency.Trim()})";
        line += $": {Action.Trim()}";
        if (Result.Trim().Length > 0) line += $" → {Result.Trim()}";
        return line;
    }
}
