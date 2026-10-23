using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace InterviewAssistant;

public enum ChatProvider
{
    ChatGpt,
    DeepSeek,
}

/// <summary>
/// Types messages into the ChatGPT / DeepSeek composer and submits them. Text and the Enter key
/// are sent through the DevTools Input domain, so the page receives trusted input exactly as if
/// it had been typed, which works with ProseMirror (ChatGPT) and React textareas (DeepSeek).
/// </summary>
public sealed class ChatBridge
{
    static readonly TimeSpan InputWait = TimeSpan.FromSeconds(20);
    static readonly TimeSpan SubmitWait = TimeSpan.FromSeconds(90);
    static readonly TimeSpan SubmitHardLimit = TimeSpan.FromMinutes(10);
    static readonly TimeSpan StepTimeout = TimeSpan.FromSeconds(8);

    readonly CoreWebView2 _core;
    readonly SemaphoreSlim _gate = new(1, 1);
    CancellationTokenSource? _inFlight;
    int _generation;
    bool _textDelivered;

    public ChatProvider Provider { get; }

    public ChatBridge(CoreWebView2 core, ChatProvider provider)
    {
        _core = core;
        Provider = provider;
    }

    public static Uri HomeUrl(ChatProvider provider) => provider switch
    {
        ChatProvider.DeepSeek => new Uri("https://chat.deepseek.com/"),
        _ => new Uri("https://chatgpt.com/"),
    };

    public static string DisplayName(ChatProvider provider) =>
        provider == ChatProvider.DeepSeek ? "DeepSeek" : "ChatGPT";

    /// <summary>
    /// Appends <paramref name="text"/> to the composer and, when <paramref name="submit"/> is set,
    /// submits it. If the assistant is still answering the previous message, the text waits in the
    /// composer and is submitted as soon as the page accepts it. With <paramref name="replace"/>,
    /// whatever is already in the composer (e.g. a draft the page restored) is removed first.
    /// </summary>
    public Task<SendResult> SendAsync(string text, bool submit = true, bool replace = false)
    {
        Log.Write($"[{Provider}] {(submit ? "send" : "fill")} {text.Length} chars");
        int generation = _generation;
        return RunExclusiveAsync(generation, token => SendCoreAsync(text, submit, replace, token));
    }

    /// <summary>Submits whatever is in the composer, waiting for a running answer to finish first.</summary>
    public Task<SendResult> SubmitAsync()
    {
        int generation = _generation;
        return RunExclusiveAsync(generation, async token =>
        {
            string? existing = await FocusComposerAsync();
            if (existing == null)
            {
                return ComposerNotFound();
            }
            _textDelivered = true;
            return existing.Length == 0
                ? SendResult.Fail("The chat box is empty; nothing to submit.", delivered: true)
                : await SubmitCoreAsync(token);
        });
    }

    /// <summary>
    /// Drops the message being typed or waiting to be submitted, and every message still queued
    /// behind it (used by Clear chat box and New chat).
    /// </summary>
    public void CancelPending()
    {
        _generation++;
        _inFlight?.Cancel();
    }

    /// <summary>
    /// Runs one send at a time. A send queued before <see cref="CancelPending"/> is dropped when its
    /// turn comes. Any failure says whether text already reached the chat box, so the caller never
    /// offers the same words again after they were typed.
    /// </summary>
    async Task<SendResult> RunExclusiveAsync(int generation, Func<CancellationToken, Task<SendResult>> action)
    {
        await _gate.WaitAsync();
        using var cts = new CancellationTokenSource();
        _inFlight = cts;
        _textDelivered = false;
        try
        {
            if (generation != _generation)
            {
                Log.Write($"[{Provider}] dropped (cancelled while queued)");
                return SendResult.Cancelled;
            }
            return await action(cts.Token);
        }
        catch (OperationCanceledException)
        {
            Log.Write($"[{Provider}] cancelled");
            return SendResult.Cancelled;
        }
        catch (TimeoutException)
        {
            Log.Write($"[{Provider}] page stopped responding");
            return SendResult.Fail($"{DisplayName(Provider)} page is not responding. Try New chat.", _textDelivered);
        }
        catch (Exception ex)
        {
            // WebView2 can throw COM errors when its browser process restarts.
            Log.Write($"[{Provider}] send failed: {ex}");
            return SendResult.Fail($"{DisplayName(Provider)} page is not available ({ex.Message}). Try New chat.", _textDelivered);
        }
        finally
        {
            _inFlight = null;
            _gate.Release();
        }
    }

