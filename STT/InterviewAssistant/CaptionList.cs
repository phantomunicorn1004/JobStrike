using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;

namespace InterviewAssistant;

/// <summary>
/// The caption transcript as one card per Live Captions paragraph (a pause in speech), with the
/// time it started. Only cards whose text or sent state changed are touched, so a long interview
/// costs no more to update than a short one; beyond <see cref="MaxCards"/> the oldest are dropped
/// from the view. Cards sit in groups of <see cref="GroupSize"/>: a change to the newest card then
/// makes WPF re-measure one small group instead of every card. Interview view shows the same text
/// as plain lines without cards.
/// </summary>
sealed class CaptionList(Panel host)
{
    const int MaxCards = 300;
    const int GroupSize = 20;

    sealed class Card
    {
        public required Border Root;
        public required TextBlock Time;
        public required Border WaitingTag;
        public required Run Sent;
        public required Run Waiting;
        public string Text = "";
        public int SentLength = -1;
    }

    readonly List<Card> _cards = [];
    // When each paragraph (by its start in the transcript) first appeared; kept when the cards are
    // rebuilt for the other view, forgotten when the transcript itself is cleared.
    readonly Dictionary<int, string> _times = [];
    readonly List<(int Start, int End)> _paragraphs = [];
    int _skipped;
    bool _compact;

    public int Count => _cards.Count;

    public void Clear(bool forgetTimes = false)
    {
        host.Children.Clear();
        _cards.Clear();
        _skipped = 0;
        if (forgetTimes)
        {
            _times.Clear();
        }
    }

    void Append(Card card)
    {
        if (host.Children.Count == 0 || ((Panel)host.Children[^1]).Children.Count >= GroupSize)
        {
            host.Children.Add(new StackPanel());
        }
        ((Panel)host.Children[^1]).Children.Add(card.Root);
        _cards.Add(card);
    }

    void Remove(Card card)
    {
        var group = (Panel)card.Root.Parent;
        group.Children.Remove(card.Root);
        if (group.Children.Count == 0)
        {
            host.Children.Remove(group);
        }
        _cards.Remove(card);
    }

    /// <summary>
    /// Shows <paramref name="transcript"/> from <paramref name="from"/>; text before
    /// <paramref name="sent"/> was sent (or discarded), the rest is waiting to be sent.
    /// </summary>
    public void Render(string transcript, int from, int sent, bool compact)
    {
        if (compact != _compact)
        {
            _compact = compact;
            Clear();
        }

        _paragraphs.Clear();
        for (int start = Math.Clamp(from, 0, transcript.Length); start < transcript.Length;)
        {
            int newline = transcript.IndexOf('\n', start);
            int end = newline < 0 ? transcript.Length : newline;
            if (end > start)
            {
                _paragraphs.Add((start, end));
            }
            start = end + 1;
        }

        int skip = Math.Max(0, _paragraphs.Count - MaxCards);
        if (_times.Count > MaxCards * 2 && _paragraphs.Count > 0)
        {
            int oldest = _paragraphs[skip].Start; // times of paragraphs no longer shown
            foreach (int start in _times.Keys.Where(k => k < oldest).ToList())
            {
                _times.Remove(start);
            }
        }
        if (skip < _skipped)
        {
            Clear(); // the transcript was cleared
        }
        else if (skip > _skipped)
        {
            for (int drop = Math.Min(skip - _skipped, _cards.Count); drop > 0; drop--)
            {
                Remove(_cards[0]);
            }
        }
        _skipped = skip;

        int count = _paragraphs.Count - skip;
        while (_cards.Count > count)
        {
            Remove(_cards[^1]);
        }
        for (int i = 0; i < count; i++)
        {
            var (start, end) = _paragraphs[skip + i];
            if (i == _cards.Count)
            {
                if (!_times.TryGetValue(start, out string? time))
                {
                    time = DateTime.Now.ToString("t");
                    _times[start] = time;
                }
                Append(NewCard(time));
            }
            var card = _cards[i];
            var span = transcript.AsSpan(start, end - start);
            int sentLength = Math.Clamp(sent - start, 0, span.Length);
            bool textChanged = !span.SequenceEqual(card.Text);
            if (textChanged)
            {
                card.Text = span.ToString();
            }
            if (textChanged || sentLength != card.SentLength)
            {
                card.SentLength = sentLength;
                Fill(card);
            }
        }
    }

    void Fill(Card card)
    {
        card.Sent.Text = card.Text[..card.SentLength];
        card.Waiting.Text = card.Text[card.SentLength..];
        if (_compact)
        {
            return;
        }
        bool waiting = card.Waiting.Text.Trim().Length > 0;
        card.WaitingTag.Visibility = waiting ? Visibility.Visible : Visibility.Collapsed;
        card.Root.SetResourceReference(Border.BackgroundProperty, waiting ? "PendingBg" : "Surface");
        card.Root.SetResourceReference(Border.BorderBrushProperty, waiting ? "Accent" : "Border");
    }

    Card NewCard(string startTime)
    {
        var sent = new Run();
        var waiting = new Run();
        var body = new TextBlock { TextWrapping = TextWrapping.Wrap };
        body.Inlines.Add(sent);
        body.Inlines.Add(waiting);
        // Waiting words stand out in the accent colour (a background would look like selected text).
        // The interview view's strip stays calm: waiting words in plain text, sent ones faded.
        waiting.SetResourceReference(TextElement.ForegroundProperty, _compact ? "Text" : "Highlight");
        sent.SetResourceReference(TextElement.ForegroundProperty, _compact ? "Faint" : "Text");

        var time = new TextBlock
        {
            Text = startTime,
            FontSize = 10.5,
            LineHeight = 14,
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
        };
        time.SetResourceReference(TextBlock.ForegroundProperty, "Faint");
        var tagText = new TextBlock { Text = "Waiting to send", FontSize = 10.5, LineHeight = 14, FontWeight = FontWeights.SemiBold };
        tagText.SetResourceReference(TextBlock.ForegroundProperty, "Accent");
        var tag = new Border
        {
            Child = tagText,
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(6, 1, 6, 1),
            Visibility = Visibility.Collapsed,
        };
        tag.SetResourceReference(Border.BackgroundProperty, "LilacBg");
        DockPanel.SetDock(tag, Dock.Right);

        var root = new Border();
        if (_compact)
        {
            root.Child = body;
            root.Margin = new Thickness(0, 0, 0, 2);
        }
        else
        {
            var header = new DockPanel { Margin = new Thickness(0, 0, 0, 4), LastChildFill = false };
            header.Children.Add(tag);
            header.Children.Add(time);
            var stack = new StackPanel();
            stack.Children.Add(header);
            stack.Children.Add(body);
            root.Child = stack;
            root.CornerRadius = new CornerRadius(10);
            root.BorderThickness = new Thickness(1);
            root.Padding = new Thickness(12, 8, 12, 10);
            root.Margin = new Thickness(0, 0, 0, 8);
        }
        return new Card { Root = root, Time = time, WaitingTag = tag, Sent = sent, Waiting = waiting };
    }
}
