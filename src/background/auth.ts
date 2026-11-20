// Google sign-in via the Hear Me Out web app (which owns Google OAuth and the account allow-list).
//   chrome.identity.launchWebAuthFlow → /extension/connect → https://<id>.chromiumapp.org/#token_hash=…
//   POST /api/public/v1/extension/token exchanges it for a dedicated `hmo_` API key for this profile.
//
// Staying signed in: the key never expires and needs no refresh, so there is nothing to time out.
// Only two things end the connection: Sign out here, or revoking the key in Hear Me Out → Settings →
// API keys. Network failures and server errors never sign you out.
//
// The key lives in IndexedDB of the extension origin (per Chrome profile, never synced, not visible to
// web pages or content scripts; `unlimitedStorage` stops Chrome evicting it) and is removed on sign-out.
import { HMO_ORIGIN } from "../shared/config";
import { getAuthSession, setAuthSession } from "../shared/db";
import type { AuthSession, AuthSummary, AuthUser } from "../shared/types";

export class AuthError extends Error {
  constructor(
    public code: "signed-out" | "expired" | "not-allowed" | "cancelled" | "failed",
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

const REJECTED_KEY = "authRejected";

export function randomState(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parses the chromiumapp.org callback. Exported for tests. */
export function parseCallback(responseUrl: string, expectedState: string): { tokenHash: string } {
  const u = new URL(responseUrl);
  const p = new URLSearchParams(u.hash.replace(/^#/, "") || u.search.replace(/^\?/, ""));
  if (p.get("state") !== expectedState) throw new AuthError("failed", "Sign-in failed a security check. Please try again.");
  const err = p.get("error");
  if (err === "access_denied") throw new AuthError("cancelled", "Sign-in was cancelled.");
  if (err) throw new AuthError("failed", p.get("error_description") ?? "Sign-in failed.");
  const tokenHash = p.get("token_hash");
  if (!tokenHash) throw new AuthError("failed", "Sign-in didn't return a grant. Please try again.");
  return { tokenHash };
}

async function exchange(tokenHash: string): Promise<AuthSession> {
  let r: Response;
  try {
    r = await fetch(`${HMO_ORIGIN}/api/public/v1/extension/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "token_hash", token_hash: tokenHash }),
    });
  } catch {
    throw new AuthError("failed", "Couldn't reach Hear Me Out. Check your connection.");
  }
  const j = (await r.json().catch(() => ({}))) as { api_key?: string; user?: AuthUser; error?: string };
  if (r.status === 403 || j.error === "not_allowed") throw new AuthError("not-allowed", "That Google account isn't authorised for Hear Me Out.");
  if (r.status === 401) throw new AuthError("failed", "That sign-in link has expired. Please try again.");
  if (!r.ok || !j.api_key || !/^hmo_[a-f0-9]{48}$/.test(j.api_key) || !j.user) throw new AuthError("failed", `Sign-in failed (${r.status}).`);
  return { api_key: j.api_key, user: j.user, created_at: Date.now() };
}

/** Best-effort revocation of a key on the server. */
async function revoke(apiKey: string) {
  await fetch(`${HMO_ORIGIN}/api/public/v1/extension/signout`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } }).catch(() => undefined);
}

export async function signIn(): Promise<AuthUser> {
  const state = randomState();
  const redirect = chrome.identity.getRedirectURL();
  const url = `${HMO_ORIGIN}/extension/connect?${new URLSearchParams({ redirect_uri: redirect, state }).toString()}`;
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/did not approve|closed|cancel/i.test(msg)) throw new AuthError("cancelled", "Sign-in was cancelled.");
    throw new AuthError("failed", `Sign-in failed: ${msg}`);
  }
  if (!responseUrl) throw new AuthError("cancelled", "Sign-in was cancelled.");
  const { tokenHash } = parseCallback(responseUrl, state);
  const next = await exchange(tokenHash);
  const previous = await getAuthSession();
  await setAuthSession(next);
  await chrome.storage.local.remove(REJECTED_KEY);
  // Reconnecting replaces this profile's key: retire the old one so keys don't pile up.
  if (previous?.api_key && previous.api_key !== next.api_key) void revoke(previous.api_key);
  return next.user;
}

/** The credential for API calls. No expiry, no refresh. */
export async function getApiKey(): Promise<string> {
  const s = await getAuthSession();
  if (!s?.api_key) throw new AuthError("signed-out", "Sign in with Google to save voice notes.");
  return s.api_key;
}

/** Called when Hear Me Out answers 401. The key is kept (in case it was a blip); the UI offers Reconnect. */
export async function markRejected() {
  await chrome.storage.local.set({ [REJECTED_KEY]: true });
}

export async function markAccepted() {
  const r = await chrome.storage.local.get(REJECTED_KEY);
  if (r[REJECTED_KEY]) await chrome.storage.local.remove(REJECTED_KEY);
}

export async function authSummary(): Promise<AuthSummary> {
  const s = await getAuthSession();
  if (!s?.api_key) return { signedIn: false };
  const r = await chrome.storage.local.get(REJECTED_KEY);
  return { signedIn: true, expired: !!r[REJECTED_KEY], user: s.user };
}

/** Revokes this profile's key server-side (best effort) and removes it locally. */
export async function signOut(): Promise<void> {
  const s = await getAuthSession();
  if (s?.api_key) await revoke(s.api_key);
  await setAuthSession(null);
  await chrome.storage.local.remove(REJECTED_KEY);
}
