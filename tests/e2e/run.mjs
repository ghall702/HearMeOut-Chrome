// End-to-end tests in real Chromium with the unpacked e2e build, a fake microphone and local mock
// servers. Run: npm run test:e2e   (on Linux CI: xvfb-run -a npm run test:e2e)
// Env: HMO_E2E_LONG_SECONDS — length of the acceptance recording (default 45; use 300 for 5 minutes).
//      HMO_E2E_ONLY — comma-separated scenario names.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServers } from "./mock-server.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LONG = Number(process.env.HMO_E2E_LONG_SECONDS ?? 45);
const ONLY = process.env.HMO_E2E_ONLY?.split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function launch(extDir, label) {
  const dir = mkdtempSync(path.join(tmpdir(), `hmo-${label}-`));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: false,
    viewport: { width: 1100, height: 760 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent("serviceworker");
  const id = new URL(sw.url()).host;
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:8787" });
  return { ctx, id, base: `chrome-extension://${id}` };
}

/** A fresh, short-lived "popup" (the popup document opened as a tab). Closing it = popup closing. */
async function openPopup(env) {
  const p = await env.ctx.newPage();
  await p.goto(`${env.base}/popup.html`);
  await p.locator(".app").waitFor();
  await p.waitForFunction(() => !document.querySelector(".app .spin") || document.querySelector(".nav, .main"));
  return p;
}

/** Reads the system clipboard from an ordinary web page — i.e. what a user would paste into a site. */
async function readClipboard(env) {
  const page = await env.ctx.newPage();
  await page.goto("http://127.0.0.1:8787/paste-target");
  await page.bringToFront();
  const r = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const get = async (t) => (item.types.includes(t) ? await (await item.getType(t)).text() : null);
    return { types: item.types, html: await get("text/html"), text: await get("text/plain") };
  });
  await page.close();
  return r;
}

const send = (page, msg) => page.evaluate((m) => chrome.runtime.sendMessage({ to: "bg", ...m }), msg);
const recState = (page) => page.evaluate(() => chrome.storage.session.get("rec").then((r) => r.rec));
const badge = (page) => page.evaluate(() => chrome.action.getBadgeText({}));
const offscreenCount = (page) => page.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).then((c) => c.length));

/** Reads a draft's audio straight from IndexedDB and decodes it to measure the real duration. */
const draftAudio = (page, draftId) =>
  page.evaluate(async (id) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("hearmeout");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const chunks = await new Promise((res) => {
      const r = db.transaction("chunks").objectStore("chunks").getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
      r.onsuccess = () => res(r.result.sort((a, b) => a.seq - b.seq));
    });
    const blob = new Blob(chunks.map((c) => c.blob), { type: "audio/webm" });
    let duration = 0;
    try {
      const ac = new AudioContext();
      duration = (await ac.decodeAudioData(await blob.arrayBuffer())).duration;
      await ac.close();
    } catch (e) {
      duration = -1;
    }
    db.close();
    return { bytes: blob.size, chunks: chunks.length, duration };
  }, draftId);

async function stopServiceWorker(env) {
  // Force the MV3 worker to terminate (as Chrome does when idle) via the DevTools protocol, and
  // confirm from Chrome's own worker status events that it really stopped.
  const page = await env.ctx.newPage();
  await page.goto(`${env.base}/permission.html`);
  const cdp = await env.ctx.newCDPSession(page);
  const status = new Map();
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    for (const v of versions) if (v.scriptURL.startsWith(env.base)) status.set(v.versionId, v.runningStatus);
  });
  await cdp.send("ServiceWorker.enable");
  await sleep(300);
  await cdp.send("ServiceWorker.stopAllWorkers");
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && ![...status.values()].every((s) => s === "stopped")) await sleep(100);
  const stopped = status.size > 0 && [...status.values()].every((s) => s === "stopped");
  await cdp.send("ServiceWorker.disable").catch(() => undefined);
  await page.close();
  return stopped;
}

