# Publishing Hear Me Out to the Chrome Web Store (Unlisted)

**Why:** once it's on the Chrome Web Store you install it like any other extension: open a link and
click **Add to Chrome**. There are no files to unzip, no Developer mode, and nothing to install on the
computer. It updates itself, and it works on work computers and Chromebooks that block "Load
unpacked" but allow store extensions.

**Unlisted** means it never appears in search or browsing. Only someone with the link can find it.
Even then, nobody else can use it, because sign-in only accepts your three allowed Google accounts.

Everything you need is in this folder:

| File | What it's for |
|---|---|
| `hearmeout-chrome-1.0.0.zip` | The package you upload. |
| `assets/store-1-record.png` … `store-5-dark.png` | Five 1280×800 screenshots. |
| `assets/small-promo-tile-440x280.png` | The required small promo tile. |
| This page | Copy-paste answers for every form. |

You do this once, and it takes about 30 minutes. Google's review usually takes from a few hours to a
few days.

---

## Step 0: Add a privacy policy page to Hear Me Out (Lovable)

The store requires a public privacy policy link. Paste this into Lovable, then **Publish → Update**:

```
Please add a public page at /privacy (no sign-in required) titled "Privacy — Hear Me Out".
Use the same look as the rest of the site and British English. Link to it from the sign-in page
footer in small text ("Privacy"). Page content:

Hear Me Out is a private voice-note service for authorised accounts only.

What we store
• Your Google account's email address, name and profile picture, to sign you in.
• Voice notes you choose to save, their titles, automatically generated transcripts and titles,
  and how many times each shared link has been played.
• For the Hear Me Out Chrome extension: one access key per connected Chrome profile, stored as a
  hash. You can see and revoke these under Settings → API keys.

Where it is stored
• Account and recording details are stored in our database. Audio files are stored on our own
  storage server. Transcripts and titles are produced by an AI service only to process your own
  recordings.

The Chrome extension
• Records from your microphone only when you press record, and uploads a recording only when you
  press Save.
• Detects which website you are on (for example Gmail or Moodle) to suggest a sharing format.
  This happens on your computer; website addresses and page contents are never sent to us.
• Does not read your emails, documents or any other page content, and contains no analytics or
  tracking.
• Keeps unsaved recordings on your computer until you save or discard them, and deletes its stored
  sign-in when you sign out.

What we don't do
• We do not sell or share your data, use it for advertising, or use it for anything other than
  providing Hear Me Out.

Contact: george@gsuite.georgehalltuition.com
```

Then check that <https://hearmeout.george-hall.uk/privacy> opens without signing in.

## Step 1: Create a Chrome Web Store developer account (one time)

1. Go to <https://chrome.google.com/webstore/devconsole> and sign in with the Google account that
   should own the listing. Your main personal account is a good choice.
2. Accept the developer agreement and pay Google's **one-time registration fee** (US$5).
3. Verify your contact email address when Google asks.

## Step 2: Upload the package

1. In the developer console, click **New item**.
2. Upload **`store/hearmeout-chrome-1.0.0.zip`**. On GitHub, open the file and click **Download
   raw file** first.

## Step 3: Fill in the tabs

### Store listing

| Field | Paste |
|---|---|
| Description | *(below)* |
| Category | **Productivity → Communication** (or **Productivity → Tools**) |
| Language | **English (United Kingdom)** |
| Store icon | `public/icons/icon-128.png` (128×128) |
| Screenshots | the five `assets/store-*.png` files, in order |
| Small promo tile | `assets/small-promo-tile-440x280.png` |
| Official URL / Homepage | `https://hearmeout.george-hall.uk` |
| Support URL | `https://hearmeout.george-hall.uk` |

**Description:**

```
Record a voice note from any tab and share it in the format that suits the website you're on.

• Record up to 15 minutes. Recording carries on while you switch tabs, windows or apps — close the
  popup and keep working.
• Pause, resume, review and give it a title before saving.
• Context-aware sharing: Gmail and Outlook get a clickable email card, Moodle gets an HTML player
  embed, everything else gets a share link. Add your own website rules.
• Optional one-click insert into a Gmail draft.
• Library of recent recordings with play counts, transcripts and search.
• Light, dark and system themes. Keyboard shortcuts.
• Sign in once per Chrome profile with Google and stay signed in.

Hear Me Out is a private service: only authorised accounts can sign in.
```

