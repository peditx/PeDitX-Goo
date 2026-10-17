// Draws PeDitX-Goo's icons by screenshotting the character itself.
//
//   npm run icons          (or: node scripts/gen-icons.mjs)
//
// The island's own engine draws the tray icon, via dev/goo-preview.html?icon=N
// — so the icon cannot drift from the character: there is one drawing, and it
// is the live one. Chrome does the rasterising and Vite serves the page; both
// are dev-time only, and CI runs `npm run pack` and takes these files as they
// are. No dependency is added.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "src-tauri", "icons");
const PAGE = "http://127.0.0.1:1420/dev/goo-preview.html";

const CANDIDATES =
  process.platform === "win32"
    ? [process.env.CHROME, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
       "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
    : [process.env.CHROME, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
const CHROME = CANDIDATES.filter(Boolean).find(
  (n) => spawnSync(n, ["--version"], { stdio: "ignore" }).status === 0,
);
if (!CHROME) {
  console.error("no Chrome found — set $CHROME, or keep the committed icons");
  process.exit(1);
}

const up = () =>
  new Promise((res) => {
    const req = request(`${PAGE}?icon=8`, { timeout: 1500 }, (r) => {
      r.resume();
      res(r.statusCode === 200);
    });
    req.on("error", () => res(false));
    req.on("timeout", () => {
      req.destroy();
      res(false);
    });
    req.end();
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let vite = null;
if (!(await up())) {
  console.log("starting vite…");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  vite = spawn(npm, ["run", "dev"], { cwd: ROOT, stdio: "ignore", detached: false });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
  if (!(await up())) {
    console.error("vite did not come up on :1420");
    process.exit(1);
  }
}

mkdirSync(OUT, { recursive: true });

/** One square transparent PNG of the character at `size`. */
function render(size) {
  const shot = join(OUT, `.icon-${size}.png`);
  const r = spawnSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--virtual-time-budget=5000`,
      `--screenshot=${shot}`,
      `${PAGE}?icon=${size}`,
    ],
    { stdio: "ignore" },
  );
  if (r.status !== 0 || !existsSync(shot)) {
    console.error(`Chrome failed at ${size}px`);
    process.exit(1);
  }
  return shot;
}

// ── ICO (PNG-in-ICO, Vista and later) ─────────────────────────────────────────

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;
    dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ── Go ────────────────────────────────────────────────────────────────────────

const shots = new Map();
const file = (size) => {
  if (!shots.has(size)) shots.set(size, render(size));
  return shots.get(size);
};

for (const [name, size] of [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
]) {
  const bytes = readFileSync(file(size));
  writeFileSync(join(OUT, name), bytes);
  console.log(`${name} — ${bytes.length} bytes`);
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const ico = encodeICO(icoSizes.map((size) => ({ size, png: readFileSync(file(size)) })));
writeFileSync(join(OUT, "icon.ico"), ico);
console.log(`icon.ico — ${ico.length} bytes`);

for (const size of shots.keys()) rmSync(join(OUT, `.icon-${size}.png`), { force: true });
if (vite) {
  vite.kill();
  console.log("vite stopped");
}
