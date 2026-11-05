using System.Net.Http;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.RegularExpressions;
using Windows.Devices.Enumeration;
using Windows.Media.Core;
using Windows.Media.Devices;
using Windows.Media.Playback;
using Windows.Media.SpeechSynthesis;
using Windows.Storage.Streams;

namespace InterviewAssistant;

public sealed record VoiceChoice(string Id, string Name)
{
    public override string ToString() => Name; // what a list shows
}

public enum VoiceService
{
    /// <summary>Voices that come with Windows: offline, instant, but robotic.</summary>
    Windows,
    /// <summary>Google Cloud Text-to-Speech (as in Google Translate): natural, needs an API key.</summary>
    Google,
}

/// <summary>
/// Reads the AI answer aloud. It starts with the first finished sentence while the rest is still
/// being written, and plays on the chosen output device (headphones, so the interviewer does not
/// hear it). Each piece of text is turned into audio as soon as it is queued, so the next sentence
/// is ready when the current one ends; if the Google voice fails, that piece is read by the Windows
/// voice instead, so the answer is never left unread. Everything runs on the UI thread.
/// </summary>
public sealed partial class AnswerSpeaker : IDisposable
{
    // Short pieces start playing sooner; Google takes at most about 5,000 bytes per request.
    const int MaxPiece = 400;

    sealed record Clip(IRandomAccessStream Stream, string ContentType, string Voice, int Characters);

    readonly SynchronizationContext _ui;
    readonly SpeechSynthesizer _synth = new();
    readonly SemaphoreSlim _synthGate = new(1, 1);
    readonly Queue<Task<Clip?>> _clips = new();
    MediaPlayer _player;
    CancellationTokenSource _cancel = new();
    VoiceService _service;
    string _googleKey = "";
    string _googleVoice = GoogleSpeech.DefaultVoice;
    double _rate = 1;
    // Listen pressed again after an answer was read in full reads it slower, as Google Translate does.
    double _rateFactor = 1;
    string _deviceId = "";
    string _answerId = "";
    string _answerText = "";
    bool _answerComplete;
    int _queuedUpTo;
    // Answers that were already there, or that the user stopped, are not read (until Replay).
    bool _muted;
    int _generation;
    // Waiting for a clip or playing one; Speaking also covers the time the next one is being made.
    bool _busy;
    // Reading text the user selected rather than the answer.
    bool _readingText;
    bool _speaking;
    DateTime _lastProblem = DateTime.MinValue;

    public AnswerSpeaker()
    {
        _ui = SynchronizationContext.Current ?? new SynchronizationContext();
        _player = CreatePlayer();
    }

    /// <summary>Raised when the voice starts or stops.</summary>
    public event Action? SpeakingChanged;

    /// <summary>Raised (at most once a minute) when the Google voice failed and Windows read instead.</summary>
    public event Action<string>? Problem;

    public bool IsSpeaking => _speaking;

    /// <summary>The answer being followed and whether it was last read to the end (not stopped).</summary>
    public string AnswerId => _answerId;
    public bool FinishedReading { get; private set; }

    /// <summary>
    /// Reading an answer that is still being written: more of it will come, so the page has to be
    /// read on even while the voice has caught up and is quiet.
    /// </summary>
    public bool IsFollowing => !_muted && !_readingText && !_answerComplete && _answerId.Length > 0;
    public bool ReadSlowly => _rateFactor < 1;

