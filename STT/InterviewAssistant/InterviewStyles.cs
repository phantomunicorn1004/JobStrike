using System.Text.RegularExpressions;

namespace InterviewAssistant;

/// <summary>The kind of interview round: it sets what answers should focus on and how long they are.</summary>
public enum InterviewType
{
    Screening,
    Behavioral,
    Technical,
    SystemDesign,
    Coding,
    Final,
}

public enum AnswerLength
{
    Short,
    Normal,
    Detailed,
}

/// <summary>
/// How answers should look for each kind of round and each kind of question. Every answer starts
/// with a "Type: …" line naming the question's type; the app shows it as a chip and removes it from
/// the answer. Used in both answer engines: with an API it is part of the instructions for every
/// question, with the chat pages it is added to the call prompt.
/// </summary>
public static partial class InterviewStyles
{
    public static readonly InterviewType[] All = Enum.GetValues<InterviewType>();

    public static string Name(InterviewType type) => type switch
    {
        InterviewType.Screening => "Screening / recruiter",
        InterviewType.Behavioral => "HR / behavioral",
        InterviewType.Technical => "Technical",
        InterviewType.SystemDesign => "System design",
        InterviewType.Coding => "Coding",
        InterviewType.Final => "Final / manager",
        _ => type.ToString(),
    };

    static string Focus(InterviewType type) => type switch
    {
        InterviewType.Screening =>
            "This is a recruiter screening call. Keep answers short, warm and confident: a crisp background summary, "
            + "motivation for this company and role, and direct answers on salary expectations, availability, location and work authorization.",
        InterviewType.Behavioral =>
            "This is an HR / behavioral round. Answer experience questions as STAR stories (Situation, Task, Action, Result) "
            + "with concrete numbers, and show ownership, teamwork, handling conflict and learning from mistakes.",
        InterviewType.Technical =>
            "This is a technical round. Be precise: state the concept or decision, the trade-offs, and a concrete example "
            + "from my experience. Use the correct terms; do not pad.",
        InterviewType.SystemDesign =>
            "This is a system design round. Structure answers as requirements and scale, then the main components and data flow, "
            + "then storage, scaling and bottlenecks, then trade-offs and what I would monitor. Mention numbers (requests per second, data size) when useful.",
        InterviewType.Coding =>
            "This is a coding round. Give the approach first in plain words, then the time and space complexity, then the key steps "
            + "and edge cases as talking points. Show code only when asked, short and in the language the interviewer uses.",
        InterviewType.Final =>
            "This is a final round with a manager or senior leader. Emphasize impact, ownership, decisions under ambiguity, "
            + "leadership and why this team; keep it confident and concise.",
        _ => "",
    };

    static string Length(AnswerLength length) => length switch
    {
        AnswerLength.Short => "Keep every answer under 60 words unless the interviewer asks for detail.",
        AnswerLength.Detailed => "Answers may run to about 200 words when the question needs depth.",
        _ => "Keep answers under about 120 words unless it is a design or coding question.",
    };

    /// <summary>The instructions added to the user's call prompt for this round.</summary>
    public static string Instructions(InterviewType type, AnswerLength length) =>
        $"""
        Interview round: {Name(type)}. {Focus(type)}

        Start every reply with one line "Type: <kind>" on its own, followed by an empty line, where <kind> is one of: Behavioral, Technical, System design, Coding, Logistics, Small talk, Question for you. Then answer in the format for that kind of question, whatever the round:
        - Behavioral: a STAR story, one short bullet each for Situation, Task, Action, Result.
        - Technical: a one-sentence answer, then 2-3 bullets with specifics from my experience.
        - System design: short sections for requirements, components, scaling, trade-offs.
        - Coding: approach, complexity, key steps and edge cases.
        - Logistics (salary, start date, location, visa, notice period): one or two plain sentences.
        - Small talk or not a question: reply with just "-".
        - Question for you (the interviewer asks what I want to know): 2-3 thoughtful questions to ask them.
        Always open with one sentence I can say right away. {Length(length)}
        """;

    /// <summary>A follow-up that reworks the last answer.</summary>
    public static string FollowUp(string kind) => kind switch
    {
        "Shorter" => "Make that answer much shorter: one sentence I can say right now, then at most two short bullets.",
        "Example" => "Give one concrete example from my background that supports that answer, as I would say it.",
        "Detail" => "Go deeper on that answer: add specifics, numbers and the reasoning behind it.",
        "STAR" => "Retell that answer as a STAR story: one short bullet each for Situation, Task, Action and Result.",
        _ => kind,
    };

    /// <summary>
    /// Takes the leading "Type: …" line off an answer (also while it is still being written) and
    /// returns the type, or null when the answer has none.
    /// </summary>
    public static string? TakeQuestionType(List<AnswerBlock> blocks)
    {
        if (blocks.Count == 0 || blocks[0].Kind is not ("p" or "h"))
        {
            return null;
        }
        string first = string.Concat(blocks[0].Runs.Select(r => r.Text)).Trim();
        if (TypeLine().Match(first) is { Success: true } match)
        {
            string type = match.Groups[1].Value.Trim().TrimEnd('.', ']', ')');
            string rest = match.Groups[2].Value.Trim();
            blocks.RemoveAt(0);
            if (rest.Length > 0)
            {
                // The page or the model put the answer on the same line as the type.
                blocks.Insert(0, new AnswerBlock("p", 0, "", [new AnswerRun(rest, false, false, false)], "p|rest|" + rest));
            }
            return type.Length > 0 ? type : null;
        }
        // The first letters of "Type:" while the answer is still starting: hide them.
        if (first.Length < 5 && "type:".StartsWith(first.ToLowerInvariant(), StringComparison.Ordinal) && first.Length > 0)
        {
            blocks.RemoveAt(0);
        }
        return null;
    }

    [GeneratedRegex(@"^\[?\**type\**\s*:\s*\**([A-Za-z /-]{0,40}?)\**\]?(?:\s*(?:\n|$)|\s{2,}|[.:]\s+)(.*)$", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex TypeLine();
}
