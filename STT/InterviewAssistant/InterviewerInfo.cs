namespace InterviewAssistant;

public sealed class InterviewerInfo
{
    public string Name { get; set; } = "";
    public string Role { get; set; } = "";
    public string Team { get; set; } = "";
    public string Notes { get; set; } = "";

    public bool IsEmpty => Name.Trim().Length == 0 && Role.Trim().Length == 0;

    public string Format()
    {
        if (IsEmpty) return "(not provided)";
        var lines = new List<string>();
        if (Name.Trim().Length > 0) lines.Add($"Name: {Name.Trim()}");
        if (Role.Trim().Length > 0) lines.Add($"Role: {Role.Trim()}");
        if (Team.Trim().Length > 0) lines.Add($"Team: {Team.Trim()}");
        if (Notes.Trim().Length > 0) lines.Add($"Background: {Notes.Trim()}");
        return string.Join("\n", lines);
    }

    public void Normalize()
    {
        Name ??= "";
        Role ??= "";
        Team ??= "";
        Notes ??= "";
    }

    public void Clear()
    {
        Name = "";
        Role = "";
        Team = "";
        Notes = "";
    }
}
