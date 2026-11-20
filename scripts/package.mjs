// Builds release/hearmeout-chrome-<version>.zip for a possible Chrome Web Store upload.
// The store assigns its own extension ID, so this build omits the manifest `key`.
// Nothing is uploaded or published — that stays a manual decision.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync, crc32 } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
execSync("npx vite build", { cwd: root, stdio: "inherit", env: { ...process.env, HMO_NO_KEY: "1" } });
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
const local = [];
const central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(path.relative(dist, file).split(path.sep).join("/"));
  const data = readFileSync(file);
  const comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
  h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  local.push(h, name, comp);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += 30 + name.length + comp.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
mkdirSync(path.join(root, "release"), { recursive: true });
const out = path.join(root, "release", `hearmeout-chrome-${version}.zip`);
writeFileSync(out, Buffer.concat([...local, cd, end]));
console.log(`Packaged ${files.length} files → ${path.relative(root, out)}`);
execSync("npx vite build", { cwd: root, stdio: "ignore" }); // restore the keyed dist/ for unpacked use
