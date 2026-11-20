// Renders the Hear Me Out mark (sage gradient tile + soundwave bars, as in the web app's Logo) to PNGs.
import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
// Uses the globally installed Playwright (or a local one).
const { chromium } = createRequire(import.meta.url)("playwright");

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#94b29b"/><stop offset="1" stop-color="#7a9a82"/></linearGradient></defs>
  <rect x="4" y="4" width="120" height="120" rx="34" fill="url(#g)"/>
  <g transform="translate(64 64) scale(3.6) translate(-12 -12)" fill="none" stroke="#fcfbf8" stroke-width="2.5" stroke-linecap="round">
    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>
  </g></svg>`;

mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size)}</body></html>`);
  writeFileSync(`public/icons/icon-${size}.png`, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
writeFileSync("public/icons/icon.svg", svg(128));
await browser.close();
console.log("icons written");
