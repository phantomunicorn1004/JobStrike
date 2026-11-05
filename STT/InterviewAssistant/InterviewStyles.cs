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
        AnswerLength.Short => "Keep the sentence and bullets under 60 words in all, and add the --- details only when asked.",
        AnswerLength.Detailed => "Keep the part before --- under about 100 words; the details may run to about 200 words.",
        _ => "Keep the part before --- under about 80 words.",
    };

    /// <summary>
    /// The instructions for this round. Every answer has one shape so it can be read at a glance:
    /// the sentence to say first, bold-keyed talking points, then optional details after a "---"
    /// line, which the app folds away until asked for.
    /// </summary>
    public static string Instructions(InterviewType type, AnswerLength length) =>
        $"""
        Interview round: {Name(type)}. {Focus(type)}

        Start every reply with one line "Type: <kind>" on its own, followed by an empty line, where <kind> is one of: Behavioral, Technical, System design, Coding, Logistics, Small talk, Question for you.

        Then give every answer the same shape, so I can glance at it while I talk:
        1. One sentence I can say right away, as its own paragraph (no heading, no bullet, no label).
        2. 2-4 short bullets of talking points, each starting with a **bold key phrase**.
        3. Only when the question needs depth: a line with just --- and then the details (the full story, design sections, code, numbers).
        The talking points for each kind of question:
        - Behavioral: one bullet each for **Situation**, **Task**, **Action** and **Result**, with numbers in the result.
        - Technical: the key facts, and a specific from my experience.
        - System design: requirements, main components, scaling, trade-offs; the deeper design after ---.
        - Coding: approach, time and space complexity, edge cases; code only after --- and only when it helps.
        - Logistics (salary, start date, location, visa, notice period): just the sentence, no bullets.
        - Small talk or not a question: reply with just "-".
        - Question for you (the interviewer asks what I want to know): the sentence, then 2-3 questions to ask them as bullets.
        {Length(length)}
        """;

    /// <summary>A follow-up that reworks the last answer, in the same shape.</summary>
    public static string FollowUp(string kind) => kind switch
    {
        "Shorter" => "Make that answer much shorter: the one sentence, then at most two short bullets, and no details.",
        "Example" => "Give one concrete example from my background that supports that answer, as I would say it, in the same shape.",
        "Detail" => "Go deeper on that answer: keep the sentence and bullets, then after --- add specifics, numbers and the reasoning.",
        "STAR" => "Retell that answer as a STAR story: the one sentence, then one bullet each for **Situation**, **Task**, **Action** and **Result**.",
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