### Privacy practices

**Single purpose:**

```
Record voice notes and share them through the user's Hear Me Out account in the format best suited
to the current website.
```

**Permission justifications:**

| Permission | Justification (paste) |
|---|---|
| `offscreen` | Hosts the microphone recorder so recording continues after the popup closes, and writes share links to the clipboard from keyboard shortcuts. |
| `storage` | Saves the user's settings, website rules and the current recording state on this device. |
| `unlimitedStorage` | Keeps unsaved recordings and the user's sign-in on the device so Chrome does not delete them when disk space is low. |
| `identity` | Opens the Hear Me Out sign-in page with chrome.identity.launchWebAuthFlow so the user can sign in with Google. |
| `alarms` | Backup timer that stops a recording at the 15-minute limit if the popup is closed. |
| `notifications` | Tells the user when a recording stops automatically (time limit or microphone disconnected) or when a shortcut has copied a link. |
| `activeTab` | Reads the current tab's address, only when the user opens the extension or uses its shortcut, to recommend a sharing format (e.g. Gmail → email card). The address is never sent anywhere. |
| `scripting` | Inserts the voice-note card into a Gmail draft only when the user clicks "Insert into Gmail". |
| `clipboardWrite` | Copies the chosen sharing format to the clipboard. |
| Host permissions (`hearmeout.george-hall.uk`, `mediahub-lm-1.georgehalltuition.com`) | The user's own Hear Me Out account API and the storage server that recordings are uploaded to. |

**Are you using remote code?** → **No.**

**Data usage.** Tick these, and nothing else:

* ✅ **Personally identifiable information**: the account email and name, shown in the extension.
* ✅ **Authentication information**: the extension's access key for the user's own account.
* ✅ **Personal communications**: the voice notes the user records and chooses to save.

Leave everything else unticked. In particular, **don't** tick Web history or Website content: the
current address is only checked on the device and never collected.

Tick all three certifications: *I do not sell or transfer user data…*, *I do not use or transfer
user data for purposes unrelated to the item's single purpose*, and *I do not use or transfer user
data to determine creditworthiness…*.

**Privacy policy URL:** `https://hearmeout.george-hall.uk/privacy`

### Distribution

* **Payments:** Free.
* **Visibility:** **Unlisted**.
* **Regions:** all regions, or just United Kingdom. Either works.

## Step 4: Submit for review

Click **Submit for review**. Google emails you when the extension is approved. If they ask a
question, the answers above are accurate; reply with the relevant row.

## Step 5: Allow the store version to sign in (Lovable)

The store gives the extension its **own ID**: a 32-letter code shown in the developer console,
under the item name. Copy it, then paste this into Lovable (replacing `STORE_ID_HERE`), then
**Publish → Update**:

```
Please update the non-secret environment variable HMO_EXTENSION_IDS so it allows both versions of
my Chrome extension. Set it to exactly:

lphpbndpbbdgoglbgglgeckecbeilpjn,STORE_ID_HERE

No code changes are needed.
```

> You can do this as soon as the item is created; you don't have to wait for the review.

## Step 6: Install it everywhere

Open the item's store link (developer console → **View in Chrome Web Store**; save it somewhere
handy, such as a note or bookmark). Then, in each Chrome profile on each computer:

1. Open the link and click **Add to Chrome**.
2. Pin the icon and click **Sign in with Google**.

If you previously used the downloaded zip in a profile, remove that copy at `chrome://extensions`
so you don't have two icons.

---

## Publishing an update later

1. Bump `"version"` in `package.json` (for example `1.0.1`).
2. Run `npm run package`. This writes `store/hearmeout-chrome-<version>.zip`.
3. Developer console → the item → **Package → Upload new package**, then **Submit for review**.
   Chrome updates everyone's installed copy automatically after approval.

You can also ask Claude Code to do steps 1–2.
