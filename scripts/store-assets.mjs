// Renders Chrome Web Store images from docs/screenshots: 1280×800 screenshots and the 440×280 tile.
// Run after `npm run screenshots`:  node scripts/store-assets.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(import.meta.dirname, "..");
const shots = path.join(ROOT, "docs/screenshots");
const OUT = path.join(ROOT, "store/assets");
const img = (n) => `data:image/png;base64,${readFileSync(path.join(shots, `${n}.png`)).toString("base64")}`;
const icon = `data:image/png;base64,${readFileSync(path.join(ROOT, "public/icons/icon-128.png")).toString("base64")}`;
const font = (w) => `data:font/woff2;base64,${readFileSync(path.join(ROOT, `node_modules/@fontsource/manrope/files/manrope-latin-${w}-normal.woff2`)).toString("base64")}`;

const css = `
@font-face{font-family:M;font-weight:500;src:url(${font(500)})}
@font-face{font-family:M;font-weight:700;src:url(${font(700)})}
*{box-sizing:border-box;margin:0}
body{font-family:M,sans-serif;background:#f8f7f3;color:#2a2a2e}
.bg{position:absolute;inset:0;background:radial-gradient(90% 70% at 75% 10%,#dfe9e0 0,transparent 60%),radial-gradient(60% 60% at 0% 100%,#e8efe8 0,transparent 60%)}
.dark{background:#1d1d21;color:#f3efe9}.dark .bg{background:radial-gradient(90% 70% at 75% 10%,#2f3b33 0,transparent 60%)}
h1{font-weight:700;letter-spacing:-.035em;line-height:1.05}
.accent{color:#6f8f77}.dark .accent{color:#9dbba4}
.brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:26px;letter-spacing:-.02em}
.brand img{width:52px;height:52px}
.shot{border-radius:22px;box-shadow:0 30px 80px -30px rgba(40,50,40,.45),0 0 0 1px rgba(0,0,0,.06)}
`;

const slides = [
  { name: "store-1-record", shot: "03-recording", title: "Record from any tab.", sub: "Recording keeps going while you switch tabs, windows or apps — up to 15 minutes." },
  { name: "store-2-gmail", shot: "06-share-gmail", title: "Right format,<br><span class=accent>right site.</span>", sub: "In Gmail it offers a clickable voice-note card — or drops it straight into your email." },
  { name: "store-3-moodle", shot: "08-share-moodle", title: "Moodle-ready embeds.", sub: "On Moodle it recommends the HTML player, ready to paste into the editor." },
  { name: "store-4-library", shot: "09-library", title: "Every note, one click away.", sub: "See plays and transcripts, search, and copy any format again." },
  { name: "store-5-dark", shot: "13-dark-recording", title: "Light, dark or system.", sub: "Sign in once per Chrome profile with Google and stay signed in.", dark: true },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const s of slides) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<html><style>${css}</style><body class="${s.dark ? "dark" : ""}" style="width:1280px;height:800px;position:relative;overflow:hidden">
    <div class=bg></div>
    <div style="position:absolute;left:90px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center;gap:28px">
      <div class=brand><img src="${icon}">Hear Me Out</div>
      <h1 style="font-size:64px">${s.title}</h1>
      <p style="font-size:26px;line-height:1.45;opacity:.75;font-weight:500">${s.sub}</p>
    </div>
    <img class=shot src="${img(s.shot)}" style="position:absolute;right:110px;top:50%;transform:translateY(-50%);width:420px">
  </body></html>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
  console.log("✓", s.name);
}
await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(`<html><style>${css}</style><body style="width:440px;height:280px;position:relative;overflow:hidden">
  <div class=bg></div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 34px;gap:14px">
    <div class=brand style="font-size:22px"><img src="${icon}" style="width:44px;height:44px">Hear Me Out</div>
    <h1 style="font-size:34px">Say it once.<br><span class=accent>Share it anywhere.</span></h1>
  </div></body></html>`);
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(OUT, "small-promo-tile-440x280.png") });
console.log("✓ small promo tile");
await browser.close();
