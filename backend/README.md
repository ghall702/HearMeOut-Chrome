# Backend changes for the Chrome extension

The extension needs one addition to the Hear Me Out app: a way to sign in with Google and receive a
credential for the existing `/api/public/v1` endpoints, without you pasting an API key. Everything
else uses the existing API unchanged: uploads, the media server, finalising, transcription,
share/embed links and the Gmail card image.

**Easiest way to deploy:** paste [`LOVABLE-PROMPT.md`](LOVABLE-PROMPT.md) into Lovable. It contains
the exact files and a short checklist. If you apply changes to the app repository with git instead,
use `git apply hearmeout-extension-auth.patch`. Both contain the same changes.

There are no new tables, no migrations and no new secrets. `src/lib/apikeys.server.ts`, which checks
`hmo_` keys, is **not modified**. The web app and the Mac/API-key clients behave exactly as before.

## Staying signed in

After you approve the connection, the server creates a **dedicated `hmo_` API key for that Chrome
profile**. It uses the existing `api_keys` table, key format and SHA-256 hashing. API keys don't
expire, so:

* there's no access token to refresh and no session that can time out. Closing Chrome, restarting
  the laptop or leaving it untouched for months doesn't sign you out.
* the connection ends only if you click **Sign out** in the extension (which revokes its key) or
  revoke the key in **Hear Me Out → Settings → API keys**. Each one is listed there as
  "Chrome extension · 20 Nov 2026", with its last-used date.
* network failures and server errors never sign the extension out. If Hear Me Out rejects the key
  (for example, because you revoked it), the popup shows **Reconnect with Google**. Reconnecting
  replaces the key and retires the old one.

On a new laptop, or a new Chrome profile, you sign in once more. Each key belongs to exactly one
profile on one computer.

## What the change adds

| File | Purpose |
|---|---|
| `src/routes/extension.connect.tsx` | The approval page at `/extension/connect`, opened through `chrome.identity.launchWebAuthFlow`. It uses the app's existing Google sign-in and offers **Connect this Chrome profile**, **Use a different account** and **Cancel**. |
| `src/lib/extension-auth.functions.ts` | `createExtensionGrant`. It requires the signed-in user's Supabase session and only accepts `https://<extension-id>.chromiumapp.org/` callbacks. |
| `src/lib/extension-auth.server.ts` | Mints a **single-use** magic-link token hash with `auth.admin.generateLink` (no email is sent). It exchanges the hash for a new `hmo_` key after checking the allow-list. The temporary Supabase session used for the check is ended immediately. It also revokes a key on sign-out. |
| `src/routes/api/public/v1/extension.token.ts` | `POST {grant_type:"token_hash", token_hash}` returns `{api_key, user}`. A disallowed account gets 403; a bad or used grant gets 401. |
| `src/routes/api/public/v1/extension.signout.ts` | `POST` with `Authorization: Bearer hmo_…` revokes that key. |
| `src/routes/api/public/v1/recordings.$id.upload-url.ts` | A fresh upload token for a recording that's still pending, so retrying an upload never creates a duplicate. Returns 409 if the recording is already finalised. |
| `src/routes/index.tsx` | 4 lines: returns you to `/extension/connect` if the Google sign-in flow lands on `/`. |
| `src/test/extension-auth.test.ts` | Tests for callback validation, the extension-ID allow-list, the email allow-list and key naming. |

## Flow

```
Extension (service worker)              Hear Me Out web app                    Supabase Auth
launchWebAuthFlow ────────────────────▶ /extension/connect?redirect_uri=https://<id>.chromiumapp.org/&state=…
                                        Google sign-in (existing flow; allow-list enforced)
                                        "Connect this Chrome profile"
                                        createExtensionGrant ────────────────▶ admin.generateLink (no email)
◀── https://<id>.chromiumapp.org/#token_hash=…&state=…   (only this extension can receive this URL)
POST /api/public/v1/extension/token ──▶ verifyOtp(token_hash) → allow-list → insert api_keys row
◀── { api_key: "hmo_…", user }          (stored in the extension's IndexedDB for this profile only)
Authorization: Bearer hmo_… on /api/public/v1/uploads, /finalize, /recordings …
```

Security:

* The grant is single-use and short-lived. It arrives in a URL fragment at a `chromiumapp.org`
  address, which Chrome delivers only to the extension with that ID, and a random `state` value
  protects it.
* Only the hash of the key is stored on the server. On the client, the key is kept in the
  extension's own IndexedDB, which web pages and content scripts can't read and Chrome never syncs.
  It's deleted when you sign out.
* The allow-list is checked when the grant is created and again when it's exchanged. The existing
  database trigger and RLS rules still apply.
* The media gateway secret stays on the server. The extension still receives only the per-file
  upload tokens that `/api/public/v1/uploads` already returns.

## Settings

| Name | Secret? | Value |
|---|---|---|
| `HMO_EXTENSION_IDS` | No | `lphpbndpbbdgoglbgglgeckecbeilpjn` (the ID is fixed by the manifest `key`). If you later publish to the Chrome Web Store, add the store's ID, comma-separated. |

The change uses the existing `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`.

### Notes

* **Media server CORS:** the extension's `host_permissions` cover the media server, so you don't
  need to change the gateway's allowed origins.
* **Transcription:** the extension finalises with `transcribe:false` so the share links appear
  immediately. It then calls `finalize` with `transcribe:true` to start the existing transcription.
