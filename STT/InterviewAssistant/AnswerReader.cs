using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;

namespace InterviewAssistant;

/// <summary>One run of text inside a block, with the styling the chat page shows.</summary>
public sealed record AnswerRun(string Text, bool Bold, bool Italic, bool Code);

/// <summary>
/// One block of the latest answer. Kind: "h" heading, "p" paragraph, "li" list item, "code" code
/// block, "hr" rule. Key is the block's JSON, used to redraw only blocks that changed.
/// </summary>
public sealed record AnswerBlock(string Kind, int Level, string Marker, IReadOnlyList<AnswerRun> Runs, string Key);

/// <summary>The latest answer on the chat page. MessageId and MessageCount change when a new answer starts.</summary>
public sealed record AnswerSnapshot(
    string MessageId, int MessageCount, bool Generating, string? Question, IReadOnlyList<AnswerBlock> Blocks)
{
    public static AnswerSnapshot Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var blocks = new List<AnswerBlock>();
        foreach (var block in root.GetProperty("blocks").EnumerateArray())
        {
            var runs = new List<AnswerRun>();
            if (block.TryGetProperty("runs", out var runArray))
            {
                foreach (var run in runArray.EnumerateArray())
                {
                    runs.Add(new AnswerRun(
                        run.GetProperty("text").GetString() ?? "",
                        run.TryGetProperty("b", out var b) && b.GetBoolean(),
                        run.TryGetProperty("i", out var i) && i.GetBoolean(),
                        run.TryGetProperty("c", out var c) && c.GetBoolean()));
                }
            }
            else if (block.TryGetProperty("text", out var text))
            {
                runs.Add(new AnswerRun(text.GetString() ?? "", false, false, true));
            }
            blocks.Add(new AnswerBlock(
                block.GetProperty("t").GetString() ?? "p",
                block.TryGetProperty("level", out var level) ? level.GetInt32() : 0,
                block.TryGetProperty("marker", out var marker) ? marker.GetString() ?? "" : "",
                runs,
                block.GetRawText()));
        }
        return new AnswerSnapshot(
            root.GetProperty("id").GetString() ?? "",
            root.GetProperty("count").GetInt32(),
            root.GetProperty("generating").GetBoolean(),
            root.TryGetProperty("question", out var question) ? question.GetString() : null,
            blocks);
    }

    /// <summary>
    /// Reads the latest assistant message into blocks. Bold, italic and code are taken from the
    /// computed style rather than tag names, because ChatGPT styles its spans with classes.
    /// </summary>
    public static string Script(ChatProvider provider) => $$$"""
        (() => {
          const provider = '{{{(provider == ChatProvider.DeepSeek ? "deepseek" : "chatgpt")}}}';
          const lastOf = (list) => list.length ? list[list.length - 1] : null;
          let msgs = [];
          let question = null;
          if (provider === 'chatgpt') {
            // Signed-out pages mark messages with data-message-role / data-message-author-role.
            msgs = [...document.querySelectorAll('li[data-message-role="assistant"], [data-message-author-role="assistant"]')];
            // Signed-in pages put a hidden "ChatGPT said:" heading (h4[data-conversation-role]) at
            // the top of each answer instead; the answer is the heading's parent.
            if (!msgs.length) msgs = [...document.querySelectorAll('h4[data-conversation-role="assistant"]')].map(h => h.parentElement);
            const q = lastOf([...document.querySelectorAll(
              'li[data-message-role="user"] [data-user-message-copy], [data-message-author-role="user"], [class*="user-message"][data-chatgpt-search-message-ids]')]);
            question = q ? q.innerText.trim() : null;
          } else {
            // DeepSeek only builds the messages inside its visible scroll range (a virtual list),
            // so keep that range at the newest message or the latest answer is not in the page.
            const list = document.querySelector('.ds-virtual-list');
            if (list && list.scrollHeight - list.scrollTop - list.clientHeight > 2) list.scrollTop = list.scrollHeight;
            msgs = [...document.querySelectorAll('.ds-markdown')].filter(e => !e.closest('[class*="think"]'));
          }
          if (!msgs.length) msgs = [...document.querySelectorAll('[class*="markdown"]')].filter(e => !e.parentElement.closest('[class*="markdown"]'));
          const msg = lastOf(msgs);
          // A stable identity for "this answer": ChatGPT message ids, DeepSeek list item keys.
          const keyed = msg ? msg.closest('[data-virtual-list-item-key]') : null;
          const id = msg ? (msg.id || msg.getAttribute('data-message-id') || msg.getAttribute('data-chatgpt-search-message-ids')
            || (keyed ? 'item-' + keyed.getAttribute('data-virtual-list-item-key') : '')) : '';
          if (provider === 'deepseek' && keyed) {
            const prev = keyed.previousElementSibling;
            if (prev && !prev.querySelector('.ds-markdown')) question = prev.innerText.trim() || null;
          }
          const root = msg ? (msg.querySelector('[data-assistant-markdown-root], .markdown, .ds-markdown') || msg) : null;
          const generating = {{{ChatBridge.GeneratingScript}}};
          const blocks = [];

          // Hidden screen-reader labels ("ChatGPT said:") are not part of the answer, nor are form fields
          // and invisible sizing copies (a writing block keeps its title in both, besides the visible one).
          const skip = el => el.matches('button, svg, style, script, textarea, input, select, [aria-hidden="true"], [hidden], .sr-only, .invisible, h4[data-message-attribution], h4[data-conversation-role]');
          const styleCache = new Map();
          const styleOf = el => {
            if (!styleCache.has(el)) {
              const s = getComputedStyle(el);
              styleCache.set(el, {
                b: (parseInt(s.fontWeight, 10) || 400) >= 600,
                i: s.fontStyle === 'italic',
                c: /mono|consolas|courier|menlo/i.test(s.fontFamily) || !!el.closest('code'),
                // Line breaks in the text only show on screen where white-space keeps them.
                keepsBreaks: /^(pre|pre-wrap|pre-line|break-spaces)$/.test(s.whiteSpace)
              });
            }
            return styleCache.get(el);
          };
          // Runs keep the line breaks the page shows (<br>, or newlines in pre-wrap text) as "\n";
          // all other whitespace collapses to single spaces, as the browser displays it.
          // runsOf takes a run of sibling nodes (loose text and inline elements); runs takes one element.
          const runsOf = nodes => {
            const out = [];
            const add = n => {
              const st = styleOf(n.parentElement);
              let text = n.nodeType === 1 ? '\n'
                : st.keepsBreaks ? n.nodeValue.replace(/[^\S\n]+/g, ' ') : n.nodeValue.replace(/\s+/g, ' ');
              const prev = out[out.length - 1];
              if (prev && prev.b === st.b && prev.i === st.i && prev.c === st.c) prev.text += text;
              else out.push({ text, b: st.b, i: st.i, c: st.c });
            };
            for (const node of nodes) {
              if (node.nodeType === 3 || node.tagName === 'BR') { add(node); continue; }
              const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: n => {
                for (let p = n.nodeType === 1 ? n : n.parentElement; p && p !== node; p = p.parentElement) {
                  if (skip(p) || /^(UL|OL|PRE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
                }
                if (n.nodeType === 1) return n.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                return NodeFilter.FILTER_ACCEPT;
              }});
              for (let n; (n = walker.nextNode());) add(n);
            }
            out.forEach(r => r.text = r.text.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n'));
            if (out.length) { out[0].text = out[0].text.replace(/^\s+/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, ''); }
            return out.filter(r => r.text.length);
          };
          const runs = el => runsOf([el]);
          const inlineTag = /^(SPAN|STRONG|B|EM|I|A|CODE|KBD|MARK|SUB|SUP|S|DEL|INS|U|SMALL|ABBR|Q|CITE|TIME|BR|LABEL|FONT)$/;
          const hasBlockChild = el => [...el.children].some(c => /^(P|UL|OL|PRE|H[1-6]|TABLE|BLOCKQUOTE|DIV|SECTION|HEADER)$/.test(c.tagName) && c.innerText.trim());
          // Text held directly in plain boxes (e.g. the title of ChatGPT's writing blocks) instead of
          // paragraphs. A code block's language banner (just before its <pre>) is left out.
          const isTextBox = el => !/^(UL|OL|LI|TABLE|TBODY|THEAD|TR)$/.test(el.tagName) && !hasBlockChild(el)
            && !el.querySelector('p, li, pre, table, hr, h1, h2, h3, h4, h5, h6')
            && !(el.nextElementSibling && el.nextElementSibling.tagName === 'PRE') && !el.closest('[class*="code-block"]');
          const walk = (el, list) => {
            // Loose text and inline elements between blocks (e.g. "<li><b>Scaling:</b> use sharding<ul>…")
            // form a line of their own, taking the list item's bullet if it has not been used yet.
            let inline = [];
            // Inside a code block only the code counts, not its banner (language name, buttons).
            const inCode = !!el.closest('[class*="code-block"]');
            const flush = () => {
              const r = inline.length ? runsOf(inline) : [];
              inline = [];
              if (!r.length) return;
              if (list && list.marker) { blocks.push({ t: 'li', level: list.depth, marker: list.marker, runs: r }); list.marker = null; }
              else blocks.push({ t: 'p', level: list ? list.depth : 0, runs: r });
            };
            for (const c of el.childNodes) {
              if (c.nodeType === 3) { if (!inCode) inline.push(c); continue; }
              if (c.nodeType !== 1 || skip(c)) continue;
              const tag = c.tagName;
              if (inCode && tag !== 'PRE' && !c.querySelector('pre')) continue;
              if (inlineTag.test(tag) && !c.querySelector('p, div, ul, ol, pre, table, h1, h2, h3, h4, h5, h6')) { inline.push(c); continue; }
              flush();
              if (/^H[1-6]$/.test(tag)) blocks.push({ t: 'h', level: +tag[1], runs: runs(c) });
              else if (tag === 'P') {
                if (list && list.marker) { blocks.push({ t: 'li', level: list.depth, marker: list.marker, runs: runs(c) }); list.marker = null; }
                else blocks.push({ t: 'p', level: list ? list.depth : 0, runs: runs(c) });
              }
              else if (tag === 'PRE') blocks.push({ t: 'code', text: (c.querySelector('code') || c).innerText.replace(/\n+$/, '') });
              else if (tag === 'HR') blocks.push({ t: 'hr' });
              else if (tag === 'UL' || tag === 'OL') walk(c, { depth: (list ? list.depth : 0) + 1, ordered: tag === 'OL', n: +(c.getAttribute('start') || 1), marker: null });
              else if (tag === 'LI' && list) {
                const marker = list.ordered ? (list.n++) + '.' : '•';
                if (hasBlockChild(c)) walk(c, { depth: list.depth, ordered: list.ordered, n: 1, marker });
                else blocks.push({ t: 'li', level: list.depth, marker, runs: runs(c) });
              }
              else if (tag === 'TR') blocks.push({ t: 'p', level: 0, runs: [{ text: [...c.children].map(td => td.innerText.trim()).join('   |   '), b: !!c.querySelector('th'), i: false, c: false }] });
              else if (isTextBox(c)) blocks.push({ t: 'p', level: list ? list.depth : 0, runs: runs(c) });
              else walk(c, list);
            }
            flush();
          };
          if (root) {
            walk(root, null);
            if (!blocks.length && root.innerText.trim()) blocks.push({ t: 'p', level: 0, runs: [{ text: root.innerText.trim(), b: false, i: false, c: false }] });
          }
          const kept = blocks.filter(b => b.t === 'hr' || b.t === 'code' || (b.runs && b.runs.length));
          return JSON.stringify({ id, count: msgs.length, generating, question, blocks: kept });
        })()
        """;
}

