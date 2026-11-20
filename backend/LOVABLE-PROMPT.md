# Prompt for Lovable

Copy everything **below the line** into Lovable as one message. It's self-contained: it says what
to build, gives the exact code for each new file, and lists what must not change.

---

Please add sign-in support for my **Hear Me Out Chrome extension**. I want to sign in to the
extension once per Chrome profile with Google and then **stay signed in permanently**, with no
expiry and no re-login, until I sign out or revoke it.

How it works: the extension opens a new page, `/extension/connect`, using
`chrome.identity.launchWebAuthFlow`. I sign in with the app's existing Google sign-in and click
**Connect**. The server then creates a **dedicated `hmo_` API key** for that Chrome profile, using
the existing `api_keys` table and the existing key format and hashing. The extension uses that key
with the existing `/api/public/v1` endpoints, which already accept `hmo_` keys. Each key appears in
**Settings → API keys** as "Chrome extension · <date>", so I can revoke it there.

Rules:
- **Don't** change `src/lib/apikeys.server.ts`, the `/api/public/v1` uploads, finalize or recordings
  routes, the database schema, RLS, the allow-list trigger, or any secrets. No migration is needed.
- **Don't** edit generated files by hand. Let the router regenerate `src/routeTree.gen.ts`.
- Use British English in any text.
- Add a **non-secret** environment variable: `HMO_EXTENSION_IDS=lphpbndpbbdgoglbgglgeckecbeilpjn`.

## 1. New files (create each one exactly as given)

### `src/lib/extension-auth.server.ts`
Server-only helpers: validate the extension callback, mint a single-use sign-in grant, exchange it for a dedicated API key, and revoke that key.

```tsx
// Chrome extension sign-in support. Server-only.
//
// Flow (see /extension/connect):
//  1. The extension opens /extension/connect with chrome.identity.launchWebAuthFlow.
//  2. The signed-in user approves; createExtensionGrant mints a single-use Supabase magic-link
//     token hash (no email is sent) and the page redirects to https://<extension-id>.chromiumapp.org/,
//     a URL only that extension can receive.
//  3. The extension exchanges the hash at POST /api/public/v1/extension/token for a dedicated,
//     non-expiring `hmo_` API key (shown and revocable in Settings → API keys), so it stays signed
//     in until the user signs out or revokes it. POST /api/public/v1/extension/signout revokes it.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ALLOWED_EMAILS } from "./hmo-core";
import { newApiKey, sha256Hex } from "./apikeys.server";

const REDIRECT_RE = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/?$/;

/** Returns the extension id if redirectUri is a valid chromiumapp.org callback for an allowed extension. */
export function extensionIdFromRedirect(redirectUri: string): string | null {
  const m = REDIRECT_RE.exec(redirectUri);
  if (!m) return null;
  const id = m[1]!;
  const allowed = (process.env["HMO_EXTENSION_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(id)) return null;
  return id;
}

export const isAllowedEmail = (email: string | null | undefined) =>
  !!email && ALLOWED_EMAILS.includes(email.toLowerCase());

function anonClient() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Supabase is not configured");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storage: undefined },
  });
}

/** Mint a single-use token hash for the given user. Does not send an email. */
export async function mintExtensionGrant(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: u, error: ue } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = u?.user?.email;
  if (ue || !email) throw new Error("Account not found");
  if (!isAllowedEmail(email)) throw new Error("That Google account isn't authorised for Hear Me Out.");
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw new Error("Could not create an extension sign-in grant");
  return { tokenHash };
}

export function userPayload(user: { id: string; email?: string | undefined; user_metadata?: Record<string, unknown> | undefined }) {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? null,
    name: (meta["full_name"] as string | undefined) ?? (meta["name"] as string | undefined) ?? null,
    avatar_url: (meta["avatar_url"] as string | undefined) ?? (meta["picture"] as string | undefined) ?? null,
  };
}

export function extensionKeyName(now = new Date()) {
  const d = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(now);
  return `Chrome extension · ${d}`;
}

/** Single-use grant → dedicated API key for this Chrome profile. */
export async function exchangeGrantForApiKey(tokenHash: string) {
  const sb = anonClient();
  let { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error || !data.session) ({ data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: "email" }));
  if (error || !data.session || !data.user) throw new Error("invalid_grant");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The temporary session was only needed to prove the grant; end it straight away.
  await supabaseAdmin.auth.admin.signOut(data.session.access_token, "local").catch(() => undefined);
  if (!isAllowedEmail(data.user.email)) throw new Error("not_allowed");
  const key = newApiKey();
  const { error: insErr } = await supabaseAdmin.from("api_keys").insert({
    user_id: data.user.id,
    name: extensionKeyName(),
    key_prefix: key.slice(0, 10),
    key_hash: await sha256Hex(key),
  });
  if (insErr) throw new Error("could_not_create_key");
  return { api_key: key, user: userPayload(data.user) };
}

/** Revokes the extension's own API key (from the Authorization header). */
export async function revokeExtensionKey(request: Request) {
  const m = /^Bearer\s+(hmo_[a-f0-9]{48})$/i.exec((request.headers.get("authorization") ?? "").trim());
  if (!m) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("key_hash", await sha256Hex(m[1]!.toLowerCase()))
    .is("revoked_at", null);
  return !error;
}
```