async function minimiseWindow(env, page) {
  const cdp = await env.ctx.newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  return async () => cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
}

async function signIn(env, mock) {
  const p = await openPopup(env);
  const before = mock.state.tokenExchanges;
  await p.getByRole("button", { name: /Sign in with Google/ }).click();
  await p.getByRole("tab", { name: /Record/ }).waitFor({ timeout: 20000 });
  assert(mock.state.tokenExchanges === before + 1, "token exchanged once");
  await p.close();
}

async function clickRecord(p) {
  await p.getByRole("button", { name: "Record a Voice Note" }).click();
  await p.locator(".timer").waitFor({ timeout: 10000 });
}

function timerSeconds(text) {
  const m = /(\d\d):(\d\d)/.exec(text);
  return Number(m[1]) * 60 + Number(m[2]);
}

// ---------------------------------------------------------------------------------------------
const scenarios = {
  async "static security checks"() {
    const dist = path.join(ROOT, "dist");
    const files = [];
    const walk = (d) => readdirSync(d).forEach((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : files.push(path.join(d, f))));
    walk(dist);
    const text = files.filter((f) => /\.(js|html|json)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
    assert(!/HEARMEOUT_GATEWAY_SECRET|MEDIA_GATEWAY_SECRET|SERVICE_ROLE/.test(text), "no backend secret names in the build");
    assert(!/"HMAC"|createHmac/.test(text), "no HMAC signing code in the build");
    assert(!/storage\.sync/.test(text), "chrome.storage.sync is never used");
    const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8"));
    assert(!manifest.content_scripts, "no persistent content scripts");
    assert(!JSON.stringify(manifest).includes("<all_urls>") && !manifest.host_permissions.some((h) => h.includes("*://*")), "no broad host access");
    assert(manifest.host_permissions.length === 2, "only Hear Me Out and the media server");
    assert(!manifest.permissions.includes("tabs") && !manifest.permissions.includes("history"), "no tabs/history permission");
    return `permissions: ${manifest.permissions.join(", ")}; hosts: ${manifest.host_permissions.join(", ")}`;
  },

  async "sign in with Google (launchWebAuthFlow → connect page → token exchange)"(env, mock) {
    await signIn(env, mock);
    const p = await openPopup(env);
    const auth = await send(p, { type: "auth:get" });
    assert(auth.ok && auth.data.signedIn && auth.data.user.email === "ghall702@gmail.com", "signed in as the profile's account");
    const stored = await p.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    assert(!/access_token|refresh_token/.test(stored), "no credentials in chrome.storage.local");
    await p.close();
    return "session stored in extension IndexedDB only";
  },

  async "background recording survives popup close, tab/window switches, minimising and service-worker shutdown"(env, mock) {
    const popup = await openPopup(env);
    await clickRecord(popup);
    const t0 = Date.now();
    assert((await badge(popup)) === "REC", "REC badge while recording");
    await popup.close(); // popup closes (focus moved elsewhere)
    log("recording; popup closed");

    // Navigate and switch between tabs and windows while recording.
    const tab1 = await env.ctx.newPage();
    await tab1.goto("data:text/html,<title>Inbox</title><h1>Pretend Gmail</h1>");
    const tab2 = await env.ctx.newPage();
    await tab2.goto("data:text/html,<title>Doc</title><textarea>typing…</textarea>");
    await tab2.locator("textarea").type(" more typing while recording");
    await tab1.bringToFront();
    const win2 = await tab1.evaluate(() => !!window.open("data:text/html,<title>Second window</title>", "_blank", "popup,width=500,height=400"));
    assert(win2, "opened a second window");
    await sleep(1500);

    // Let the MV3 service worker die.
    const swStopped = await stopServiceWorker(env);
    assert(swStopped, "Chrome reports the extension service worker as stopped");
    log("service worker stopped (confirmed by Chrome)");

    // Minimise the whole browser window (equivalent to switching to Word/Excel).
    const restore = await minimiseWindow(env, tab1);
    log(`minimised; waiting ${LONG}s while "working in another app"`);
    await sleep(LONG * 1000);
    await restore();

    // Reopen the popup: it must reconnect to the same recording with the right elapsed time.
    const p = await openPopup(env);
    const elapsed = (Date.now() - t0) / 1000;
    const shown = timerSeconds(await p.locator(".timer").innerText());
    assert(near(shown, elapsed, 3), `timer ${shown}s ≈ actual ${elapsed.toFixed(1)}s`);
    assert((await badge(p)) === "REC", "REC badge still shown");
    const st1 = await recState(p);
    await p.getByRole("button", { name: /Stop recording/ }).click();
    await p.getByRole("heading", { name: "Review your voice note" }).waitFor();
    const st = await recState(p);
    assert(st.draftId === st1.draftId, "same recording (no second recording created)");
    assert((await badge(p)) === "", "badge removed after stop");
    const audio = await draftAudio(p, st.draftId);
    log("captured audio", audio, "state ms", st.accumulatedMs);
    assert(near(audio.duration, st.accumulatedMs / 1000, 2.5), `decoded audio ${audio.duration.toFixed(1)}s ≈ recorded ${(st.accumulatedMs / 1000).toFixed(1)}s`);
    assert(audio.duration >= LONG, `audio covers the whole ${LONG}s away`);

    // Save → direct upload → finalise.
    const title = await p.locator("input.input").inputValue();
    assert(/^\d{1,2} [A-Z][a-z]+ \d{4}, \d\d:\d\d$/.test(title), `default title "${title}"`);
    const uploadsBefore = mock.state.uploads;
    await p.getByRole("button", { name: /Save voice note/ }).click();
    await p.getByText("Saved to Hear Me Out").waitFor({ timeout: 30000 });
    assert(mock.state.uploads === uploadsBefore + 1, "exactly one upload authorisation");
    const put = mock.state.puts.at(-1);
    assert(put.size === audio.bytes && put.contentLength === audio.bytes, `media server received all ${audio.bytes} original bytes`);
    const fin = mock.state.finalizes.filter((f) => f.id === [...mock.state.recordings.keys()].at(-1));
    assert(fin[0]?.title === title && fin[0]?.transcribe === false, "finalised with the title, share links not blocked on transcription");
    await sleep(800);
    assert(mock.state.finalizes.some((f) => f.transcribe === true), "transcription handed to Hear Me Out's pipeline");
    const drafts = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("hearmeout"); r.onsuccess = () => { const q = r.result.transaction("chunks").objectStore("chunks").count(); q.onsuccess = () => res(q.result); }; }));
    assert(drafts === 0, "local audio removed after a successful save");
    assert((await offscreenCount(p)) === 0, "offscreen document (and microphone) released");

    // Sharing: recommended (unknown site → link) + Gmail card with html+plain text.
    await p.locator(".share-grid .btn", { hasText: "Gmail card" }).click();
    await p.getByText("Copied to clipboard").first().waitFor();
    const clip = await readClipboard(env);
    assert(clip.types.includes("text/html") && clip.types.includes("text/plain"), "Gmail card has text/html and text/plain");
    assert(clip.html.includes("/api/public/card/") && clip.text.startsWith("Hey, I've recorded you a voice memo. Click here to listen: http"), "card + fallback content");
    await p.bringToFront();
    await p.locator(".share-grid .btn", { hasText: "HTML embed" }).click();
    const embed = (await readClipboard(env)).text;
    assert(embed.startsWith("<iframe src=") && embed.includes("/embed/"), "embed copied verbatim");
    await p.close();
    return `recorded ${audio.duration.toFixed(1)}s (popup closed, SW stopped, window minimised for ${LONG}s); uploaded ${audio.bytes} bytes`;
  },

  async "only one recording at a time"(env) {
    const p = await openPopup(env);
    const [a, b] = await Promise.all([send(p, { type: "rec:start" }), send(p, { type: "rec:start" })]);
    const oks = [a, b].filter((r) => r.ok).length;
    const other = [a, b].find((r) => !r.ok);
    assert(oks === 1 && other.code === "already-recording", `one start succeeded, other refused (${other?.code})`);
    const c = await send(p, { type: "rec:start" });
    assert(!c.ok && c.code === "already-recording", "starting again is refused");
    assert((await offscreenCount(p)) === 1, "single recording engine");
    await send(p, { type: "rec:discard" });
    assert((await recState(p)).phase === "idle", "discarded");
    await p.close();
    return "parallel starts → 1 recording";
  },

  async "pause and resume"(env) {
    const p = await openPopup(env);
    await clickRecord(p);
    await sleep(3000);
    await p.getByRole("button", { name: "Pause" }).click();
    await p.getByRole("button", { name: "Resume" }).waitFor();
    assert((await badge(p)) === "II", "paused badge");
    await sleep(4000);
    await p.getByRole("button", { name: "Resume" }).click();
    await sleep(3000);
    await p.getByRole("button", { name: /Stop recording/ }).click();
    await p.getByRole("heading", { name: "Review your voice note" }).waitFor();
    const st = await recState(p);
    const audio = await draftAudio(p, st.draftId);
    assert(near(st.accumulatedMs / 1000, 6, 1), `paused time excluded (${st.accumulatedMs}ms)`);
    assert(near(audio.duration, 6, 1.5), `audio ≈ 6s (${audio.duration.toFixed(1)}s)`);
    await send(p, { type: "rec:discard" });
    await p.close();
    return `6s of audio from 10s wall-clock`;
  },

  async "recovers audio after the recording engine is killed"(env, mock) {
    const p = await openPopup(env);
    await clickRecord(p);
    await p.close();
    await sleep(6500);
    // Simulate a crash of the recorder process.
    const [sw] = env.ctx.serviceWorkers().length ? env.ctx.serviceWorkers() : [await env.ctx.waitForEvent("serviceworker", { timeout: 5000 }).catch(() => null)];
    const killer = await env.ctx.newPage();
    await killer.goto(`${env.base}/permission.html`);
    await killer.evaluate(() => chrome.offscreen.closeDocument());
    await killer.close();
    void sw;
    const q = await openPopup(env);
    await q.getByRole("heading", { name: "Review your voice note" }).waitFor({ timeout: 10000 });
    const st = await recState(q);
    assert(st.recovered && st.stopReason === "interrupted", "marked as recovered");
    assert((await badge(q)) === "", "no misleading REC badge");
    const audio = await draftAudio(q, st.draftId);
    assert(audio.duration > 4, `recovered ${audio.duration.toFixed(1)}s of audio`);
    await q.getByText(/was interrupted/).waitFor();
    // It can still be saved.
    await q.getByRole("button", { name: /Save voice note/ }).click();
    await q.getByText("Saved to Hear Me Out").waitFor({ timeout: 30000 });
    await send(q, { type: "rec:new" });
    await q.close();
    return `recovered and saved ${audio.duration.toFixed(1)}s`;
  },

  async "failed upload keeps audio, Retry resumes without duplicates"(env, mock) {
    const p = await openPopup(env);
    await clickRecord(p);
    await sleep(3000);
    await p.getByRole("button", { name: /Stop recording/ }).click();
    await p.getByRole("button", { name: /Save voice note/ }).waitFor();
    mock.state.failNextPut = 1;
    const uploads = mock.state.uploads;
    await p.getByRole("button", { name: /Save voice note/ }).click();
    await p.getByRole("heading", { name: "Upload needs attention" }).waitFor({ timeout: 15000 });
    await p.getByText(/Upload failed \(500/).waitFor();
    const st = await recState(p);
    assert((await draftAudio(p, st.draftId)).bytes > 0, "audio kept after failure");
    await p.getByRole("button", { name: /Retry upload/ }).click();
    await p.getByText("Saved to Hear Me Out").waitFor({ timeout: 20000 });
    assert(mock.state.uploads === uploads + 1, "no duplicate recording created on retry");
    await send(p, { type: "rec:new" });
    await p.close();
    return "1 authorisation, 2 PUT attempts, 1 recording";
  },

  async "library lists this account's recordings with search and sharing"(env, mock) {
    const p = await openPopup(env);
    await p.getByRole("tab", { name: /Library/ }).click();
    await p.locator(".item").first().waitFor({ timeout: 10000 });
    const n = await p.locator(".item").count();
    assert(n === mock.state.recordings.size, `${n} items listed`);
    await p.getByPlaceholder("Search recordings").fill("zzz-no-match");
    await p.getByText("No recordings match your search.").waitFor();
    await p.getByPlaceholder("Search recordings").fill("");
    await p.locator(".item .head").first().click();
    await p.getByRole("button", { name: /View transcript/ }).click();
    await p.getByText("Hello from the mock transcript.").waitFor();
    await p.locator(".item .share-grid .btn", { hasText: "Share link" }).click();
    const link = (await readClipboard(env)).text;
    assert(/^http:\/\/127\.0\.0\.1:8787\/s\/[a-f0-9]{32}$/.test(link), `share link copied (${link})`);
    await p.close();
    return `${n} recordings`;
  },

  async "sign-out revokes the session and wipes this profile data"(env, mock) {
    const p = await openPopup(env);
    await p.getByRole("tab", { name: /Settings/ }).click();
    await p.getByRole("button", { name: /^Sign out$/ }).click();
    await p.getByRole("button", { name: /Sign out and remove local data/ }).click();
    await p.getByRole("button", { name: /Sign in with Google/ }).waitFor();
    assert(mock.state.signouts >= 1, "server-side session revoked");
    const local = await p.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
    assert(!/lastResult|libraryCache|lastUser/.test(local), "cached account data removed");
    const auth = await send(p, { type: "auth:get" });
    assert(!auth.data.signedIn, "signed out");
    await p.close();
    return "credentials, cache and last share removed";
  },
};

