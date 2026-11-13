using System.Text.RegularExpressions;

namespace InterviewAssistant;

public static partial class EmailExtractor
{
    public sealed record Result(string Name, string Role, string Team, string Notes);

    public static Result Extract(string emailText)
    {
        string name = "", role = "", team = "", notes = "";

        // "You'll be meeting with Sarah Kim, Senior Engineering Manager"
        // "Your interview with John Doe, Staff Software Engineer on the Platform team"
        // "You will be speaking with Jane Smith (Engineering Manager)"
        var meetingMatch = MeetingPattern().Match(emailText);
        if (meetingMatch.Success)
        {
            name = meetingMatch.Groups["name"].Value.Trim().TrimEnd(',', '.');
            string after = meetingMatch.Groups["after"].Value.Trim().TrimEnd(',', '.');
            if (after.Length > 0)
            {
                // "Senior Engineering Manager on the Platform team"
                var teamMatch = OnTeamPattern().Match(after);
                if (teamMatch.Success)
                {
                    role = teamMatch.Groups["role"].Value.Trim();
                    team = teamMatch.Groups["team"].Value.Trim();
                }
                else
                {
                    role = after;
                }
            }
        }

        // "Interviewer: Sarah Kim"
        if (name.Length == 0)
        {
            var interviewerMatch = InterviewerLabel().Match(emailText);
            if (interviewerMatch.Success)
            {
                name = interviewerMatch.Groups["name"].Value.Trim().TrimEnd(',', '.');
            }
        }

        // "with Sarah Kim (Senior Manager)"
        if (name.Length == 0)
        {
            var parenMatch = NameParenRole().Match(emailText);
            if (parenMatch.Success)
            {
                name = parenMatch.Groups["name"].Value.Trim();
                if (role.Length == 0) role = parenMatch.Groups["role"].Value.Trim();
            }
        }

        // Pick up any date/time as a note
        var timeMatch = TimePattern().Match(emailText);
        if (timeMatch.Success)
        {
            notes = timeMatch.Value.Trim();
        }

        // Clean up: remove extra whitespace, limit lengths
        name = Clean(name, 80);
        role = Clean(role, 120);
        team = Clean(team, 80);
        notes = Clean(notes, 200);

        return new Result(name, role, team, notes);
    }

    static string Clean(string value, int maxLength)
    {
        value = Whitespace().Replace(value.Trim(), " ");
        return value.Length > maxLength ? value[..maxLength] : value;
    }

    // "meeting with Name, Role" / "interview with Name, Role" / "speaking with Name, Role"
    [GeneratedRegex(@"(?:meeting|interview|speaking|talk(?:ing)?)\s+with\s+(?<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?:\s*[,\-]\s*(?<after>[^\n\r]{3,80}))?", RegexOptions.IgnoreCase)]
    private static partial Regex MeetingPattern();

    // "Role on the Team team" or "Role, Team"
    [GeneratedRegex(@"^(?<role>.+?)\s+(?:on|from|in)\s+(?:the\s+)?(?<team>.+?)(?:\s+team)?$", RegexOptions.IgnoreCase)]
    private static partial Regex OnTeamPattern();

    // "Interviewer: Name" or "Interviewer - Name"
    [GeneratedRegex(@"interviewer\s*[:\-]\s*(?<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})", RegexOptions.IgnoreCase)]
    private static partial Regex InterviewerLabel();

    // "with Name (Role)"
    [GeneratedRegex(@"with\s+(?<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*\((?<role>[^)]{2,60})\)", RegexOptions.IgnoreCase)]
    private static partial Regex NameParenRole();

    // Date/time patterns like "Monday, November 15 at 2:00 PM" or "2024-11-15 14:00"
    [GeneratedRegex(@"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*,?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s*,?\s*\d{4})?\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?", RegexOptions.IgnoreCase)]
    private static partial Regex TimePattern();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