/// <summary>Turns answer blocks into a readable FlowDocument: large type, hanging bullets, bright bold terms.</summary>
public static partial class AnswerRenderer
{
    public static Block Render(AnswerBlock block, double fontSize, ResourceDictionary theme)
    {
        var text = (Brush)theme["Text"];
        var strong = (Brush)theme["Strong"];
        var highlight = (Brush)theme["Highlight"];
        var accent = (Brush)theme["Accent"];
        var codeBack = (Brush)theme["Surface"];
        var border = (Brush)theme["Border"];
        var mono = (FontFamily)theme["MonoFont"];
        var display = (FontFamily)theme["DisplayFont"];

        Paragraph paragraph = new()
        {
            FontSize = fontSize,
            LineHeight = Math.Round(fontSize * 1.6),
            Margin = new Thickness(0, 0, 0, fontSize * 0.6),
        };
        switch (block.Kind)
        {
            case "h":
                paragraph.FontFamily = display;
                paragraph.FontSize = fontSize * (block.Level <= 2 ? 1.3 : 1.12);
                paragraph.FontWeight = FontWeights.SemiBold;
                paragraph.Foreground = strong;
                paragraph.LineHeight = Math.Round(paragraph.FontSize * 1.35);
                paragraph.Margin = new Thickness(0, fontSize * 0.6, 0, fontSize * 0.4);
                break;
            case "li":
                double indent = 4 + Math.Max(0, block.Level - 1) * fontSize * 1.3;
                // The marker sits in a box of fixed width and the first line is pulled back by exactly
                // that width, so wrapped lines start precisely under the text. Numbers get one width
                // for the whole list (up to "999.") and are right-aligned, so 9. and 10. line up.
                bool numbered = block.Marker?.EndsWith('.') == true;
                double markerWidth = fontSize * (numbered ? 2.4 : 1.3);
                paragraph.Margin = new Thickness(indent + markerWidth, 0, 0, fontSize * 0.3);
                paragraph.TextIndent = -markerWidth;
                paragraph.Inlines.Add(new InlineUIContainer(new System.Windows.Controls.TextBlock
                {
                    Text = block.Marker,
                    Width = markerWidth,
                    TextAlignment = numbered ? TextAlignment.Right : TextAlignment.Left,
                    Padding = new Thickness(0, 0, numbered ? fontSize * 0.45 : 0, 0),
                    Foreground = accent,
                    FontSize = fontSize,
                    FontWeight = FontWeights.SemiBold,
                })
                {
                    BaselineAlignment = BaselineAlignment.Baseline,
                });
                break;
            case "code":
                paragraph.FontFamily = mono;
                paragraph.FontSize = fontSize * 0.82;
                paragraph.LineHeight = Math.Round(paragraph.FontSize * 1.5);
                paragraph.Background = codeBack;
                paragraph.BorderBrush = border;
                paragraph.BorderThickness = new Thickness(1);
                paragraph.Padding = new Thickness(12, 10, 12, 10);
                break;
            case "hr":
                paragraph.BorderBrush = border;
                paragraph.BorderThickness = new Thickness(0, 1, 0, 0);
                paragraph.Margin = new Thickness(0, fontSize * 0.4, 0, fontSize * 0.4);
                paragraph.FontSize = 1;
                paragraph.LineHeight = 1;
                return paragraph;
            default:
                paragraph.Margin = new Thickness(block.Level * fontSize * 1.3, 0, 0, fontSize * 0.55);
                break;
        }

        foreach (var run in block.Runs)
        {
            // A line break the page shows (one chunk per line) becomes a real line break here.
            string[] lines = run.Text.Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                if (i > 0)
                {
                    paragraph.Inlines.Add(new LineBreak());
                }
                if (run.Code || block.Kind == "h")
                {
                    paragraph.Inlines.Add(Styled(lines[i]));
                    continue;
                }
                // " / " and " // " are pause cues, drawn in the accent colour so they read as cues
                // rather than words.
                foreach (string part in PauseMark().Split(lines[i]))
                {
                    if (part.Length == 0)
                    {
                        continue;
                    }
                    paragraph.Inlines.Add(PauseMark().IsMatch(part)
                        ? new Run(part) { Foreground = accent, FontWeight = FontWeights.SemiBold }
                        : Styled(part));
                }
            }

            Run Styled(string value)
            {
                var inline = new Run(value) { Foreground = block.Kind == "h" ? strong : text };
                if (run.Bold)
                {
                    // Key terms (or stressed words) in a soft accent stand out at a glance without glaring.
                    inline.FontWeight = FontWeights.SemiBold;
                    inline.Foreground = block.Kind == "h" ? strong : highlight;
                }
                if (run.Italic)
                {
                    inline.FontStyle = FontStyles.Italic;
                }
                if (run.Code && block.Kind != "code")
                {
                    inline.FontFamily = mono;
                    inline.FontSize = fontSize * 0.88;
                    inline.Background = codeBack;
                    inline.Foreground = strong;
                }
                return inline;
            }
        }
        return paragraph;
    }

    /// <summary>A pause cue: "/" or "//" with spaces around it, kept as its own piece when splitting.</summary>
    [GeneratedRegex(@"( //? )")]
    private static partial Regex PauseMark();
}
