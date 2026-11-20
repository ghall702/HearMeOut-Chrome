// Two packages:
//   npm run package           → release/hearmeout-chrome-<version>.zip for a possible Chrome Web Store
//                               upload (no manifest `key`; the store assigns its own ID). Nothing is
//                               uploaded or published — that stays a manual decision.
//   npm run package:download  → download/HearMeOut-for-Chrome.zip, the ready-to-install build for
//                               "Load unpacked" (keeps the `key`, so the ID matches HMO_EXTENSION_IDS).
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const forDownload = process.argv.includes("--download");
execSync("npx vite build", { cwd: root, stdio: "inherit", env: { ...process.env, HMO_NO_KEY: forDownload ? "" : "1" } });
const dist = path.join(root, "dist");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d).sort()) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dist);

// Minimal ZIP writer (deflate), so packaging needs no extra dependency.
const prefix = forDownload ? "HearMeOut-for-Chrome/" : "";
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
const local = [];
const central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(prefix + path.relative(dist, file).split(path.sep).join("/"));
  const data = readFileSync(file);
  const comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
  h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  local.push(h, name, comp);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += 30 + name.length + comp.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
const outDir = path.join(root, forDownload ? "download" : "release");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, forDownload ? "HearMeOut-for-Chrome.zip" : `hearmeout-chrome-${version}.zip`);
writeFileSync(out, Buffer.concat([...local, cd, end]));
console.log(`Packaged ${files.length} files → ${path.relative(root, out)}`);
if (!forDownload) execSync("npx vite build", { cwd: root, stdio: "ignore" }); // restore the keyed dist/