/** The optional "Insert into Gmail" function, run against Gmail-style compose markup. */
async function gmailInsertionSafety(env) {
  const ts = createRequire(import.meta.url)("typescript");
  const src = ts.transpileModule(readFileSync(path.join(ROOT, "src/popup/insert.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fn = /export function insertIntoGmailCompose[\s\S]*?\n}\n/.exec(src)[0].replace("export ", "");
  const p = await env.ctx.newPage();
  const ed = (n) => Array.from({ length: n }, (_, i) => `<div id="e${i}" contenteditable="true" g_editable="true" role="textbox" style="width:300px;height:60px">Hello team, see below.</div>`).join("");
  const run = () => p.evaluate((f) => (0, eval)(`(${f})`)('<a href="https://x/s/abc"><img src="https://x/api/public/card/abc"></a>'), fn);
  await p.setContent("<div>inbox</div>");
  assert((await run()) === "no-editor", "does nothing without a compose window");
  await p.setContent(ed(1));
  await p.evaluate(() => { const e = document.getElementById("e0"); e.focus(); const r = document.createRange(); r.selectNodeContents(e); getSelection().removeAllRanges(); getSelection().addRange(r); });
  assert((await run()) === "inserted", "inserts into the compose body");
  const t = await p.evaluate(() => document.getElementById("e0").innerHTML);
  assert(t.includes("Hello team, see below.") && t.includes("card/abc"), "existing (even selected) text is never replaced");
  await p.setContent(`<button id="x">x</button>${ed(2)}`);
  await p.focus("#x");
  assert((await run()) === "ambiguous", "refuses when it can't tell which email you mean");
  await p.focus("#e1");
  assert((await run()) === "inserted", "uses the focused compose window");
  const changed = await p.evaluate(() => [0, 1].map((i) => document.getElementById(`e${i}`).innerHTML.includes("card/abc")));
  assert(!changed[0] && changed[1], "unrelated editors untouched");
  await p.close();
  return "no editor → no-op; selection preserved; ambiguous → refused; only the focused editor changes";
}

async function profileIsolation(extDir, mock) {
  const a = await launch(extDir, "profile-a");
  const b = await launch(extDir, "profile-b");
  try {
    await signIn(a, mock);
    const pa = await openPopup(a);
    const pb = await openPopup(b);
    await clickRecord(pa);
    const authB = await send(pb, { type: "auth:get" });
    const stB = await recState(pb);
    assert(!authB.data.signedIn, "profile B is not signed in by profile A's sign-in");
    assert(!stB || stB.phase === "idle", "profile B sees no recording");
    assert((await badge(pb)) === "", "profile B has no REC badge");
    await send(pa, { type: "rec:discard" });
    return "two profiles open at once: independent sessions, state and badges";
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
}

async function limitScenario(mock) {
  log("building e2e variant with a 12-second limit");
  execSync("npx vite build --mode e2e --outDir ../dist-e2e-limit", { cwd: ROOT, env: { ...process.env, HMO_E2E_MAX_SECONDS: "12" }, stdio: "ignore" });
  const env = await launch(path.join(ROOT, "dist-e2e-limit"), "limit");
  try {
    await signIn(env, mock);
    const p = await openPopup(env);
    await clickRecord(p);
    await p.close(); // the limit must work with the popup closed
    assert(await stopServiceWorker(env), "service worker stopped");
    await sleep(17000);
    const q = await openPopup(env);
    const st = await recState(q);
    assert(st.phase === "stopped" && st.stopReason === "limit", `stopped by limit (phase ${st.phase}, reason ${st.stopReason})`);
    assert((await badge(q)) === "", "badge cleared");
    const audio = await draftAudio(q, st.draftId);
    assert(near(audio.duration, 12, 1.5), `audio ≈ limit (${audio.duration.toFixed(1)}s)`);
    await q.getByText(/limit was reached/).waitFor();
    return `stopped automatically at ${(st.accumulatedMs / 1000).toFixed(1)}s with popup closed; ${audio.duration.toFixed(1)}s preserved`;
  } finally {
    await env.ctx.close();
  }
}

/** Isolation: leave no recording/draft behind from a previous scenario. */
async function resetState(env) {
  const p = await env.ctx.newPage();
  await p.goto(`${env.base}/permission.html`);
  const st = await recState(p);
  if (st && st.phase === "completed") await send(p, { type: "rec:new" });
  else if (st && st.phase !== "idle") await send(p, { type: "rec:discard" });
  await p.close();
}

// ---------------------------------------------------------------------------------------------
const mock = await startMockServers();
const extDir = path.join(ROOT, "dist-e2e");
execSync("npx vite build", { cwd: ROOT, stdio: "ignore" }); // production build for static checks
let env;
try {
  env = await launch(extDir, "main");
  const all = [...Object.entries(scenarios), ["Insert into Gmail is safe", () => gmailInsertionSafety(env)], ["two Chrome profiles stay independent", () => profileIsolation(extDir, mock)], ["15-minute limit (shortened build) with popup closed", () => limitScenario(mock)]];
  for (const [name, fn] of all) {
    if (ONLY && !ONLY.some((o) => name.includes(o))) continue;
    const t = Date.now();
    try {
      if (env) await resetState(env);
      const detail = await fn(env, mock);
      results.push({ name, ok: true, detail, s: ((Date.now() - t) / 1000).toFixed(1) });
      log("PASS", name, "—", detail ?? "");
    } catch (e) {
      results.push({ name, ok: false, detail: e.message, s: ((Date.now() - t) / 1000).toFixed(1) });
      log("FAIL", name, "—", e.message);
    }
  }
} finally {
  await env?.ctx.close();
  await mock.close();
}
const out = path.join(ROOT, "tests/e2e/last-run.json");
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), chromium: chromium.name(), longSeconds: LONG, results }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