### `src/lib/extension-auth.functions.ts`
Server function the approval page calls (requires the signed-in user's session).

```tsx
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extensionIdFromRedirect, mintExtensionGrant } from "./extension-auth.server";

/** Called by /extension/connect after the signed-in user approves the Chrome extension. */
export const createExtensionGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ redirectUri: z.string().url().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!extensionIdFromRedirect(data.redirectUri)) throw new Error("This extension isn't allowed to connect.");
    return mintExtensionGrant(context.userId);
  });
```

### `src/routes/extension.connect.tsx`
The approval page the extension opens.

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Chrome, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/hmo/Logo";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { ALLOWED_EMAILS } from "@/lib/hmo-core";
import { createExtensionGrant } from "@/lib/extension-auth.functions";

// Approval page opened by the Hear Me Out Chrome extension via chrome.identity.launchWebAuthFlow.
// It never shows or stores credentials: on approval it redirects to the extension's chromiumapp.org
// callback with a single-use grant that the extension exchanges for its own session.
export const Route = createFileRoute("/extension/connect")({
  ssr: false,
  head: () => ({ meta: [{ title: "Connect Chrome extension — Hear Me Out" }, { name: "robots", content: "noindex" }] }),
  component: ConnectExtension,
});

const PENDING_KEY = "hmo-ext-connect";
const REDIRECT_RE = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/?$/;
type Pending = { redirectUri: string; state: string };

function readPending(): Pending | null {
  const q = new URLSearchParams(window.location.search);
  const redirectUri = q.get("redirect_uri");
  const state = q.get("state");
  if (redirectUri && state) {
    const p = { redirectUri, state };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    return p;
  }
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as Pending | null;
  } catch {
    return null;
  }
}

