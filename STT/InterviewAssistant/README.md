# Interview Assistant

A small Windows app with two views:

- **Full view** for preparing: the real ChatGPT / DeepSeek page (to sign in and start a chat with your
  call prompt), the live captions, and the next message to send.
- **Interview view** for the interview itself: a small window with a caption strip and an **answer
  reader** that shows the AI's latest answer in large, clean text as it streams in.

```
Live Captions ──UI Automation──> caption strip ──(Send hotkey)──> ChatGPT / DeepSeek page (WebView2)
                                                                        │
                                          answer reader <──(reads the latest answer)──┘
```

## Requirements

- Windows 11 with Live Captions (`Win + Ctrl + L`)
- .NET 9 Desktop Runtime (already present if the .NET 9 SDK is installed)
- Microsoft Edge WebView2 Runtime (preinstalled on Windows 11)

## Build and run

```powershell
cd STT\InterviewAssistant
dotnet run -c Release
# or a single exe in .\publish:
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o publish
.\publish\InterviewAssistant.exe
```

## Before the interview (full view)

The toolbar has only four things: **ChatGPT / DeepSeek**, **＋ New chat + call prompt**, **Settings** (gear)
and **Interview view**.

1. **Live Captions settings** (gear icon in its window):
   - Turn **off** "Include microphone audio", so only the interviewer (computer audio) is captioned, not you.
   - Close any other audio (videos, music). Everything the computer plays is captioned and can be sent.
2. Pick **ChatGPT** or **DeepSeek** and sign in on the chat page once. The login is kept in
   `%LOCALAPPDATA%\InterviewAssistant\WebView2`.
3. Open **Settings** (four pages in the left rail, all settings in one place):
   - **Interview**: your profile, the company, the job description and, optionally, your resume
     (paste it, click **Load resume (PDF / Word)…**, or drop a `.pdf`, `.docx`, `.txt` or `.md` file on
     the box). The call prompt below them works as it is; edit it only if you want different answers.
     **Load from JobStrike…** fills them from one of your JobStrike applications (see below).
   - **Sending**: what the Send key does (see below).
   - **Display**: see-through overlay or normal window for the interview view (and, for the normal
     window, where the captions go), Dark / Light / Match Windows theme, always on top, hiding the
     Windows Live Captions window.
   - **Hotkeys**: click a box and press the combination; Backspace removes one.
4. Click **New chat + call prompt**. A fresh chat opens and your details are sent.
5. Click **Interview view ›**.

### Load from JobStrike (Settings → Interview)

