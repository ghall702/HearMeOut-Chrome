// Google sign-in via the Hear Me Out web app (which owns Google OAuth and the account allow-list).
//   chrome.identity.launchWebAuthFlow → /extension/connect → https://<id>.chromiumapp.org/#token_hash=…
//   POST /api/public/v1/extension/token exchanges it for this profile's own short-lived session.
// Sessions live in IndexedDB of the extension origin: per Chrome profile, never synced, never visible
// to web pages or content scripts, and removed on sign-out.
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

const LAST_USER_KEY = "lastUser";

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

async function tokenRequest(body: Record<string, string>): Promise<AuthSession> {
  let r: Response;
  try {
    r = await fetch(`${HMO_ORIGIN}/api/public/v1/extension/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("failed", "Couldn't reach Hear Me Out. Check your connection.");
  }
  const j = (await r.json().catch(() => ({}))) as Partial<AuthSession> & { error?: string };
  if (r.status === 403 || j.error === "not_allowed") throw new AuthError("not-allowed", "That Google account isn't authorised for Hear Me Out.");
  if (r.status === 401 || r.status === 400) throw new AuthError("expired", "Your Hear Me Out session has expired. Please reconnect.");
  if (!r.ok || !j.access_token || !j.refresh_token || !j.user) throw new AuthError("failed", `Sign-in failed (${r.status}).`);
  return j as AuthSession;
}

async function store(s: AuthSession) {
  await setAuthSession(s);
  await chrome.storage.local.set({ [LAST_USER_KEY]: s.user });
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
  const s = await tokenRequest({ grant_type: "token_hash", token_hash: tokenHash });
  await store(s);
  return s.user;
}

let refreshing: Promise<AuthSession> | null = null;

/** Returns a valid access token, refreshing (single-flight) when it is close to expiry. */
export async function getAccessToken(force = false): Promise<string> {
  const s = await getAuthSession();
  if (!s) throw new AuthError("signed-out", "Sign in with Google to save voice notes.");
  if (!force && s.expires_at - 90 > Date.now() / 1000) return s.access_token;
  refreshing ??= (async () => {
    try {
      const next = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh_token });
      await store(next);
      return next;
    } catch (e) {
      if (e instanceof AuthError && (e.code === "expired" || e.code === "not-allowed")) {
        await setAuthSession(null);
        await chrome.storage.local.set({ authExpired: true });
      }
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return (await refreshing).access_token;
}

export async function authSummary(): Promise<AuthSummary> {
  const s = await getAuthSession();
  if (s) return { signedIn: true, user: s.user };
  const r = await chrome.storage.local.get([LAST_USER_KEY, "authExpired"]);
  return { signedIn: false, expired: !!r["authExpired"], user: (r[LAST_USER_KEY] as AuthUser | undefined) ?? undefined };
}

/** Revokes this extension session server-side (best effort) and removes every credential locally. */
export async function signOut(): Promise<void> {
  const s = await getAuthSession();
  if (s) {
    await fetch(`${HMO_ORIGIN}/api/public/v1/extension/signout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.access_token}` },
    }).catch(() => undefined);
  }
  await setAuthSession(null);
  await chrome.storage.local.remove([LAST_USER_KEY, "authExpired"]);
}

export async function onSignedIn() {
  await chrome.storage.local.remove("authExpired");
}