function ConnectExtension() {
  const grant = useServerFn(createExtensionGrant);
  const [pending, setPending] = useState<Pending | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phase, setPhase] = useState<"checking" | "signin" | "approve" | "working" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = readPending();
    setPending(p);
    if (!p || !REDIRECT_RE.test(p.redirectUri) || !/^[\w-]{16,128}$/.test(p.state)) {
      setPhase("error");
      setError("This link is incomplete. Open the Hear Me Out extension and choose Sign in with Google again.");
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      const e = data.user?.email?.toLowerCase() ?? null;
      if (data.user && e && ALLOWED_EMAILS.includes(e)) {
        setEmail(e);
        setPhase("approve");
      } else {
        if (data.user) {
          void supabase.auth.signOut();
          setError("That Google account isn't authorised for Hear Me Out.");
        }
        setPhase("signin");
      }
    });
  }, []);

  const finish = (fragment: Record<string, string>) => {
    if (!pending) return;
    sessionStorage.removeItem(PENDING_KEY);
    const f = new URLSearchParams({ ...fragment, state: pending.state });
    window.location.replace(`${pending.redirectUri}#${f.toString()}`);
  };

  const signIn = async (switchAccount = false) => {
    setPhase("working");
    if (switchAccount) await supabase.auth.signOut();
    const r = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/extension/connect`,
      extraParams: { prompt: "select_account" },
    });
    if (r.error) {
      setError(/authori|not allowed|Database error/i.test(r.error.message) ? "That Google account isn't authorised for Hear Me Out." : r.error.message);
      setPhase("signin");
      return;
    }
    if (r.redirected) return;
    window.location.reload();
  };

  const approve = async () => {
    setPhase("working");
    try {
      const { tokenHash } = await grant({ data: { redirectUri: pending!.redirectUri } });
      finish({ token_hash: tokenHash });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect the extension.");
      setPhase("approve");
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-md animate-rise rounded-[2rem] border bg-card p-7 shadow-soft">
        <Logo />
        <h1 className="mt-8 text-2xl font-semibold">Connect Hear Me Out for Chrome</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The extension will be able to record voice notes to your account and list your recordings. It can't see your password and you can sign it out at any time.
        </p>
        {error && <p className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
        {phase === "checking" || phase === "working" ? (
          <div className="mt-8 grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : phase === "signin" ? (
          <div className="mt-8 space-y-3">
            <Button className="h-12 w-full rounded-full" variant="outline" onClick={() => signIn(false)}>Continue with Google</Button>
            <Button className="w-full rounded-full" variant="ghost" onClick={() => finish({ error: "access_denied" })}>Cancel</Button>
          </div>
        ) : phase === "approve" ? (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3 text-sm">
              <ShieldCheck className="size-5 text-primary" />
              <span className="min-w-0 truncate">Signed in as <strong>{email}</strong></span>
            </div>
            <Button className="h-12 w-full rounded-full" variant="hero" onClick={approve}><Chrome /> Connect this Chrome profile</Button>
            <div className="flex gap-2">
              <Button className="flex-1 rounded-full" variant="outline" onClick={() => signIn(true)}>Use a different account</Button>
              <Button className="flex-1 rounded-full" variant="ghost" onClick={() => finish({ error: "access_denied" })}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

### `src/routes/api/public/v1/extension.token.ts`
Exchanges the single-use grant for this Chrome profile's API key.

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { exchangeGrantForApiKey } from "@/lib/extension-auth.server";
import { json } from "@/lib/api-http.server";

// POST /api/public/v1/extension/token — Chrome extension sign-in.
//   { "grant_type": "token_hash", "token_hash": "…" }
// → 200 { api_key: "hmo_…", user: { id, email, name, avatar_url } }
// The key doesn't expire; it is listed (and revocable) in Settings → API keys.
export const Route = createFileRoute("/api/public/v1/extension/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = z
          .object({ grant_type: z.literal("token_hash"), token_hash: z.string().min(10).max(200) })
          .safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid_request" }, 400);
        try {
          return json(await exchangeGrantForApiKey(parsed.data.token_hash));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "";
          if (msg === "not_allowed") return json({ error: "not_allowed" }, 403);
          if (msg === "could_not_create_key") return json({ error: "could_not_create_key" }, 500);
          return json({ error: "invalid_grant" }, 401);
        }
      },
    },
  },
});
```

### `src/routes/api/public/v1/extension.signout.ts`
Lets the extension revoke its own key when you sign out.

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { revokeExtensionKey } from "@/lib/extension-auth.server";
import { json } from "@/lib/api-http.server";

// POST /api/public/v1/extension/signout — revokes the extension's own API key (Bearer hmo_…).
export const Route = createFileRoute("/api/public/v1/extension/signout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await revokeExtensionKey(request))) return json({ error: "unauthorised" }, 401);
        return json({ ok: true });
      },
    },
  },
});
```

### `src/routes/api/public/v1/recordings.$id.upload-url.ts`
Fresh upload token for a still-pending recording (so a retried upload never creates a duplicate).

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { authenticateApiKey } from "@/lib/apikeys.server";
import { getOwnedRecording, reissueUpload } from "@/lib/recordings.server";
import { json, errMsg } from "@/lib/api-http.server";

// POST /api/public/v1/recordings/:id/upload-url — fresh upload token for a recording that is still
// pending (e.g. the first token expired before a retry). Avoids creating a duplicate recording.
export const Route = createFileRoute("/api/public/v1/recordings/$id/upload-url")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await authenticateApiKey(request);
        if (!auth) return json({ error: "unauthorised" }, 401);
        try {
          const rec = await getOwnedRecording(auth.db, auth.userId, params.id);
          if (rec.status === "ready") return json({ error: "already_finalised" }, 409);
          const t = await reissueUpload(auth.db, auth.userId, params.id);
          return json({ recordingId: rec.id, key: t.key, uploadUrl: t.url, method: "PUT", headers: { Authorization: `Bearer ${t.token}` }, exp: t.exp });
        } catch (e) {
          return json({ error: errMsg(e) }, 404);
        }
      },
    },
  },
});
```