    /// <summary>
    /// Empties the composer. A message that is still waiting there for the previous answer to
    /// finish, or queued behind it, is dropped too instead of being submitted later.
    /// </summary>
    public async Task<bool> ClearComposerAsync()
    {
        CancelPending();
        await _gate.WaitAsync(); // lets a cancelled send stop before the box is cleared
        try
        {
            if (await FocusComposerAsync() == null)
            {
                return false;
            }
            await PressKeyAsync("a", "KeyA", 65, modifiers: 2, commands: ["selectAll"]);
            await PressKeyAsync("Backspace", "Backspace", 8);
            Log.Write($"[{Provider}] composer cleared");
            return await ReadComposerAsync() is "";
        }
        catch (Exception ex)
        {
            Log.Write($"[{Provider}] clear failed: {ex.Message}");
            return false;
        }
        finally
        {
            _gate.Release();
        }
    }

    async Task<SendResult> SendCoreAsync(string text, bool submit, bool replace, CancellationToken token)
    {
        string? existing = await WaitForComposerAsync(token);
        if (existing == null)
        {
            return ComposerNotFound();
        }

        token.ThrowIfCancellationRequested();
        if (existing.Length > 0 && replace)
        {
            await PressKeyAsync("a", "KeyA", 65, modifiers: 2, commands: ["selectAll"]);
            await PressKeyAsync("Backspace", "Backspace", 8);
            Log.Write($"[{Provider}] removed {existing.Length} chars already in the composer");
            existing = await FocusComposerAsync() ?? "";
        }
        _textDelivered = true; // from here on some of the text may be in the box
        if (existing.Length > 0)
        {
            await PressEnterAsync(shift: true, token);
        }
        await InsertTextAsync(text, token);
        if (!await ComposerContainsAsync(text))
        {
            // Typed somewhere else (e.g. the page re-rendered its composer): nothing usable arrived.
            Log.Write($"[{Provider}] text did not arrive in the composer");
            return SendResult.Fail("The text did not reach the chat box. Try again, or New chat if it keeps happening.");
        }
        if (!submit)
        {
            Log.Write($"[{Provider}] left in the chat box");
            return SendResult.Ok;
        }
        return await SubmitCoreAsync(token);
    }

    SendResult ComposerNotFound()
    {
        Log.Write($"[{Provider}] composer not found at {_core.Source}");
        return SendResult.Fail($"{DisplayName(Provider)} message box not found. Is the page loaded and signed in?");
    }

    async Task<SendResult> SubmitCoreAsync(CancellationToken token)
    {
        // The wait only counts while the page is idle and not taking the message; a long previous
        // answer still streaming extends it (up to a hard limit).
        var deadline = DateTime.UtcNow + SubmitWait;
        var hardLimit = DateTime.UtcNow + SubmitHardLimit;
        string? answerBefore = null;
        while (DateTime.UtcNow < deadline && DateTime.UtcNow < hardLimit)
        {
            token.ThrowIfCancellationRequested();
            string? current = await FocusComposerAsync();
            if (current == null)
            {
                await Task.Delay(500, token);
                continue;
            }
            if (current.Length == 0)
            {
                Log.Write($"[{Provider}] submitted");
                return SendResult.Ok with { AnswerIdBefore = answerBefore };
            }
            if (await IsGeneratingAsync())
            {
                // The previous answer is still streaming; Enter would be ignored until it ends.
                deadline = DateTime.UtcNow + SubmitWait;
                await Task.Delay(700, token);
                continue;
            }
            // Taken before the first Enter, while the page is idle: the latest answer now is the old
            // one, so the reader can tell the reply apart however quickly it appears.
            answerBefore ??= (await ReadAnswerAsync())?.MessageId;
            await PressEnterAsync(shift: false, token);
            await Task.Delay(700, token);
            // Enter was only pressed while idle, so an answer streaming now is the reply to it.
            if (await ReadComposerAsync() is "" || await IsGeneratingAsync())
            {
                Log.Write($"[{Provider}] submitted");
                return SendResult.Ok with { AnswerIdBefore = answerBefore };
            }
        }
        Log.Write($"[{Provider}] not submitted within {SubmitWait.TotalSeconds}s");
        return SendResult.Fail("The message is in the chat box but was not submitted yet. Press Submit when the answer has finished.",
            delivered: true);
    }

