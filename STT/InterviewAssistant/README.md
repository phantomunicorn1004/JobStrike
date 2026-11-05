# Interview Assistant

A small Windows app with two views:

- **Full view** for preparing: the real ChatGPT / DeepSeek page (to sign in and start a chat with your
  call prompt), the live captions, and the next message to send.
- **Interview view** for the interview itself: a small window laid out like a teleprompter. The
  **answer reader** is on top, near the camera, showing the AI's latest answer in large, clean text as
  it streams in (its opening sentence, the line to say first, a size larger and brightest). The caption
  strip and the message box sit in a slim area below.

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

The toolbar has: **ChatGPT / DeepSeek**, **＋ New chat + call prompt**, **🔊 Listen** (the text selected
on the chat page, or else the latest answer), **Settings** (gear) and **Interview view**.

1. **Live Captions settings** (gear icon in its window):
   - Turn **off** "Include microphone audio", so only the interviewer (computer audio) is captioned, not you.
   - Close any other audio (videos, music). Everything the computer plays is captioned and can be sent.
2. Pick **ChatGPT** or **DeepSeek** and sign in on the chat page once. The login is kept in
   `%LOCALAPPDATA%\InterviewAssistant\WebView2`.
3. Open **Settings** (five pages in the left rail, all settings in one place):
   - **Interview**: your profile, the company, the job description and, optionally, your resume
     (paste it, click **Load resume (PDF / Word)…**, or drop a `.pdf`, `.docx`, `.txt` or `.md` file on
     the box). The call prompt below them works as it is; edit it only if you want different answers.
     **Load from JobStrike…** fills them from one of your JobStrike applications (see below).
   - **Sending**: what the Send key does (see below).
   - **Display**: see-through overlay or normal window for the interview view (and, for the normal
     window, where the captions go), Dark / Light / Match Windows theme, always on top, hiding the
     Windows Live Captions window.
   - **Voice**: read the answers aloud (see below).
   - **Hotkeys**: click a box and press the combination; Backspace removes one.
4. Click **New chat + call prompt**. A fresh chat opens, your details are sent, and the caption panel
   starts empty (a new chat is a new interview; the trash button next to A− / A+ clears it any time).
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

- **Captions**: the Live Captions text exactly as shown. In full view each pause in speech is a card
  with the time it started; the card with words still waiting to be sent is highlighted and tagged
  **Waiting to send**, and the waiting words are in the accent colour (violet). Interview view shows the
  same text as plain lines (grey = sent). The panel keeps the latest 300 paragraphs and follows the
  newest line unless you scroll up; **↓ Latest** jumps back.
- **Answer** (on top): the latest AI answer in large text (about 70 characters per line), with headings,
  bullets, **bold key terms** and code kept, updated live; the opening sentence is a size larger. Its
  one-line header shows what is happening, then the question the answer is for: **Listening** (grey),
  **● Thinking… 5s** (amber) from the moment a message is submitted until the first words arrive (the
  previous answer is faded so it is not mistaken for the new one), **● Writing…** (blue) while the
  text streams in, **● Reading aloud…**, **✓ Ready** (green) when it has stopped changing. A thin moving
  bar runs while thinking or writing. If nothing arrives within 2 minutes it says so. **A− / A+**
  sizes the text.