### `src/test/extension-auth.test.ts`
Tests.

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { extensionIdFromRedirect, extensionKeyName, isAllowedEmail, userPayload } from "@/lib/extension-auth.server";

describe("Chrome extension auth", () => {
  afterEach(() => {
    delete process.env["HMO_EXTENSION_IDS"];
  });

  it("only accepts chromiumapp.org callbacks", () => {
    expect(extensionIdFromRedirect("https://lphpbndpbbdgoglbgglgeckecbeilpjn.chromiumapp.org/")).toBe("lphpbndpbbdgoglbgglgeckecbeilpjn");
    expect(extensionIdFromRedirect("https://evil.example/")).toBeNull();
    expect(extensionIdFromRedirect("https://lphpbndpbbdgoglbgglgeckecbeilpjn.chromiumapp.org.evil.example/")).toBeNull();
    expect(extensionIdFromRedirect("http://lphpbndpbbdgoglbgglgeckecbeilpjn.chromiumapp.org/")).toBeNull();
  });

  it("enforces HMO_EXTENSION_IDS when set", () => {
    process.env["HMO_EXTENSION_IDS"] = "lphpbndpbbdgoglbgglgeckecbeilpjn";
    expect(extensionIdFromRedirect("https://lphpbndpbbdgoglbgglgeckecbeilpjn.chromiumapp.org/")).not.toBeNull();
    expect(extensionIdFromRedirect("https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/")).toBeNull();
  });

  it("mirrors the account allow-list", () => {
    expect(isAllowedEmail("GHALL702@gmail.com")).toBe(true);
    expect(isAllowedEmail("someone@example.com")).toBe(false);
    expect(isAllowedEmail(null)).toBe(false);
  });

  it("names keys so they're recognisable in Settings → API keys", () => {
    const n = extensionKeyName(new Date(2026, 10, 20));
    expect(n).toBe("Chrome extension · 20 Nov 2026");
    expect(n.length).toBeLessThanOrEqual(60);
  });

  it("returns only the user fields the extension needs", () => {
    expect(userPayload({ id: "u", email: "e@x", user_metadata: { full_name: "G H", picture: "p" } })).toEqual({ id: "u", email: "e@x", name: "G H", avatar_url: "p" });
  });
});
```

## 2. One small change to `src/routes/index.tsx`

In the `useEffect` of the sign-in page, replace this line:

```tsx
if (data.user && email && ALLOWED_EMAILS.includes(email)) navigate({ to: "/record", replace: true });
```

with:

```tsx
if (data.user && email && ALLOWED_EMAILS.includes(email)) {
  // Returning from Google sign-in started by the Chrome extension's connect page.
  if (sessionStorage.getItem("hmo-ext-connect")) navigate({ to: "/extension/connect", replace: true });
  else navigate({ to: "/record", replace: true });
}
```

## 3. Check it worked

1. The tests in `src/test/extension-auth.test.ts` and all the existing tests pass, and the build
   succeeds.
2. Opening `/extension/connect?redirect_uri=https://lphpbndpbbdgoglbgglgeckecbeilpjn.chromiumapp.org/&state=testtesttesttest1234`
   while signed in shows "Connect Hear Me Out for Chrome" with my email and a
   **Connect this Chrome profile** button.
3. `POST /api/public/v1/extension/token` with `{"grant_type":"token_hash","token_hash":"nonsense-value"}`
   returns **401** `{"error":"invalid_grant"}`.
4. `POST /api/public/v1/extension/signout` with no Authorization header returns **401**.