    /// <summary>
    /// True when the voice plays where Windows Live Captions listens (the default speaker), so its
    /// words also turn up in the captions.
    /// </summary>
    public bool HeardByCaptions
    {
        get
        {
            if (_deviceId.Length == 0)
            {
                return true;
            }
            try
            {
                return string.Equals(_deviceId, MediaDevice.GetDefaultAudioRenderId(AudioDeviceRole.Default), StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception)
            {
                return true;
            }
        }
    }

    public static IReadOnlyList<VoiceChoice> WindowsVoices()
    {
        try
        {
            return SpeechSynthesizer.AllVoices
                .OrderBy(v => v.Language.StartsWith("en", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
                .ThenBy(v => v.DisplayName)
                .Select(v => new VoiceChoice(v.Id, $"{v.DisplayName} ({v.Language})"))
                .ToList();
        }
        catch (Exception ex)
        {
            Log.Write($"Voices: {ex.Message}");
            return [];
        }
    }

    /// <summary>Audio outputs; the first entry ("" id) is whatever Windows uses as the default.</summary>
    public static async Task<IReadOnlyList<VoiceChoice>> OutputDevicesAsync()
    {
        var list = new List<VoiceChoice> { new("", "Default speaker (the one Windows uses)") };
        try
        {
            foreach (var device in await DeviceInformation.FindAllAsync(MediaDevice.GetAudioRenderSelector()))
            {
                list.Add(new VoiceChoice(device.Id, device.Name));
            }
        }
        catch (Exception ex)
        {
            Log.Write($"Audio outputs: {ex.Message}");
        }
        return list;
    }

    /// <summary>
    /// Voice service and voices, speed (1 = normal) and output device. An unknown Windows voice or
    /// device falls back to the default; Google without a key uses the Windows voice.
    /// </summary>
    public async Task ConfigureAsync(VoiceService service, string googleKey, string googleVoice, string windowsVoiceId,
        double rate, string deviceId)
    {
        _service = service;
        _googleKey = googleKey ?? "";
        _googleVoice = string.IsNullOrWhiteSpace(googleVoice) ? GoogleSpeech.DefaultVoice : googleVoice;
        _rate = Math.Clamp(rate, 0.5, 3);
        try
        {
            var voice = SpeechSynthesizer.AllVoices.FirstOrDefault(v => v.Id == windowsVoiceId) ?? SpeechSynthesizer.DefaultVoice;
            if (voice != null)
            {
                _synth.Voice = voice;
            }
            _synth.Options.SpeakingRate = _rate;
        }
        catch (Exception ex)
        {
            Log.Write($"Voice settings: {ex.Message}");
        }

        deviceId ??= "";
        if (deviceId == _deviceId)
        {
            return;
        }
        Stop();
        _player.Dispose();
        _player = CreatePlayer();
        _deviceId = "";
        if (deviceId.Length > 0)
        {
            try
            {
                _player.AudioDevice = await DeviceInformation.CreateFromIdAsync(deviceId);
                _deviceId = deviceId;
            }
            catch (Exception ex)
            {
                Log.Write($"Audio output {deviceId} not available, using the default: {ex.Message}");
            }
        }
    }

    bool UsesGoogle => _service == VoiceService.Google && _googleKey.Length > 0;

    MediaPlayer CreatePlayer()
    {
        var player = new MediaPlayer { AutoPlay = false, AudioCategory = MediaPlayerAudioCategory.Speech };
        player.MediaEnded += (_, _) => _ui.Post(_ => OnPlayed(player), null);
        player.MediaFailed += (_, e) =>
        {
            Log.Write($"Voice playback failed: {e.Error} {e.ErrorMessage}");
            _ui.Post(_ => OnPlayed(player), null);
        };
        return player;
    }

    /// <summary>
    /// Follows the latest answer. New finished sentences are queued as they arrive; when
    /// <paramref name="complete"/> the rest is queued too. A different answer stops the current one
    /// and is read only when <paramref name="readIfNew"/> (the reply to a question just sent).
    /// </summary>
    public void Follow(string answerId, string text, bool complete, bool readIfNew)
    {
        if (answerId != _answerId)
        {
            if (_readingText && !readIfNew)
            {
                // Keep reading the selected text; just note the newer answer (not to be read).
                _answerId = answerId;
                _answerText = text;
                _answerComplete = complete;
                _queuedUpTo = 0;
                return;
            }
            Stop();
            _answerId = answerId;
            _queuedUpTo = 0;
            _queuedTail = "";
            _muted = !readIfNew;
            _rateFactor = 1;
            FinishedReading = false;
        }
        _answerText = text;
        _answerComplete = complete;
        if (_muted)
        {
            return;
        }
        _queuedUpTo = Realign(text);
        int end = complete ? text.Length : SentenceEnd(text, _queuedUpTo, text.Length);
        if (end > _queuedUpTo)
        {
            Enqueue(text[_queuedUpTo..end]);
            _queuedUpTo = end;
            _queuedTail = text[Math.Max(0, end - 40)..end];
        }
    }

    // The last words queued, to find the same place again if earlier text changes length while
    // the answer is still being written (a code part dropped, formatting applied).
    string _queuedTail = "";

    int Realign(string text)
    {
        if (_queuedUpTo == 0 || _queuedTail.Length == 0)
        {
            return Math.Min(_queuedUpTo, text.Length);
        }
        int start = _queuedUpTo - _queuedTail.Length;
        if (start >= 0 && _queuedUpTo <= text.Length && text.AsSpan(start, _queuedTail.Length).SequenceEqual(_queuedTail))
        {
            return _queuedUpTo;
        }
        int at = text.IndexOf(_queuedTail, Math.Max(0, Math.Min(start, text.Length) - 200), StringComparison.Ordinal);
        return at >= 0 ? at + _queuedTail.Length : Math.Min(_queuedUpTo, text.Length);
    }

    /// <summary>Stops talking; the rest of this answer is not read.</summary>
    public void Stop()
    {
        _generation++;
        _cancel.Cancel();
        _cancel = new CancellationTokenSource();
        _clips.Clear();
        _busy = false;
        _muted = true;
        _readingText = false;
        FinishedReading = false;
        try
        {
            _player.Pause();
            _player.Source = null;
        }
        catch (Exception)
        {
        }
        SetSpeaking(false);
    }

    /// <summary>
    /// Reads this answer from the start (as far as it has been written, then follows it as it grows),
    /// at normal speed or <paramref name="slowly"/>. Returns false when there is nothing to read.
    /// </summary>
    public bool Listen(string answerId, string text, bool complete, bool slowly)
    {
        if (text.Trim().Length == 0)
        {
            return false;
        }
        Stop();
        _answerId = answerId;
        _answerText = text;
        _answerComplete = complete;
        _muted = false;
        _queuedUpTo = 0;
        _queuedTail = "";
        _rateFactor = slowly ? 0.7 : 1;
        FinishedReading = false;
        Follow(answerId, text, complete, readIfNew: true);
        return true;
    }

    /// <summary>Speaks a sample sentence (Settings ▸ Voice ▸ Test).</summary>
    public void Say(string text)
    {
        Stop();
        _answerId = "";
        _answerText = "";
        _muted = false;
        Enqueue(text);
    }

    /// <summary>
    /// Reads a piece of text the user selected, at normal speed or <paramref name="slowly"/>. The
    /// answer itself stays unread meanwhile, and only a new reply that is read aloud interrupts it.
    /// Returns false when there is nothing to read.
    /// </summary>
    public bool Speak(string text, bool slowly)
    {
        if (!text.Any(char.IsLetterOrDigit))
        {
            return false;
        }
        Stop(); // also keeps the answer from being read on (muted)
        _rateFactor = slowly ? 0.7 : 1;
        _readingText = true;
        Enqueue(text);
        return true;
    }

    /// <summary>Starts making audio for the text right away (in pieces), and playing if idle.</summary>
    void Enqueue(string text)
    {
        foreach (string piece in Pieces(ForSpeech(text)))
        {
            _clips.Enqueue(MakeClipAsync(piece, _generation, _cancel.Token));
        }
        if (_clips.Count > 0)
        {
            SetSpeaking(true);
            _ = PlayNextAsync();
        }
    }

    async Task<Clip?> MakeClipAsync(string text, int generation, CancellationToken token)
    {
        if (UsesGoogle)
        {
            try
            {
                byte[] audio = await GoogleSpeech.SynthesizeAsync(_googleKey, _googleVoice, _rate * _rateFactor, text, token);
                var stream = new InMemoryRandomAccessStream();
                await stream.WriteAsync(audio.AsBuffer());
                stream.Seek(0);
                return new Clip(stream, "audio/mpeg", _googleVoice, text.Length);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                return null;
            }
            catch (Exception ex)
            {
                string message = ex is GoogleSpeechException ? ex.Message
                    : ex is HttpRequestException or TaskCanceledException ? "Google voice could not be reached (network)."
                    : "Google voice: " + ex.Message;
                Log.Write($"{message} Reading with the Windows voice instead.");
                if (generation == _generation && DateTime.UtcNow - _lastProblem > TimeSpan.FromMinutes(1))
                {
                    _lastProblem = DateTime.UtcNow;
                    Problem?.Invoke(message + " Reading with the Windows voice for now.");
                }
            }
        }
        await _synthGate.WaitAsync();
        try
        {
            if (token.IsCancellationRequested)
            {
                return null;
            }
            _synth.Options.SpeakingRate = Math.Clamp(_rate * _rateFactor, 0.5, 3);
            var spoken = await _synth.SynthesizeTextToStreamAsync(text);
            return new Clip(spoken, spoken.ContentType, _synth.Voice.DisplayName, text.Length);
        }
        catch (Exception ex)
        {
            Log.Write($"Voice: {ex.Message}");
            return null;
        }
        finally
        {
            _synthGate.Release();
        }
    }

    async Task PlayNextAsync()
    {
        if (_busy)
        {
            return;
        }
        _busy = true;
        int generation = _generation;
        while (_clips.Count > 0)
        {
            var clip = await _clips.Dequeue();
            if (generation != _generation)
            {
                clip?.Stream.Dispose();
                return; // stopped meanwhile; whatever runs now owns the player
            }
            if (clip == null)
            {
                continue;
            }
            _player.Source = MediaSource.CreateFromStream(clip.Stream, clip.ContentType);
            _player.Play();
            Log.Write($"Voice: reading {clip.Characters} characters ({clip.Voice}, {_rate * _rateFactor:0.##}x)");
            return; // OnPlayed continues with the next clip
        }
        _busy = false;
        // Read to the end of an answer that is complete: Listen again will read it slower.
        FinishedReading = _readingText || (_answerComplete && _queuedUpTo >= _answerText.Length);
        _readingText = false;
        SetSpeaking(false);
    }

    void OnPlayed(MediaPlayer player)
    {
        if (player != _player || !_busy)
        {
            return;
        }
        _busy = false;
        _ = PlayNextAsync();
    }

    void SetSpeaking(bool value)
    {
        if (_speaking != value)
        {
            _speaking = value;
            SpeakingChanged?.Invoke();
        }
    }

    /// <summary>
    /// Where the finished part of text[from..to] ends: after the last sentence end (. ! ? : ;
    /// followed by a space) or block break. Returns <paramref name="from"/> when nothing is finished.
    /// </summary>
    static int SentenceEnd(string text, int from, int to)
    {
        for (int i = to - 2; i >= from; i--)
        {
            char c = text[i];
            if (c == '\n' || (c is '.' or '!' or '?' or ':' or ';' && char.IsWhiteSpace(text[i + 1])))
            {
                return i + 1;
            }
        }
        return from;
    }

    /// <summary>Splits text into pieces of up to about <see cref="MaxPiece"/> characters at sentence ends.</summary>
    static IEnumerable<string> Pieces(string text)
    {
        int start = 0;
        while (start < text.Length)
        {
            int end = text.Length;
            if (end - start > MaxPiece)
            {
                end = SentenceEnd(text, start, start + MaxPiece);
                if (end == start)
                {
                    int space = text.LastIndexOf(' ', start + MaxPiece, MaxPiece);
                    end = space > start ? space + 1 : start + MaxPiece;
                }
            }
            string piece = text[start..end].Trim();
            if (piece.Any(char.IsLetterOrDigit))
            {
                yield return piece;
            }
            start = end;
        }
    }

    /// <summary>Drops what should not be read out (bullets, symbols, emoji) and lone "-" replies.</summary>
    static string ForSpeech(string text)
    {
        string cleaned = SymbolPattern().Replace(text, " ");
        cleaned = SpacePattern().Replace(cleaned, " ").Trim();
        return cleaned.Any(char.IsLetterOrDigit) ? cleaned : "";
    }

    [GeneratedRegex(@"[•▪◦*#`|_~>→←↑↓✓✔✅❌⚠️\p{So}\p{Cs}]")]
    private static partial Regex SymbolPattern();

    [GeneratedRegex(@"[^\S\n]+")]
    private static partial Regex SpacePattern();

    public void Dispose()
    {
        Stop();
        _player.Dispose();
        _synth.Dispose();
    }
}
