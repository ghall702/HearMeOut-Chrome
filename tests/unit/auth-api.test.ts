import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeStub } from "./chrome-stub";

installChromeStub();
const { parseCallback, getAccessToken, signOut } = await import("../../src/background/auth");
const { hmoApi, ApiError } = await import("../../src/background/api");
const { setAuthSession, getAuthSession } = await import("../../src/shared/db");

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

describe("API client", () => {
  beforeEach(async () => {
    await setAuthSession({ access_token: "old.access.token", refresh_token: "r1", expires_at: Math.floor(Date.now() / 1000) + 3600, user });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("treats 201 Created from /uploads as success", async () => {
    const fetchMock = vi.fn(async () =>
      json({ recordingId: "rec1", storageKey: "users/u1/x.webm", uploadUrl: "https://media/hmo/upload?key=x", method: "PUT", headers: { Authorization: "Bearer st" }, exp: 9 }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await hmoApi.createUpload({ ext: "webm", size: 10, filename: "a.webm", mime: "audio/webm", durationSeconds: 1, title: "t" });
    expect(r.recordingId).toBe("rec1");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer old.access.token");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/extension/token")) return json({ access_token: "new.access.token", refresh_token: "r2", expires_at: Math.floor(Date.now() / 1000) + 3600, user });
        const auth = (init.headers as Record<string, string>)["Authorization"]!;
        seen.push(auth);
        return auth === "Bearer new.access.token" ? json({ items: [] }) : json({ error: "unauthorised" }, 401);
      }),
    );
    await expect(hmoApi.list()).resolves.toEqual({ items: [] });
    expect(seen).toEqual(["Bearer old.access.token", "Bearer new.access.token"]);
    expect((await getAuthSession())?.refresh_token).toBe("r2");
  });

  it("an invalid refresh token signs the profile out cleanly", async () => {
    await setAuthSession({ access_token: "x.y.z", refresh_token: "dead", expires_at: 0, user });
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_grant" }, 401)));
    await expect(getAccessToken()).rejects.toThrow(/expired/);
    expect(await getAuthSession()).toBeNull();
  });

  it("surfaces API errors with friendly messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "not_found" }, 404)));
    await expect(hmoApi.get("nope")).rejects.toBeInstanceOf(ApiError);
  });

  it("sign-out revokes server-side and deletes local credentials", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await signOut();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/public\/v1\/extension\/signout$/), expect.anything());
    expect(await getAuthSession()).toBeNull();
  });
});
