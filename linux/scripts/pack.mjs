// Collects the packages Tauri buries in target/release/bundle/{deb,rpm}/ into
// linux/release/, under the names they ship with. Used by `npm run pack` and by
// the release workflow, so both produce exactly the same file names.

import { readFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release");
const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

const shapes = [
  { dir: "deb", match: (f) => f.endsWith(".deb"), tag: "amd64", ext: "deb" },
  { dir: "rpm", match: (f) => f.endsWith(".rpm"), tag: "x86_64", ext: "rpm" },
];

const built = [];
for (const shape of shapes) {
  const bundleDir = join(root, "target", "release", "bundle", shape.dir);
  let files = [];
  try {
    files = readdirSync(bundleDir).filter(shape.match);
  } catch {
    console.error(`No packages in ${bundleDir} — run \`npm run tauri build\` first.`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No packages in ${bundleDir} — run \`npm run tauri build\` first.`);
    process.exit(1);
  }
  // Newest wins, in case an older build is still lying around.
  const chosen = files
    .map((f) => join(bundleDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  built.push({ src: chosen, shape });
}

mkdirSync(outDir, { recursive: true });
const names = [];
for (const { src, shape } of built) {
  const versioned = join(outDir, `PeDitX-Goo-Linux-${version}-${shape.tag}.${shape.ext}`);
  copyFileSync(src, versioned);
  names.push(versioned);
}

for (const name of names) {
  const mb = (statSync(name).size / 1024 / 1024).toFixed(2);
  console.log(`  ${basename(name)} — ${mb} MB`);
}
console.log("");