    async Task<string?> WaitForComposerAsync(CancellationToken token)
    {
        var deadline = DateTime.UtcNow + InputWait;
        while (true)
        {
            string? text = await FocusComposerAsync();
            if (text != null || DateTime.UtcNow >= deadline)
            {
                return text;
            }
            await Task.Delay(400, token);
        }
    }

    async Task InsertTextAsync(string text, CancellationToken token)
    {
        string[] lines = text.Replace("\r\n", "\n").Split('\n');
        for (int i = 0; i < lines.Length; i++)
        {
            token.ThrowIfCancellationRequested();
            if (i > 0)
            {
                await PressEnterAsync(shift: true, token);
            }
            if (lines[i].Length > 0)
            {
                await FocusComposerAsync();
                await Cdp("Input.insertText", new { text = lines[i] });
            }
        }
    }

    /// <summary>True when the end of <paramref name="text"/> is now in the composer (whitespace-insensitive).</summary>
    async Task<bool> ComposerContainsAsync(string text)
    {
        static string Flat(string value) => string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        string? current = await ReadComposerAsync();
        if (current == null)
        {
            return false;
        }
        string expected = Flat(text);
        string tail = expected.Length <= 40 ? expected : expected[^40..];
        return Flat(current).Contains(tail, StringComparison.Ordinal);
    }

    async Task PressEnterAsync(bool shift, CancellationToken token)
    {
        await FocusComposerAsync();
        token.ThrowIfCancellationRequested(); // never submit after Clear / New chat
        int modifiers = shift ? 8 : 0;
        await Cdp("Input.dispatchKeyEvent", new
        {
            type = "keyDown",
            key = "Enter",
            code = "Enter",
            windowsVirtualKeyCode = 13,
            nativeVirtualKeyCode = 13,
            text = "\r",
            unmodifiedText = "\r",
            modifiers,
        });
        await Cdp("Input.dispatchKeyEvent", new
        {
            type = "keyUp",
            key = "Enter",
            code = "Enter",
            windowsVirtualKeyCode = 13,
            nativeVirtualKeyCode = 13,
            modifiers,
        });
    }

    async Task PressKeyAsync(string key, string code, int virtualKey, int modifiers = 0, string[]? commands = null)
    {
        await Cdp("Input.dispatchKeyEvent", new
        {
            type = "rawKeyDown",
            key,
            code,
            windowsVirtualKeyCode = virtualKey,
            nativeVirtualKeyCode = virtualKey,
            modifiers,
            commands = commands ?? [],
        });
        await Cdp("Input.dispatchKeyEvent", new
        {
            type = "keyUp",
            key,
            code,
            windowsVirtualKeyCode = virtualKey,
            nativeVirtualKeyCode = virtualKey,
            modifiers,
        });
    }

    Task<string> Cdp(string method, object parameters) =>
        _core.CallDevToolsProtocolMethodAsync(method, JsonSerializer.Serialize(parameters)).WaitAsync(StepTimeout);

    /// <summary>Focuses the composer with the caret at the end. Returns its text, or null if absent.</summary>
    Task<string?> FocusComposerAsync() => EvalString(ComposerScript(focus: true));

    Task<string?> ReadComposerAsync() => EvalString(ComposerScript(focus: false));