Picks the role from your JobStrike applications (https://job-strike.vercel.app) instead of pasting it:

- **Sign in** once with your JobStrike username and password. The password is not saved; JobStrike
  issues an access key (the same kind the browser extension uses), stored in `settings.json`
  encrypted for your Windows account. **Sign out** removes it (also from the backup copy).
- **Interview stages** (every board stage after Screening except Reject: HR, Technical, Final and any
  you add), **Screening** or **All**, newest first (up to 100 per stage), with search.
- **Load** (or double-click) fills **Client company**, **Job description** (with the job title and
  link on top) and **My resume**: the resume file you applied with is downloaded and read like a
  loaded resume. **Also fill "My profile"** adds the profile's name, education, LinkedIn and location.
  JobStrike's profile list also contains the private fields it keeps for application forms (SSN, date
  of birth, phone, address); the app receives them with the list but never uses, shows or stores them.
  A box is only replaced when JobStrike has something for it; if the resume cannot be fetched (e.g.
  JobStrike's Google Drive sign-in expired) the rest still loads and a note says why. Check the boxes,
  then **Save**.

The app only reads from JobStrike; it changes nothing there.

## During the interview (interview view)

- **Captions**: the Live Captions text exactly as shown, for the whole interview. Grey text was
  already sent; text in the accent colour (violet) is waiting. It follows the newest line unless you
  scroll up; **↓ Latest** jumps back.
- **Answer**: the latest AI answer in large text (about 70 characters per line), with headings,
  bullets, **bold key terms** and code kept, updated live. The header always says what is happening: **● Thinking… 5s** from the
  moment a message is submitted until the first words arrive (the previous answer is faded so it is
  not mistaken for the new one), **● Writing…** while the text streams in, **✓ Complete** when it
  has stopped changing. A thin moving bar runs while thinking or writing. If nothing arrives within
  2 minutes it says so. **A− / A+** sizes the text.
- **Status line**: Live Captions state and how many words are waiting, with the Send hotkey shown as
  a key (hover it for the send mode). It turns red when Live Captions is not running or a send fails.
- **Answer | Chat page** in the status line switches between the clean answer and the ChatGPT /
  DeepSeek page itself (normal-window interview view). The see-through overlay always shows the
  answer, because a see-through window cannot display the embedded browser; use **Full view** there.
- **⋯ Menu** (or right-click; ⤢ next to it opens Full view) has only what you need during the interview: Send, Discard, Submit,
  Clear chat box, more / less see-through, text sizes, New chat + call prompt, Settings, Full view.

### What the Send key does (Settings → Sending)

| Choice | What happens |
|---|---|
| **Put it in the chat box, then you press Enter** (recommended) | The question is typed into the chat. Check or fix it, then press **Submit** (or Enter in the chat). Several Sends in a row collect in the box. |
| **Send it to the AI right away** | One key press: the question is submitted immediately. |
| **Automatic** | No key press: the question is sent as soon as the interviewer pauses (pause length and minimum words are set right there). The Automatic hotkey turns this on and off. |

**Discard** drops the waiting text (small talk, your own words). **Clear chat box** (in full view:
**Chat box ▸ Clear**) empties the chat's message box, including a message still waiting there. If the AI is still answering, the next
message waits and is submitted when the answer finishes. The call prompt is always submitted
straight away.

### Hotkeys

Hotkeys work system-wide, also while the meeting app has focus. If another program already owns a
combination, the status bar says which; hover "all hotkeys…" in the status bar to see the list.
The app catches its combinations before keyboard tools that hook the keyboard themselves (hotkey
managers, key remappers), and `log.txt` notes every hotkey press with the app that was in front.

| Default | Action |
|---|---|
| `Ctrl+Alt+S` | Send |
| `Ctrl+Alt+D` | Discard |
| `Ctrl+Alt+Enter` | Submit the chat box |
| `Ctrl+Alt+X` | Clear the chat box |
| `Ctrl+Alt+PageDown` / `Ctrl+Alt+PageUp` | Scroll the answer |
| `Ctrl+Alt+A` | Automatic on / off |
| `Ctrl+Alt+C` | Interview view / full view |
| `Ctrl+Alt+=` / `Ctrl+Alt+-` | Overlay more solid / more see-through (10% per press; the numeric keypad + / − and Shift+= work too) |

### See-through overlay (Settings → Display)

The interview view becomes a borderless window floating above every other window, so you can place
it over the meeting and still see the video behind it.

- **See-through slider** in its top bar: 0% is solid; drag right to see more of what is behind. Only
  the background becomes see-through; the text stays solid, with a soft halo so it stays readable over
  video. `Ctrl+Alt+=` / `Ctrl+Alt+-` change it without clicking (also from the meeting app).
- Move it by dragging the top bar; resize it from any edge or corner; drag the line between captions
  and answer to change the split. Everything is remembered.
- The main window is minimized meanwhile (the chat page keeps working). **Full view**, the Interview
  view hotkey, or clicking the app in the taskbar brings it back.

With **Normal window** instead, interview view is a small regular window; the captions go above,
below, left or right of the answer, or in their own window you can move anywhere. Drag the bar
between them to resize. In full view the captions are always on the left.

### Theme (Settings → Display)

Dark (the default) is low-glare for dim rooms and long sessions; Light is quicker to read in a bright
room; Match Windows follows Settings → Personalization → Colors. Title bars and the chat page switch
with the app. Both use the same friendly look: the rounded Nunito typeface (bundled in `Assets/Fonts`,
SIL Open Font License), a violet accent, pill buttons and rounded cards.

## How captions are read

Live Captions keeps its whole caption buffer (about 3,400 characters) in one UI Automation element,
`CaptionsTextBlock`. The app reads that element every 120 ms. Each snapshot is aligned against the
previous one ([CaptionTracker.cs](CaptionTracker.cs)):

- the end of the buffer is revised while someone speaks, so only the part after the alignment point is
  replaced, exactly as Live Captions shows it;
- old paragraphs are trimmed from the front of the buffer, and the app keeps them, so the transcript
  covers the whole interview;
- the "already sent" position follows revisions (e.g. `hardest SC` → `hardest scaling?`), so words are
  neither lost nor sent twice.

Pauses of a few seconds do **not** create a new line in Live Captions, so the end of a question is
detected by the text not changing, not by line breaks.

## How the answer reader works

The chat page keeps running in interview view, because messages are typed into it and answers come
from it. WebView2 is a native window that always draws above WPF content, so it cannot simply be
covered; instead it keeps a normal page size (900×1000) and is placed far outside the window, where
Windows clips it away. It must not be shrunk or hidden: a hidden page stops rendering the streamed
answer, and DeepSeek only builds the messages inside its visible scroll range (a virtual list), so a
tiny page would leave the newest answer out. For DeepSeek the reader also keeps that list scrolled
to the newest message.

Every 350 ms the reader runs a script on the page ([AnswerReader.cs](AnswerReader.cs)) that finds the
latest assistant message (`li[data-message-role="assistant"]` on ChatGPT, `.ds-markdown` on DeepSeek,
any `markdown` element otherwise; ChatGPT message ids and DeepSeek list item keys tell answers apart) and turns it into blocks: headings, paragraphs, list items, code.
Bold, italic and code are read from the computed style, because ChatGPT styles spans with classes
rather than `<strong>`. Only blocks that changed are redrawn, so the text does not jump while it
streams.

## Files

| File | Purpose |
|---|---|
| `LiveCaptionsReader.cs` | Finds the Live Captions window and polls `CaptionsTextBlock` |
| `CaptionTracker.cs` | Transcript, alignment, sent / pending tracking |
| `ChatBridge.cs` | Types into ChatGPT / DeepSeek with trusted DevTools input, submits, reads the answer |
| `AnswerReader.cs` | Answer extraction script, answer model, FlowDocument rendering |
| `MainWindow.xaml(.cs)` | Full / interview view, caption docking, answer reader, menus, hotkey actions |
| `OverlayWindow.xaml(.cs)` | Borderless see-through interview view above other windows |
| `Assets/AppIcon.ico`, `AppIcon.png` | App logo (caption bubble with an AI spark); redraw with `python Assets/make_logo.py Assets` |
| `ThemeManager.cs` | Dark / light palettes, applied live through `DynamicResource` |
| `SetupWindow.xaml(.cs)` | Settings window: Interview, Sending, Display, Hotkeys tabs |
| `AppSettings.cs` | Settings in `%LOCALAPPDATA%\InterviewAssistant\settings.json` and the default call prompt |
| `Hotkey.cs` | Parsing and validating hotkey text such as `Ctrl+Alt+S` |
| `ResumeReader.cs` | Text from `.pdf` (PdfPig), `.docx` (read directly from the file's XML), `.txt`, `.md` |
| `NativeMethods.cs` | Global hotkey registration, moving the Live Captions window |
| `JobStrikeClient.cs` | JobStrike sign-in (encrypted access key), application list, job description, resume download |
| `JobStrikeWindow.xaml(.cs)` | "Load from JobStrike" window: sign in, pick an application |

Set `INTERVIEW_ASSISTANT_DATA` to a folder to run a second copy with its own settings, log and browser
profile (two copies cannot share one browser profile).

## Troubleshooting

`%LOCALAPPDATA%\InterviewAssistant\log.txt` records each send and any error. Settings are saved to
`settings.json` with the previous version kept as `settings.json.bak`; if the file is ever damaged,
the app loads the backup instead.

| Problem | What to try |
|---|---|
| "Live Captions is not running" / "Not running" | Click **Start** (or Menu ▸ **Start Live Captions**), or press `Win + Ctrl + L`. Start uses that same Windows shortcut, which also revives a Live Captions process that is still running in the background without its window. |
| "message box not found" | Make sure you are signed in and the chat page has finished loading. If the site changed its layout, update the selectors in `ChatBridge.ComposerScript` |
| The answer reader stays empty | Switch to **Full view** to check an answer exists on the chat page. If the site changed its layout, update the selectors at the top of `AnswerSnapshot.Script` |
| Questions are split in two (Automatic) | Increase the pause in Settings → Sending (2–2.5 s), or use one of the manual choices |
| Google sign-in refuses the embedded browser | Sign in with email/password (or Microsoft/Apple) instead |
| A hotkey does nothing | Another app owns it (the status bar lists them) or swallows it; pick a different combination in Settings → Hotkeys |
| "Could not start the … view" | Another copy of the app is running with the same browser profile; close it |