- **Message box** (under the captions, and in full view under **Next message**): it shows the
  interviewer's words waiting to be sent. Click into it and type to edit them, or clear it and write
  your own question; from then on new captions do not overwrite your text (they wait for the next
  message, and Automatic mode waits too). **Enter** sends (Shift+Enter starts a new line), **Esc**
  goes back to the interviewer's words, **Discard** throws your text away. **Send** and the Send hotkey
  send whatever is in the box; the caption words that were in it count as sent with it. In interview
  view the **⌄** button next to it hides the box (the captions get the space, and Send still sends the
  interviewer's words); the keyboard button in the status line, or the menu, shows it again.
- **Status line**: Live Captions state and how many words are waiting, with the Send hotkey shown as
  a key (hover it for the send mode). It turns red when Live Captions is not running or a send fails.
- **Answer | Chat page** in the status line switches between the clean answer and the ChatGPT /
  DeepSeek page itself (normal-window interview view). The see-through overlay always shows the
  answer, because a see-through window cannot display the embedded browser; use **Full view** there.
- **🔊 Listen** in the answer header reads the answer out, like Google Translate's Listen button (see below).
- **Copy** in the answer header copies the text you selected in the answer, or else the whole answer as
  plain text (headings, paragraphs, bullets and numbers kept); it shows **✓ Copied** for a moment. The
  pop-up that appears when you select text has Copy too, and so does the ⋯ menu.
- **⋯ Menu** (or right-click; ⤢ next to it opens Full view) has only what you need during the interview: Send, Discard, Submit,
  Clear chat box, more / less see-through, listen / stop, automatic reading, clear captions, text
  sizes, New chat + call prompt, Settings, Full view.

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

**Everyday shortcuts as hotkeys.** A hotkey that other programs also use (Ctrl+X, Ctrl+Space, Ctrl+=,
Ctrl+- …) works as a hotkey only while Interview Assistant, Live Captions or one of the apps listed in
Settings ▸ Hotkeys is in front (Zoom, Teams, Webex, Meet, Slack, Discord, Skype, Whereby, Jitsi, GoTo,
AnyDesk by default). Each word is matched as a whole word against the app's name and its window title,
so a Chrome tab showing Google Meet counts and "Meeting notes" does not. Everywhere else the key keeps
its normal job (Ctrl+X cuts). **Use them everywhere instead** restores the old behaviour, where those
keys do the app's action in every program.

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
| `Ctrl+Alt+R` | Listen / stop (the Listen button) |
| `Ctrl+Alt+V` | Automatic reading of new answers on / off |

### Read aloud (Settings → Voice)

**Listen** works like the speaker button on Google Translate: nothing is read until you press it.

- **Listen** (or `Ctrl+Alt+R`) reads the latest answer. If it is still being written, reading starts
  with the first finished sentence and follows the text as it grows. Code blocks are left out.
- Press it again while it speaks (the button then says **■ Stop**) to stop.
- Press it again after it has read the answer to the end to hear it **slower**; the time after that is
  normal speed again.
- **Selected text**: select words in the answer and a small **🔊 Listen** button appears next to the
  mouse; it (and the Listen button, `Ctrl+Alt+R` and the menu) then reads just the selection. In full
  view select text on the ChatGPT / DeepSeek page and press **Listen** in the toolbar or `Ctrl+Alt+R`.
  The selection stays highlighted when another app is in front, so the hotkey works from the meeting
  app too. Pressing it again after the selection was read reads it slower, as for the whole answer.
- Sending the next question stops it.
- **Also read new answers automatically** (Settings ▸ Voice, or `Ctrl+Alt+V`) reads every new reply
  without pressing Listen; answers already on the page when you switch it on are not read.

- **Voice service**: **Google** uses Google Cloud Text-to-Speech, the natural voices behind Google
  Translate's Listen button, with your own API key; **Windows** uses the voices that come with Windows
  (offline and instant, but robotic). Each piece is turned into audio as soon as it is written, so the
  next sentence is ready when the current one ends. If Google cannot be reached or rejects the key,
  that part is read by the Windows voice and the status bar says why, so an answer is never left unread.
- **Google API key** (one-time setup): in Google Cloud create a project, enable the **Cloud
  Text-to-Speech API** (Google asks for a billing account; about 1 million characters a month are free,
  many interviews' worth), then APIs & Services ▸ Credentials ▸ Create credentials ▸ API key, restricted
  to that API. Paste it on the Voice page and press **Check key**, which also loads the English voices
  (Chirp 3 HD sounds most natural, Neural2 and WaveNet are close; the default is `en-US-Neural2-F`). The
  key is stored encrypted for your Windows account, like the JobStrike key.
- **Speed** and **Play on** (the output device) are set on the same page; **Test** plays a sample.
- Use headphones so the interviewer does not hear the voice.
- Live Captions captions everything on the default speaker, the voice included. With **Ignore captions
  while the voice speaks** (on by default), caption text that arrives while it speaks (and for two
  seconds after, as Live Captions lags) is dropped instead of being sent as the interviewer's words,
  and Automatic mode waits. If the interviewer starts talking, press **Send**: it stops the voice, and
  the next Send takes what they say from then on. Playing the voice on another output device (e.g. a
  second headset) keeps it out of the captions altogether; then nothing is dropped.

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

With **Normal window** instead, interview view is a small regular window; the captions go below the
answer (the default, so the answer is nearest the camera), above it, left or right of it, or in their
own window you can move anywhere. Drag the bar between them to resize. In the overlay the captions are
always below the answer, and in full view they are always on the left.

### Theme (Settings → Display)

Dark (the default) is low-glare for dim rooms and long sessions; Light is quicker to read in a bright
room; Match Windows follows Settings → Personalization → Colors. Title bars and the chat page switch
with the app. Both use the same calm, professional look, chosen for reading at a glance during a live
conversation: graphite neutrals, one blue accent, and status colours that mean the same everywhere
(green listening / ready, amber thinking, blue writing or reading aloud, red for problems), Windows'
own Segoe UI Variable type, flat controls with modest corners, and simple line icons.

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

The panel draws one card per paragraph and only redraws cards whose text or sent state changed
([CaptionList.cs](CaptionList.cs)), and the "Next message" box has a fixed height, so a caption update
costs about the same in the first minute as after two hours. Redrawing the whole transcript on every
update (as earlier versions did) took about 80 ms per update by the end of a long interview, several
times a second, which slowed the whole window down, New chat included. Preview builds can measure it:
build with `-p:DefineConstants=UI_PREVIEW` and run with `IA_PREVIEW_STRESS=1`; the result goes to `log.txt`.

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
| `CaptionList.cs` | Caption cards, redrawing only the ones that changed |
| `AnswerSpeaker.cs` | Reading the answer aloud, sentence by sentence, on a chosen output (Google or Windows voice) |
| `GoogleSpeech.cs` | Google Cloud Text-to-Speech: audio, voice list, the encrypted API key |
| `ChatBridge.cs` | Types into ChatGPT / DeepSeek with trusted DevTools input, submits, reads the answer |
| `AnswerReader.cs` | Answer extraction script, answer model, FlowDocument rendering |
| `MainWindow.xaml(.cs)` | Full / interview view, caption docking, answer reader, menus, hotkey actions |
| `OverlayWindow.xaml(.cs)` | Borderless see-through interview view above other windows |
| `Assets/AppIcon.ico`, `AppIcon.png` | App logo (caption bubble with an AI spark); redraw with `python Assets/make_logo.py Assets` |
| `ThemeManager.cs` | Dark / light palettes, applied live through `DynamicResource` |
| `SetupWindow.xaml(.cs)` | Settings window: Interview, Sending, Display, Voice, Hotkeys tabs |
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
| The voice sounds robotic although Google is chosen | The Windows voice is standing in: the status bar and `log.txt` say why (no key, key not valid, API not enabled, no billing, network). Settings ▸ Voice ▸ **Check key**. |
| The voice is silent | Settings ▸ Voice ▸ **Test**. Check **Play on** is the device you listen on and that its volume is up; `log.txt` shows "Voice: reading …" for each part read. |
| The answer reader stays empty | Switch to **Full view** to check an answer exists on the chat page. If the site changed its layout, update the selectors at the top of `AnswerSnapshot.Script` |
| Questions are split in two (Automatic) | Increase the pause in Settings → Sending (2–2.5 s), or use one of the manual choices |
| Google sign-in refuses the embedded browser | Sign in with email/password (or Microsoft/Apple) instead |
| A hotkey does nothing | Another app owns it (the status bar lists them) or swallows it; pick a different combination in Settings → Hotkeys |
| "Could not start the … view" | Another copy of the app is running with the same browser profile; close it |