    /// <summary>
    /// JS expression that is true while the AI is writing: the page's own stop button. Matched
    /// narrowly so "Stop dictation" / "Stop sharing" style buttons do not count.
    /// </summary>
    public const string GeneratingScript =
        """
        [...document.querySelectorAll('button, div[role="button"]')].some(b =>
          b.dataset.testid === 'stop-button' ||
          /^stop( generating| streaming| responding| response)?$/i.test((b.getAttribute('aria-label') || '').trim()))
        """;

    async Task<bool> IsGeneratingAsync() => await Eval($"(() => {GeneratingScript})()") == "true";

    /// <summary>The latest answer on the page, or null when the page cannot be read right now.</summary>
    public async Task<AnswerSnapshot?> ReadAnswerAsync()
    {
        try
        {
            string? json = await EvalString(AnswerSnapshot.Script(Provider));
            return json == null ? null : AnswerSnapshot.Parse(json);
        }
        catch (Exception ex)
        {
            // Never let a page hiccup (or a browser process restart) take the app down.
            Log.Write($"[{Provider}] reading the answer failed: {ex.GetType().Name}: {ex.Message}");
            return null;
        }
    }

    async Task<string?> EvalString(string script) => JsonSerializer.Deserialize<string?>(await Eval(script));

    Task<string> Eval(string script) => _core.ExecuteScriptAsync(script).WaitAsync(StepTimeout);

    string ComposerScript(bool focus)
    {
        // ChatGPT serves either a ProseMirror editor or a plain textarea depending on account and
        // layout, so both are listed; the most specific selectors come first.
        string selectors = JsonSerializer.Serialize(Provider == ChatProvider.DeepSeek
            ? new[]
            {
                "textarea#chat-input",
                "textarea[placeholder*='DeepSeek' i]",
                "textarea[placeholder*='Message' i]",
                "div[contenteditable='true'][role='textbox']",
                "textarea[placeholder]",
                "textarea",
            }
            : new[]
            {
                "#prompt-textarea[contenteditable='true']",
                "div.ProseMirror[contenteditable='true']",
                "textarea#prompt-textarea",
                "textarea#mobile-composer-prompt",
                "textarea[placeholder*='ChatGPT' i]",
                "textarea[placeholder*='Ask' i]",
                "textarea[placeholder*='Message' i]",
                "div[contenteditable='true'][role='textbox']",
                "textarea[placeholder]",
            });

        // The composer sits at the bottom of the page, so the last visible match wins over
        // e.g. a textarea opened to edit an earlier message. A freshly opened ChatGPT chat first
        // shows a placeholder box (#pending-home-input) that is replaced by the real editor about a
        // second later, taking anything typed into it along; the placeholder never counts.
        return $$"""
            (() => {
              const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !/^pending/.test(el.id); };
              let el = null;
              for (const s of {{selectors}}) {
                el = [...document.querySelectorAll(s)].filter(visible).pop();
                if (el) break;
              }
              if (!el) return null;
              if ({{(focus ? "true" : "false")}}) {
                el.focus();
                if (el.tagName === 'TEXTAREA') {
                  el.selectionStart = el.selectionEnd = el.value.length;
                } else {
                  const range = document.createRange();
                  range.selectNodeContents(el);
                  range.collapse(false);
                  const sel = window.getSelection();
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              }
              const text = el.tagName === 'TEXTAREA' ? el.value : el.innerText;
              return (text || '').replace(/ /g, ' ').trim();
            })()
            """;
    }
}

/// <summary>
/// Outcome of a send. Delivered means (some of) the text reached the chat box, so it must not be
/// offered for sending again.
/// </summary>
/// <param name="AnswerIdBefore">
/// Id of the latest answer on the page just before Enter was pressed ("" when there was none, null
/// when unknown): any other answer is the reply to this message.
/// </param>
public readonly record struct SendResult(bool Success, string? Error, bool WasCancelled = false, bool Delivered = false,
    string? AnswerIdBefore = null)
{
    public static SendResult Ok => new(true, null, Delivered: true);
    public static SendResult Cancelled => new(false, null, WasCancelled: true);
    public static SendResult Fail(string error, bool delivered = false) => new(false, error, Delivered: delivered);
}
