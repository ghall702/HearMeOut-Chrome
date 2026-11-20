import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeStub } from "./chrome-stub";

installChromeStub();
const { parseCallback, authSummary, signOut } = await import("../../src/background/auth");
const { hmoApi, ApiError } = await import("../../src/background/api");
const { setAuthSession, getAuthSession } = await import("../../src/shared/db");

const KEY = "hmo_" + "ab".repeat(24);
const user = { id: "u1", email: "ghall702@gmail.com", name: "George", avatar_url: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("sign-in callback", () => {
  const cb = (frag: string) => `https://lphpbndpbbdgoglbgglgeckecbeilpjn.chromiumapp.org/#${frag}`;
  it("returns the grant when state matches", () => {
    expect(parseCallback(cb("token_hash=abc123&state=s1"), "s1")).toEqual({ tokenHash: "abc123" });
  });
  it("rejects a mismatched state", () => {
    expect(() => parseCallback(cb("token_hash=abc&state=evil"), "s1")).toThrow(/security check/);
  });
  it("reports cancellation", () => {
    expect(() => parseCallback(cb("error=access_denied&state=s1"), "s1")).toThrow(/cancelled/);
  });
});

describe("staying signed in", () => {
  beforeEach(async () => {
    await setAuthSession({ api_key: KEY, user, created_at: Date.now() - 400 * 24 * 3600 * 1000 }); // over a year old
    await chrome.storage.local.remove("authRejected");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the stored key however old it is — nothing expires or refreshes", async () => {
    const fetchMock = vi.fn(async () => json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await hmoApi.list();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/public\/v1\/recordings$/);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${KEY}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("network failures and server errors never sign you out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(hmoApi.list()).rejects.toThrow(/Couldn't reach/);
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "internal" }, 503)));
    await expect(hmoApi.list()).rejects.toBeInstanceOf(ApiError);
    expect((await getAuthSession())?.api_key).toBe(KEY);
    expect(await authSummary()).toMatchObject({ signedIn: true, expired: false });
  });

  it("a single 401 blip is retried and doesn't disconnect", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? json({ error: "unauthorised" }, 401) : json({ items: [] }))));
    await expect(hmoApi.list()).resolves.toEqual({ items: [] });
    expect(await authSummary()).toMatchObject({ signedIn: true, expired: false });
  });

  it("a revoked key keeps you signed in but offers Reconnect", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "unauthorised" }, 401)));
    await expect(hmoApi.list()).rejects.toThrow(/reconnect/i);
    expect(await authSummary()).toMatchObject({ signedIn: true, expired: true });
    expect((await getAuthSession())?.api_key).toBe(KEY);
    // …and the flag clears on the next successful call.
    vi.stubGlobal("fetch", vi.fn(async () => json({ items: [] })));
    await hmoApi.list();
    await new Promise((r) => setTimeout(r, 0));
    expect((await authSummary()).expired).toBe(false);
  });

  it("treats 201 Created from /uploads as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ recordingId: "rec1", uploadUrl: "https://media/hmo/upload?key=x", method: "PUT", headers: { Authorization: "Bearer st" }, exp: 9 }, 201)));
    const r = await hmoApi.createUpload({ ext: "webm", size: 10, filename: "a.webm", mime: "audio/webm", durationSeconds: 1, title: "t" });
    expect(r.recordingId).toBe("rec1");
  });

  it("sign-out revokes the key server-side and deletes it locally", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await signOut();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/public\/v1\/extension\/signout$/);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${KEY}`);
    expect(await getAuthSession()).toBeNull();
    expect((await authSummary()).signedIn).toBe(false);
  });
});
