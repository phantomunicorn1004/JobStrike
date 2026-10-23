using System.Text;
using System.Text.RegularExpressions;

namespace InterviewAssistant;

/// <summary>
/// Builds a running transcript from Live Captions snapshots and remembers how much of it
/// has already been sent to the chat.
///
/// Live Captions exposes its whole caption buffer (a few thousand characters) as one string.
/// While someone speaks, the end of that string is revised (punctuation, re-recognised words),
/// and when the buffer is full whole paragraphs are dropped from the front. Each snapshot is
/// therefore aligned against the previous one: the text before the alignment point is kept,
/// everything after it is replaced by the new snapshot exactly as Live Captions shows it.
/// </summary>
public sealed partial class CaptionTracker
{
    static readonly int[] ProbeLengths = [32, 12];
    const int MinProbeLength = 12;

    string _transcript = "";
    string _lastSnapshot = "";
    int _snapshotStart;   // index in _transcript where _lastSnapshot begins
    int _sentUpTo;        // characters of _transcript already sent or discarded
    bool _hasBaseline;

    public string Transcript => _transcript;
    public int SentUpTo => _sentUpTo;

    /// <summary>Characters at the start of the transcript that can no longer change (already trimmed from Live Captions).</summary>
    public int StableLength => _snapshotStart;
    public string Pending => CleanForSending(_transcript[_sentUpTo..]);
    public int PendingWordCount => CountWords(Pending);

    /// <summary>Feeds one Live Captions snapshot. Returns true when the transcript changed.</summary>
    public bool Update(string snapshot)
    {
        snapshot = snapshot.Replace("\r\n", "\n").Replace('\r', '\n').TrimEnd();

        if (!_hasBaseline)
        {
            // Whatever is on screen when we start is history: show it, but never send it.
            _hasBaseline = true;
            _transcript = snapshot;
            _lastSnapshot = snapshot;
            _snapshotStart = 0;
            _sentUpTo = snapshot.Length;
            return true;
        }

        if (snapshot == _lastSnapshot)
        {
            return false;
        }

        if (snapshot.Length == 0)
        {
            // Live Captions was restarted or cleared; the next text starts a new block.
            StartNewBlock();
            return false;
        }

        int shift = FindShift(_lastSnapshot, snapshot);
        if (shift < 0)
        {
            StartNewBlock();
            shift = 0;
        }

        string previous = _transcript;
        int start = _snapshotStart + shift;
        _transcript = previous[..start] + snapshot;
        _snapshotStart = start;
        _lastSnapshot = snapshot;
        RemapSentMarker(previous, start);
        SnapSentMarkerToWordEnd();
        return _transcript != previous;
    }

    /// <summary>Counts Send and Discard actions, so a failed send can tell whether a later one happened.</summary>
    public int TakeCount { get; private set; }

    /// <summary>Returns the pending text and marks it as sent.</summary>
    public (string Text, int PreviousMarker) TakePending()
    {
        int previous = _sentUpTo;
        string text = Pending;
        _sentUpTo = _transcript.Length;
        TakeCount++;
        return (text, previous);
    }

    /// <summary>Puts text back into the pending range after a failed send.</summary>
    public void RestoreMarker(int marker) => _sentUpTo = Math.Clamp(marker, 0, _transcript.Length);

    public void DiscardPending()
    {
        _sentUpTo = _transcript.Length;
        TakeCount++;
    }

    /// <summary>
    /// A word that was cut off when it was sent ("scal") and then completed by Live Captions
    /// ("scalability") counts as sent in full, so the next message does not start with "ability".
    /// </summary>
    void SnapSentMarkerToWordEnd()
    {
        static bool IsWordChar(char c) => char.IsLetterOrDigit(c) || c is '\'' or '’';
        if (_sentUpTo <= 0 || _sentUpTo >= _transcript.Length || !char.IsLetterOrDigit(_transcript[_sentUpTo - 1]))
        {
            return;
        }
        while (_sentUpTo < _transcript.Length && IsWordChar(_transcript[_sentUpTo]))
        {
            _sentUpTo++;
        }
    }

    void StartNewBlock()
    {
        if (_transcript.Length > 0 && !_transcript.EndsWith('\n'))
        {
            _transcript += "\n";
        }
        _snapshotStart = _transcript.Length;
        _lastSnapshot = "";
    }

