// Regenerates docs/screenshots/*.png from the real extension UI (e2e build + mock servers).
// Run on Linux with: xvfb-run -a node scripts/screenshots.mjs   (after `npm run build:e2e`)
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SHARE_ORIGIN ??= "https://hearmeout.george-hall.uk";
const { chromium } = createRequire(import.meta.url)("playwright");
const { startMockServers } = await import("../tests/e2e/mock-server.mjs");
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "docs/screenshots");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = await startMockServers();
const ext = path.join(ROOT, "dist-e2e");
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "hmo-shots-")), {
  headless: false,
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent("serviceworker");
const base = `chrome-extension://${new URL(sw.url()).host}`;

/** Opens the popup UI. `site` pretends the active tab is that address (only for these pictures). */
async function popup({ dark = false, site } = {}) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 380, height: 600 });
  await p.emulateMedia({ colorScheme: dark ? "dark" : "light" });
  if (site)
    await p.addInitScript((url) => {
      const q = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (info) => (info?.active ? Promise.resolve([{ id: 1, url, active: true }]) : q(info));
    }, site);
  await p.goto(`${base}/popup.html`);
  await sleep(600);
  return p;
}
const shot = async (p, name) => {
  await sleep(450);
  await p.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("✓", name);
};
const record = async (p, seconds) => {
  await p.getByRole("button", { name: "Record a Voice Note" }).click();
  await sleep(seconds * 1000);
};
const stopAndSave = async (p, title) => {
  await p.getByRole("button", { name: /Stop recording/ }).click();
  await p.getByRole("heading", { name: /Review/ }).waitFor();
  if (title) await p.locator("input.input").fill(title);
};

// 1. Sign in
let p = await popup();
await shot(p, "01-sign-in");
await p.getByRole("button", { name: /Sign in with Google/ }).click();
await p.getByRole("tab", { name: /Record/ }).waitFor();
await p.close();

// 2–6. Gmail: record → review → share
p = await popup({ site: "https://mail.google.com/mail/u/0/#inbox?compose=new" });
await shot(p, "02-ready-gmail");
await record(p, 7);
await shot(p, "03-recording");
await p.getByRole("button", { name: "Pause" }).click();
await shot(p, "04-paused");
await p.getByRole("button", { name: "Resume" }).click();
await sleep(2000);
await stopAndSave(p, "Feedback on Year 11 mock paper");
await shot(p, "05-review");
await p.getByRole("button", { name: /Save voice note/ }).click();
await p.getByText("Saved to Hear Me Out").waitFor();
await sleep(900);
await shot(p, "06-share-gmail");
await p.getByRole("button", { name: /Copy for Gmail/ }).click();
await shot(p, "07-copied");
await p.close();

// 8. Moodle
p = await popup({ site: "https://lms.georgehalltuition.com/course/view.php?id=12" });
await p.getByRole("button", { name: /Record another/ }).click();
await record(p, 4);
await stopAndSave(p, "Homework walkthrough — Unit 4");
await p.getByRole("button", { name: /Save voice note/ }).click();
await p.getByText("Saved to Hear Me Out").waitFor();
await sleep(900);
await shot(p, "08-share-moodle");
await p.getByRole("button", { name: /Record another/ }).click();
await p.close();

// 9–11. Library, Settings
p = await popup({ site: "https://mail.google.com/" });
await p.getByRole("tab", { name: /Library/ }).click();
await p.locator(".item").first().waitFor();
await p.locator(".item .head").first().click();
await shot(p, "09-library");
await p.getByRole("tab", { name: /Settings/ }).click();
await shot(p, "10-settings");
await p.locator(".main > div").evaluate((el) => el.scrollTo(0, 520));
await shot(p, "11-settings-websites");
await p.close();

// 12–13. Dark mode
p = await popup({ dark: true, site: "https://mail.google.com/" });
await shot(p, "12-dark-ready");
await record(p, 5);
await shot(p, "13-dark-recording");
await p.getByRole("button", { name: /Stop recording/ }).click();
await p.getByRole("button", { name: /Discard/ }).click();
await p.getByRole("button", { name: /^Delete$/ }).click();
await p.close();

// 14. Microphone permission page
p = await ctx.newPage();
await p.setViewportSize({ width: 720, height: 520 });
await p.goto(`${base}/permission.html`);
await sleep(600);
await shot(p, "14-microphone-permission");
await p.close();

// 15–16. Chrome's own pages used during installation (Developer mode on, as you'll have it).
p = await ctx.newPage();
await p.setViewportSize({ width: 1100, height: 560 });
await p.goto("chrome://extensions");
await sleep(1200);
await p.locator("#devMode").click(); // pierces Chrome's shadow DOM
await sleep(800);
// This test machine's Chromium is policy-managed; hide that notice — it isn't part of normal Chrome.
await p.evaluate(() => {
  const walk = (root) => {
    root.querySelectorAll("*").forEach((el) => {
      if (/managed by your organi/i.test(el.textContent ?? "") && el.children.length < 4 && el.id !== "devMode") el.style.visibility = "hidden";
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  };
  walk(document);
});
await shot(p, "15-chrome-extensions-page");
await p.goto("chrome://extensions/shortcuts");
await sleep(1200);
await shot(p, "16-chrome-shortcuts-page");

await ctx.close();
await mock.close();
