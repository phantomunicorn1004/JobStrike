namespace InterviewAssistant;

/// <summary>
/// Random buy-time phrases shown during AI answer generation latency, categorized by interview type.
/// The candidate says one of these while waiting for the AI to produce the real answer.
/// </summary>
public static class BuyTimePhrases
{
    sealed record Phrase(string Text, InterviewType[] Types);

    static readonly Phrase[] All =
    [
        // General — fit any stage
        new("Yeah, absolutely.", [InterviewType.Screening, InterviewType.Behavioral, InterviewType.Technical, InterviewType.SystemDesign, InterviewType.Final]),
        new("Sure, that's a good question.", [InterviewType.Screening, InterviewType.Behavioral, InterviewType.Technical, InterviewType.SystemDesign, InterviewType.Final]),
        new("Yeah, let me think about that.", [InterviewType.Screening, InterviewType.Behavioral, InterviewType.Technical, InterviewType.SystemDesign, InterviewType.Final]),
        new("That's a good one.", [InterviewType.Screening, InterviewType.Behavioral, InterviewType.Technical, InterviewType.SystemDesign, InterviewType.Final]),
        new("Yeah, so...", [InterviewType.Screening, InterviewType.Behavioral, InterviewType.Technical, InterviewType.SystemDesign, InterviewType.Final]),
        new("Well, I think...", [InterviewType.Screening, InterviewType.Behavioral, InterviewType.Technical, InterviewType.SystemDesign, InterviewType.Final]),
        new("Sure, let me think for a second.", [InterviewType.Screening, InterviewType.Behavioral, InterviewType.Technical, InterviewType.SystemDesign, InterviewType.Final]),

        // Screening / recruiter
        new("Yeah, that makes sense.", [InterviewType.Screening, InterviewType.Final]),
        new("Sure, I see what you mean.", [InterviewType.Screening, InterviewType.Final]),

        // Behavioral / HR
        new("One example comes to mind.", [InterviewType.Behavioral]),
        new("Yeah, I've dealt with something similar.", [InterviewType.Behavioral]),
        new("Sure, I can give you an example.", [InterviewType.Behavioral]),
        new("Yeah, I had a similar situation.", [InterviewType.Behavioral]),
        new("Let me think of a good example.", [InterviewType.Behavioral]),
        new("That reminds me of a project I worked on.", [InterviewType.Behavioral]),
        new("Absolutely, let me explain how I handled that.", [InterviewType.Behavioral]),

        // Technical
        new("Sure, let me walk through that.", [InterviewType.Technical, InterviewType.SystemDesign, InterviewType.Coding]),
        new("Yeah, I think the key point is...", [InterviewType.Technical, InterviewType.SystemDesign]),
        new("Absolutely. I'd start with the context.", [InterviewType.Technical, InterviewType.SystemDesign]),
        new("Sure, I'd start with the requirements.", [InterviewType.SystemDesign]),
        new("Yeah, I'd first look at the scale.", [InterviewType.SystemDesign]),
        new("There are a few trade-offs there.", [InterviewType.Technical, InterviewType.SystemDesign]),
        new("Sure, let me break that down.", [InterviewType.Technical, InterviewType.SystemDesign, InterviewType.Coding]),
        new("Yeah, I'd approach it step by step.", [InterviewType.Technical, InterviewType.Coding]),

        // Strong experience match
        new("Yeah, that's been a big part of my work.", [InterviewType.Technical, InterviewType.Behavioral]),
        new("Absolutely, I can speak to that.", [InterviewType.Technical, InterviewType.Behavioral]),
        new("Yeah, I've worked quite a bit with that.", [InterviewType.Technical]),

        // Limited experience (safe hedges)
        new("I'm familiar with it.", [InterviewType.Technical, InterviewType.Screening]),
        new("I've worked with similar technologies.", [InterviewType.Technical]),

        // Final round / manager
        new("Yeah, that's an interesting point.", [InterviewType.Final]),
        new("That's something I've thought about quite a bit.", [InterviewType.Final]),
        new("Yeah, there are a couple of ways to approach it.", [InterviewType.Final, InterviewType.SystemDesign]),
        new("Sure, from my experience...", [InterviewType.Final, InterviewType.Technical]),
        new("I'd say the biggest factor is...", [InterviewType.Final]),
    ];

    static readonly Random _random = new();
    static string? _lastPhrase;

    /// <summary>Returns a random buy-time phrase appropriate for the given interview type.</summary>
    public static string Pick(InterviewType type)
    {
        var candidates = All.Where(p => p.Types.Contains(type)).ToArray();
        if (candidates.Length == 0)
            candidates = All;

        // Avoid repeating the same phrase twice in a row.
        string pick;
        do
        {
            pick = candidates[_random.Next(candidates.Length)].Text;
        } while (pick == _lastPhrase && candidates.Length > 1);

        _lastPhrase = pick;
        return pick;
    }
}
