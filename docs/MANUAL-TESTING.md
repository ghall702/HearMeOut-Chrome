# Manual test plan: Chrome on macOS, Windows 11 and ChromeOS

The automated e2e suite (`npm run test:e2e`) runs in Chromium on Linux with a fake microphone. It
can't use a real microphone, the macOS or Windows privacy controls, or real desktop apps such as Word
and Excel. Run this checklist once on **each** platform: current Google Chrome on macOS, and current
Google Chrome on Windows 11, and a Chromebook (ChromeOS). Install from
[`download/HearMeOut-for-Chrome.zip`](../download/HearMeOut-for-Chrome.zip) by following
[INSTALL.md](INSTALL.md). On the Chromebook, use any non-browser app (for example the Files app or
an Android app) in place of Word or Excel.

Before you start:

* Build with `npm run build` and load `dist/` unpacked in **two** Chrome profiles (for example
  Personal and Work). Pin the icon in both.
* The backend patch is deployed, so **Sign in with Google** works.
* Have Word or Excel (or any other non-Chrome desktop app) open.
* Keep a phone stopwatch handy.

Record each result as Pass or Fail, with notes.

## A. Sign-in and profiles

| # | Steps | Expected |
|---|---|---|
| A1 | Profile 1: open the popup and click **Sign in with Google**. | A Hear Me Out window opens. If the web app is already signed in, you see "Signed in as …" and **Connect this Chrome profile**. Otherwise Google's account chooser appears. After connecting, the window closes and the popup shows Record / Library / Settings. |
| A2 | Settings → Account. | It shows the right Google account. There's no account switcher. |
| A3 | Quit Chrome completely, restart the computer, then open Chrome and the popup. | You're still signed in, with no prompt. Check again after a few days: still signed in. |
| A3b | In the web app, go to Settings → API keys. | Each connected profile is listed as "Chrome extension · <date>" with a recent "Last used" date. |
| A3c | Revoke that profile's key in the web app, then open the extension's Library. | A **Reconnect with Google** banner appears and you're not silently signed out. Reconnecting fixes it, and a new key appears in the list. |
| A4 | Profile 2: open the popup. | You're **not** signed in. Sign in with a *different* allowed account. |
| A5 | Library in each profile. | Each profile lists only its own account's recordings. |
| A6 | Try signing in with a Google account that isn't on the allow-list. | "That Google account isn't authorised for Hear Me Out." No session is created. |
| A7 | Profile 2: Settings → Sign out → **Sign out and remove local data**. | You're back at the sign-in screen. Profile 1 is still signed in. |

## B. Microphone permission

| # | Steps | Expected |
|---|---|---|
| B1 | On a fresh profile, click the record button. | A tab asks for microphone access. Choose **Allow**, then **Start recording now**. The tab closes and the badge shows **REC**. |
| B2 | Record again later. | There's no permission prompt. |
| B3 | **macOS:** System Settings → Privacy & Security → Microphone → turn Google Chrome off, then try to record. | You get a clear error that the microphone couldn't be started. Turn it back on afterwards. |
| B3c | **ChromeOS:** Settings → Security and privacy → Privacy controls → turn *Microphone access* off, then try to record. | The same clear error. Turn it back on afterwards. |
| B4 | **Windows:** Settings → Privacy & security → Microphone → turn *Let desktop apps access your microphone* off, then try to record. | The same clear error. Turn it back on afterwards. |

## C. Background recording (the acceptance test)

Use a real voice and count out loud ("one… two…") so you can check the result is complete.

| # | Steps | Expected |
|---|---|---|
| C1 | Open Gmail, open the popup and click record. Start your stopwatch. | The timer runs and the badge shows **REC**. |
| C2 | Click anywhere on the page. | The popup closes. **REC** stays on the icon. |
| C3 | Read and write an email, open a new tab, browse, and switch tabs. | **REC** stays on throughout. |
| C4 | Open a second Chrome window (Ctrl/Cmd+N) and use it. | **REC** stays on. |
| C5 | Minimise Chrome. | The OS microphone indicator stays on (the orange dot on macOS, the mic icon in the Windows taskbar). |
| C6 | Switch to **Word** or **Excel** and work for **5 minutes** while talking. | The OS microphone indicator stays on. |
| C7 | Go back to Chrome and open the popup. | It's still recording. The timer matches your stopwatch to within about a second. |
| C8 | Click **Stop recording**. | The review screen appears and **REC** goes. |
| C9 | Play the recording, including the middle. | It's the **whole** 5+ minutes, including everything you said while Word or Excel was in front. |
| C10 | Click **Save voice note**. | It uploads, then shows "Saved to Hear Me Out" with the share options. The recording appears in the web app. |