    /// <summary>
    /// How many characters were dropped from the front of the buffer between two snapshots,
    /// or -1 when the new snapshot does not continue the previous one.
    /// </summary>
    static int FindShift(string previous, string current)
    {
        if (previous.Length == 0)
        {
            return 0;
        }

        // Probes are taken from the start of the buffer and of each paragraph, where the text
        // is stable; short probes avoid reaching into a tail that is still being revised.
        foreach (int offset in ProbeOffsets(current))
        {
            foreach (int probeLength in ProbeLengths)
            {
                int length = Math.Min(probeLength, current.Length - offset);
                if (length < Math.Min(MinProbeLength, current.Length))
                {
                    continue;
                }
                string probe = current.Substring(offset, length);
                int bestShift = -1;
                int bestScore = -1;
                for (int at = previous.IndexOf(probe, StringComparison.Ordinal);
                     at >= 0;
                     at = previous.IndexOf(probe, at + 1, StringComparison.Ordinal))
                {
                    int shift = at - offset;
                    if (shift < 0)
                    {
                        continue;
                    }
                    // Repeated phrases can match in several places; the right alignment is the
                    // one where the two snapshots agree for the longest stretch.
                    int score = CommonPrefixLength(previous, at, current, offset);
                    if (score > bestScore)
                    {
                        bestScore = score;
                        bestShift = shift;
                    }
                }
                if (bestShift >= 0)
                {
                    return bestShift;
                }
            }
        }

        // No stable text in common. A short buffer that was revised as a whole keeps its
        // position; a much shorter, unrelated buffer means Live Captions started over.
        return current.Length * 2 >= previous.Length ? 0 : -1;
    }

    static IEnumerable<int> ProbeOffsets(string text)
    {
        yield return 0;
        int found = 0;
        for (int i = text.IndexOf('\n'); i >= 0 && found < 6; i = text.IndexOf('\n', i + 1), found++)
        {
            if (i + 1 < text.Length)
            {
                yield return i + 1;
            }
        }
    }

    /// <summary>
    /// Keeps the sent marker on the same spoken words when Live Captions revises text that was
    /// already sent (for example "the hardest SC" becoming "the hardest scaling?").
    /// </summary>
    void RemapSentMarker(string previous, int unchangedUpTo)
    {
        int common = unchangedUpTo + CommonPrefixLength(previous, unchangedUpTo, _transcript, unchangedUpTo);
        if (_sentUpTo <= common)
        {
            return;
        }

        var sentWords = Words(previous, common, Math.Min(_sentUpTo, previous.Length));
        if (sentWords.Count == 0)
        {
            _sentUpTo = common;
            return;
        }
        var newWords = Words(_transcript, common, _transcript.Length);
        if (newWords.Count == 0)
        {
            _sentUpTo = Math.Min(_sentUpTo, _transcript.Length);
            return;
        }

        // Longest common subsequence of normalised words, limited to the revised region.
        int n = sentWords.Count;
        int m = Math.Min(newWords.Count, n + 12);
        var lcs = new int[n + 1, m + 1];
        for (int i = n - 1; i >= 0; i--)
        {
            for (int j = m - 1; j >= 0; j--)
            {
                lcs[i, j] = sentWords[i].Key == newWords[j].Key
                    ? lcs[i + 1, j + 1] + 1
                    : Math.Max(lcs[i + 1, j], lcs[i, j + 1]);
            }
        }

        int lastSent = -1, lastNew = -1;
        for (int i = 0, j = 0; i < n && j < m;)
        {
            if (sentWords[i].Key == newWords[j].Key)
            {
                lastSent = i;
                lastNew = j;
                i++;
                j++;
            }
            else if (lcs[i + 1, j] >= lcs[i, j + 1])
            {
                i++;
            }
            else
            {
                j++;
            }
        }

        // Sent words after the last match were re-recognised as different words; treat them
        // as substitutions so they are not sent a second time.
        int target = lastNew + (n - 1 - lastSent);
        target = Math.Clamp(target, 0, newWords.Count - 1);
        _sentUpTo = common + newWords[target].End;
    }

    readonly record struct Word(string Key, int End);

    static List<Word> Words(string text, int from, int to)
    {
        var words = new List<Word>();
        if (to <= from)
        {
            return words;
        }
        foreach (Match match in WordPattern().Matches(text[from..to]))
        {
            string key = NormalizeWord(match.Value);
            if (key.Length > 0)
            {
                words.Add(new Word(key, match.Index + match.Length));
            }
        }
        return words;
    }

    static string NormalizeWord(string word)
    {
        var sb = new StringBuilder(word.Length);
        foreach (char c in word)
        {
            if (char.IsLetterOrDigit(c))
            {
                sb.Append(char.ToLowerInvariant(c));
            }
        }
        return sb.ToString();
    }

    static int CommonPrefixLength(string a, int aStart, string b, int bStart)
    {
        int length = Math.Min(a.Length - aStart, b.Length - bStart);
        int i = 0;
        while (i < length && a[aStart + i] == b[bStart + i])
        {
            i++;
        }
        return i;
    }

    /// <summary>Joins paragraphs into one line and drops punctuation left over from the previous send.</summary>
    public static string CleanForSending(string text)
    {
        string flat = WhitespacePattern().Replace(text, " ").Trim();
        return LeadingPunctuationPattern().Replace(flat, "");
    }

    public static int CountWords(string text) => WordPattern().Matches(text).Count;

    [GeneratedRegex(@"\S+")]
    private static partial Regex WordPattern();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespacePattern();

    [GeneratedRegex(@"^[^\p{L}\p{N}""'(]+")]
    private static partial Regex LeadingPunctuationPattern();
}
