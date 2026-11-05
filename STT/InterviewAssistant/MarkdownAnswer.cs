using System.Text;
using System.Text.RegularExpressions;

namespace InterviewAssistant;

/// <summary>
/// Turns an answer written in Markdown (as the AI APIs write it) into the same blocks the answer
/// reader shows for the chat pages: headings, paragraphs, bullets and numbers, code, rules, with
/// bold, italic and inline code. A part that is still being written is shown as far as it goes.
/// </summary>
public static partial class MarkdownAnswer
{
    public static List<AnswerBlock> Parse(string markdown)
    {
        var blocks = new List<AnswerBlock>();
        var paragraph = new StringBuilder();
        string[] lines = markdown.Replace("\r\n", "\n").Split('\n');

        void FlushParagraph()
        {
            if (paragraph.Length > 0)
            {
                Add("p", 0, "", Inline(paragraph.ToString().Trim()));
                paragraph.Clear();
            }
        }

        void Add(string kind, int level, string marker, List<AnswerRun> runs) =>
            blocks.Add(new AnswerBlock(kind, level, marker, runs,
                $"{kind}|{level}|{marker}|{string.Join("\u0001", runs.Select(r => $"{r.Text}{(r.Bold ? 1 : 0)}{(r.Italic ? 1 : 0)}{(r.Code ? 1 : 0)}"))}"));

        for (int i = 0; i < lines.Length; i++)
        {
            string line = lines[i];
            if (line.TrimStart().StartsWith("```", StringComparison.Ordinal))
            {
                FlushParagraph();
                var code = new StringBuilder();
                for (i++; i < lines.Length && !lines[i].TrimStart().StartsWith("```", StringComparison.Ordinal); i++)
                {
                    code.Append(code.Length > 0 ? "\n" : "").Append(lines[i]);
                }
                Add("code", 0, "", [new AnswerRun(code.ToString(), false, false, true)]);
                continue;
            }
            if (line.Trim().Length == 0)
            {
                FlushParagraph();
                continue;
            }
            if (TypeLinePattern().IsMatch(line))
            {
                // The "Type: …" line stays on its own, so it can be taken off the answer.
                FlushParagraph();
                Add("p", 0, "", Inline(line.Trim()));
                continue;
            }
            if (HeadingPattern().Match(line) is { Success: true } heading)
            {
                FlushParagraph();
                Add("h", heading.Groups[1].Length, "", Inline(heading.Groups[2].Value.Trim()));
                continue;
            }
            if (RulePattern().IsMatch(line))
            {
                FlushParagraph();
                Add("hr", 0, "", []);
                continue;
            }
            if (ListPattern().Match(line) is { Success: true } item)
            {
                FlushParagraph();
                int indent = item.Groups[1].Value.Replace("\t", "    ").Length;
                string bullet = item.Groups[2].Value;
                string marker = char.IsDigit(bullet[0]) ? bullet.TrimEnd(')', '.') + "." : "•";
                Add("li", 1 + indent / 2, marker, Inline(item.Groups[3].Value.Trim()));
                continue;
            }
            // Lines of one paragraph are joined, as Markdown shows them.
            paragraph.Append(paragraph.Length > 0 ? " " : "").Append(line.Trim());
        }
        FlushParagraph();
        return blocks;
    }

    /// <summary>**bold**, __bold__, *italic*, `code`; an unclosed marker (still being written) is dropped.</summary>
    static List<AnswerRun> Inline(string text)
    {
        var runs = new List<AnswerRun>();
        int at = 0;
        foreach (Match m in InlinePattern().Matches(text))
        {
            if (m.Index > at)
            {
                runs.Add(new AnswerRun(Clean(text[at..m.Index]), false, false, false));
            }
            if (m.Groups["code"].Success)
            {
                runs.Add(new AnswerRun(m.Groups["code"].Value, false, false, true));
            }
            else if (m.Groups["bold"].Success || m.Groups["bold2"].Success)
            {
                runs.Add(new AnswerRun(m.Groups["bold"].Success ? m.Groups["bold"].Value : m.Groups["bold2"].Value, true, false, false));
            }
            else
            {
                runs.Add(new AnswerRun(m.Groups["italic"].Value, false, true, false));
            }
            at = m.Index + m.Length;
        }
        if (at < text.Length)
        {
            runs.Add(new AnswerRun(Clean(text[at..]), false, false, false));
        }
        return runs.Where(r => r.Text.Length > 0).ToList();
    }

    static string Clean(string text) => text.Replace("**", "").Replace("`", "");

    [GeneratedRegex(@"^\s*\[?\**type\**\s*:", RegexOptions.IgnoreCase)]
    private static partial Regex TypeLinePattern();

    [GeneratedRegex(@"^\s{0,3}(#{1,6})\s+(.*)$")]
    private static partial Regex HeadingPattern();

    [GeneratedRegex(@"^\s{0,3}([-*_])(\s*\1){2,}\s*$")]
    private static partial Regex RulePattern();

    [GeneratedRegex(@"^(\s*)([-*+•]|\d+[.)])\s+(.*)$")]
    private static partial Regex ListPattern();

    [GeneratedRegex(@"`(?<code>[^`]+)`|\*\*(?<bold>[^*]+)\*\*|__(?<bold2>[^_]+)__|(?<![\w*])\*(?<italic>[^*\s][^*]*?)\*(?![\w*])")]
    private static partial Regex InlinePattern();
}