## D. Recording controls, limits and recovery

| # | Steps | Expected |
|---|---|---|
| D1 | Record 10 s, click **Pause** and wait 10 s, click **Resume** and record 10 s, then stop. | The badge shows **II** while paused. The audio is about 20 s and contains nothing from the pause. |
| D2 | With the popup closed, press the start/stop shortcut twice (`⌥⇧R` / `Alt+Shift+R`). | Recording starts, then stops with a notification. Only one recording exists. |
| D3 | Start a recording, close the popup, and leave it for **15 minutes**. | Recording stops at 15:00 and a notification says the limit was reached. Open the popup: the review screen shows the full 15 minutes. |
| D4 | Start recording, then unplug a USB or Bluetooth microphone. | Recording stops with a "Microphone disconnected" notification. The audio up to that point can be reviewed and saved. |
| D5 | Start recording, wait 30 s, then **quit Chrome completely** and reopen it. | There's **no** REC badge after the restart. Open the popup: you see "This recording was interrupted… recovered" and about 30 s of audio that you can save or discard. |
| D6 | While recording, click the record button again from the permission page or a second popup. | You're told a recording is already in progress. No second recording starts. |

## E. Upload reliability

| # | Steps | Expected |
|---|---|---|
| E1 | Stop a recording, turn Wi-Fi off, and click Save. | You see an error and "Your recording is safe". The audio still plays. |
| E2 | Turn Wi-Fi back on and click **Retry upload**. | It saves. The web app shows **one** recording, not two. |
| E3 | Close the popup during a long upload, then reopen it. | It shows upload progress, or "Saved" once it's finished. |

## F. Website detection and sharing

| # | Site | Expected after saving |
|---|---|---|
| F1 | Gmail | **Gmail detected** and "You're on Gmail. Copy an email-friendly voice-note card?" The primary button is **Copy for Gmail**. Paste into a new email: you get the clickable card image with an introduction and a "Listen" link. Paste into Notepad or TextEdit: you get the plain-text message with the URL. |
| F2 | Gmail compose open, cursor in the body | **Insert into Gmail** inserts the card at the cursor. Existing text is untouched and nothing is sent. |
| F3 | `lms.georgehalltuition.com` (and `lms.georgehilltuition.com`) | **Moodle detected**. The primary button is **Copy HTML Embed**. Paste into Moodle's HTML source view and save: the player appears. |
| F4 | Outlook on the web | The primary button is **Copy for Outlook** (the email card). |
| F5 | Docs, Classroom, Slack, Teams, and any other site | The primary button is **Copy Share Link**. The link opens the listening page. |
| F6 | Settings → add a rule `example.com` → *HTML embed*, then visit example.com | You see "example.com name detected" and the HTML embed is recommended. Edit the rule, then remove it. |
| F7 | Open the popup in Gmail, switch tabs to Moodle without closing it | The recommendation updates. |
| F8 | Each copy button | "Copied to clipboard" appears and the button turns green briefly. |

## G. Library, settings and shortcuts

| # | Steps | Expected |
|---|---|---|
| G1 | Library | Shows the title, date, duration, plays and listened status. Search filters the list. Refresh works. |
| G2 | Expand a recording | The recommended copy and all four formats work, **View transcript** shows the text, and **Open** opens the recording in the web app. |
| G3 | Settings → Appearance → Light, Dark, System | The popup updates straight away. *System* follows the OS setting. |
| G4 | Settings → Microphone → choose another input device | The next recording uses that microphone. |
| G5 | Settings → Keyboard shortcuts → **Change shortcuts** | Opens `chrome://extensions/shortcuts`. Set *Start/stop recording* to **Global** and check it works from Word. |
| G6 | `⌥⇧C` / `Alt+Shift+C` on Gmail with the popup closed | The latest voice note is copied as the Gmail card and a notification confirms it. |
| G7 | Keyboard only | Tab and Shift+Tab reach every control, arrow keys switch the Record / Library / Settings tabs, and focus rings are visible. |
