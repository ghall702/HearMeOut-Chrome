// Local stand-ins for the Hear Me Out API (8787) and the media gateway (8788), implementing the
// documented request/response shapes. Used only by the e2e build (vite --mode e2e).
import http from "node:http";
import { randomUUID } from "node:crypto";

export function startMockServers() {
  const state = {
    uploads: 0,
    puts: [],
    finalizes: [],
    recordings: new Map(),
    files: new Map(),
    failNextPut: 0,
    signouts: 0,
    tokenExchanges: 0,
    refreshes: 0,
    requests: [],
  };
  const user = { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", email: "ghall702@gmail.com", name: "George Hall", avatar_url: null };
  const keys = new Set();
  const revoked = new Set();
  const newKey = () => {
    const k = "hmo_" + (randomUUID() + randomUUID()).replace(/-/g, "").slice(0, 48);
    keys.add(k);
    return k;
  };
  state.keys = keys;
  state.revoked = revoked;
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  const body = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });
  const authed = (req) => {
    const k = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    return keys.has(k) && !revoked.has(k);
  };
  // SHARE_ORIGIN lets the screenshot script show realistic links; tests use the local server.
  const so = process.env.SHARE_ORIGIN ?? "http://127.0.0.1:8787";
  const share = (token) => ({
    shareUrl: `${so}/s/${token}`,
    embedUrl: `${so}/embed/${token}`,
    embedCode: `<iframe src="${so}/embed/${token}" width="100%" height="152" frameborder="0" allow="autoplay" style="border-radius:16px;max-width:560px" title="Hear Me Out voice note"></iframe>`,
  });

  const api = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:8787");
    // Record path only — never query strings (mirrors the real gateway's logging policy).
    state.requests.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/extension/connect") {
      // Simulates the signed-in user pressing "Connect this Chrome profile".
      const redirect = url.searchParams.get("redirect_uri");
      const st = url.searchParams.get("state");
      if (!/^https:\/\/[a-p]{32}\.chromiumapp\.org\/$/.test(redirect ?? "")) return json(res, 400, { error: "bad redirect" });
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><title>Connect</title><p>Connecting…</p><script>setTimeout(()=>location.replace(${JSON.stringify(redirect)}+"#token_hash=grant123&state="+${JSON.stringify(st)}),300)</script>`);
    }
    if (url.pathname === "/api/public/v1/extension/token" && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      if (b.grant_type === "token_hash" && b.token_hash === "grant123") {
        state.tokenExchanges++;
        return json(res, 200, { api_key: newKey(), user });
      }
      return json(res, 401, { error: "invalid_grant" });
    }
    if (url.pathname === "/api/public/v1/extension/signout") {
      const k = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!keys.has(k)) return json(res, 401, { error: "unauthorised" });
      revoked.add(k);
      state.signouts++;
      return json(res, 200, { ok: true });
    }
    if (!url.pathname.startsWith("/api/public/v1/")) return json(res, 404, { error: "not_found" });
    if (!authed(req)) return json(res, 401, { error: "unauthorised" });
    if (url.pathname === "/api/public/v1/uploads" && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString());
      state.uploads++;
      const id = randomUUID();
      const key = `users/${user.id}/${id}.${b.ext}`;
      const token = randomUUID().replace(/-/g, "");
      state.recordings.set(id, { id, key, title: b.title ?? "Untitled recording", status: "pending", transcription_status: "queued", duration_seconds: b.durationSeconds, size_bytes: b.size, share_token: token, created_at: new Date().toISOString(), play_count: 0, first_played_at: null, req: b });
      return json(res, 201, {
        recordingId: id,
        storageKey: key,
        uploadUrl: `http://127.0.0.1:8788/hmo/upload?key=${encodeURIComponent(key)}`,
        method: "PUT",
        headers: { Authorization: `Bearer st-${id}` },
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
    }
    let m = /^\/api\/public\/v1\/recordings\/([^/]+)\/upload-url$/.exec(url.pathname);
    if (m && req.method === "POST") {
      const r = state.recordings.get(m[1]);
      if (!r) return json(res, 404, { error: "not_found" });
      if (r.status === "ready") return json(res, 409, { error: "already_finalised" });
      return json(res, 200, { recordingId: r.id, key: r.key, uploadUrl: `http://127.0.0.1:8788/hmo/upload?key=${encodeURIComponent(r.key)}`, method: "PUT", headers: { Authorization: `Bearer st-${r.id}` }, exp: Math.floor(Date.now() / 1000) + 3600 });
    }
    m = /^\/api\/public\/v1\/recordings\/([^/]+)\/finalize$/.exec(url.pathname);
    if (m && req.method === "POST") {
      const r = state.recordings.get(m[1]);
      if (!r) return json(res, 400, { error: "Recording not found" });
      if (!state.files.has(r.key)) return json(res, 400, { error: "The storage server did not confirm the file" });
      const b = JSON.parse((await body(req)).toString() || "{}");
      state.finalizes.push({ id: r.id, ...b });
      r.status = "ready";
      if (b.title) r.title = b.title;
      if (b.transcribe) r.transcription_status = "done";
      return json(res, 200, { id: r.id, title: r.title, transcription_status: r.transcription_status, ...share(r.share_token) });
    }
    if (url.pathname === "/api/public/v1/recordings" && req.method === "GET") {
      const items = [...state.recordings.values()].reverse().map(({ share_token, key: _k, req: _r, ...r }) => ({ ...r, share_enabled: true, ...share(share_token) }));
      return json(res, 200, { items });
    }
    m = /^\/api\/public\/v1\/recordings\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const r = state.recordings.get(m[1]);
      if (!r) return json(res, 404, { error: "not_found" });
      const { share_token, key: _k, req: _r, ...rest } = r;
      return json(res, 200, { ...rest, transcript: "Hello from the mock transcript.", ...share(share_token) });
    }
    json(res, 404, { error: "not_found" });
  });

  const media = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:8788");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "PUT", "access-control-allow-headers": "authorization,content-type" });
      return res.end();
    }
    if (url.pathname === "/hmo/upload" && req.method === "PUT") {
      const key = url.searchParams.get("key");
      const bytes = await body(req);
      const id = key.split("/").pop().split(".")[0];
      if (req.headers.authorization !== `Bearer st-${id}`) return json(res, 403, { error: "invalid_or_expired_token" });
      if (state.failNextPut > 0) {
        state.failNextPut--;
        return json(res, 500, { error: "internal" });
      }
      state.puts.push({ key, size: bytes.length, contentLength: Number(req.headers["content-length"]) });
      state.files.set(key, bytes);
      return json(res, 201, { ok: true, key, size: bytes.length });
    }
    json(res, 404, { error: "not_found" });
  });

  return Promise.all([new Promise((r) => api.listen(8787, "127.0.0.1", r)), new Promise((r) => media.listen(8788, "127.0.0.1", r))]).then(() => ({
    state,
    close: () => Promise.all([new Promise((r) => api.close(r)), new Promise((r) => media.close(r))]),
  }));
}
