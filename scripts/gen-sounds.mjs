// Draws PeDitX-Goo's 28 WAVs into ../sounds. No dependencies: the samples are
// synthesised here and written out with node:buffer, so the sounds stay "made
// in code" like the icon and the character.
//
//   node scripts/gen-sounds.mjs
//
// The Coucou WAVs are not ours to redistribute, so every sound below is
// written from scratch. Names come from SOUND_NAMES in src/core/sound.ts —
// generate the same set and nothing 404s.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "sounds");
const SR = 44100;

// ── Synth ────────────────────────────────────────────────────────────────────

/** One note: [frequency, start (s), duration (s), amplitude, waveform]. */
const sine = 0;
const tri = 1;
const saw = 2;
const noise = 3;

function render(notes) {
  const end = Math.max(...notes.map(([, t0, d]) => t0 + d)) + 0.02;
  const out = new Float32Array(Math.ceil(end * SR));
  for (const [f, t0, d, amp, wave = sine] of notes) {
    const from = Math.floor(t0 * SR);
    const len = Math.floor(d * SR);
    for (let i = 0; i < len && from + i < out.length; i++) {
      const t = i / SR;
      // Fast attack, exponential decay — nothing here is held.
      const env = Math.exp((-5 * t) / d) * (1 - Math.exp(-400 * t));
      const ph = f * t;
      const s =
        wave === noise
          ? Math.random() * 2 - 1
          : wave === saw
            ? 2 * (ph % 1) - 1
            : wave === tri
              ? (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * ph))
              : Math.sin(2 * Math.PI * ph);
      out[from + i] += s * env * amp;
    }
  }
  // Normalise: the app mixes through a master gain that starts at 0.12, so a
  // sample that is already quiet would be inaudible at the default volume.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.85;
  return out;
}

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // format = PCM
  buf.writeUInt16LE(1, 22); // channels
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return buf;
}

// ── The 28 ───────────────────────────────────────────────────────────────────

const pair = (a, b, d = 0.07) => [[a, 0, d, 0.9], [b, d * 0.7, d, 0.9]];
const arp = (freqs, d = 0.11) => freqs.map((f, i) => [f, i * d * 0.8, d, 0.9]);

const SOUNDS = {
  // Island motion
  peek: [[950, 0, 0.05, 0.7], [1320, 0.04, 0.06, 0.6]],
  open: pair(520, 780),
  close: pair(780, 520),
  hover: [[880, 0, 0.035, 0.5]],
  blip: [[760, 0, 0.05, 0.7]],
  pop: [[620, 0, 0.04, 0.8], [940, 0.03, 0.05, 0.7]],
  tick: [[1180, 0, 0.025, 0.45]],
  attach: [[700, 0, 0.05, 0.7], [520, 0.05, 0.07, 0.7]],
  send: [[740, 0, 0.045, 0.7], [1110, 0.04, 0.06, 0.6]],
  // Character
  greet: arp([523.25, 659.25, 783.99, 1046.5]),
  proud: arp([392, 523.25, 659.25], 0.16),
  love: arp([659.25, 783.99, 987.77], 0.12),
  wink: pair(1040, 1480, 0.05),
  yawn: [[420, 0, 0.18, 0.7, tri], [300, 0.16, 0.22, 0.6, tri]],
  annoyed: [[240, 0, 0.14, 0.8, saw], [210, 0.13, 0.16, 0.7, saw]],
  slap: [[0, 0, 0.09, 1, noise]],
  dizzy: [[640, 0, 0.12, 0.7, saw], [430, 0.1, 0.12, 0.7, saw], [260, 0.2, 0.18, 0.6, saw]],
  gulp: [[320, 0, 0.1, 0.8, tri], [190, 0.09, 0.14, 0.8, tri]],
  // Work and results
  work: [[440, 0, 0.1, 0.7], [440, 0.13, 0.1, 0.6]],
  think: [[330, 0, 0.2, 0.7, tri]],
  search: [[520, 0, 0.07, 0.7], [660, 0.06, 0.07, 0.7], [830, 0.12, 0.09, 0.7]],
  finish: arp([659.25, 783.99, 987.77, 1318.5], 0.09),
  approve: pair(587.33, 880, 0.09),
  error: [[180, 0, 0.2, 0.9, saw], [147, 0.18, 0.24, 0.8, saw]],
  // Waiting
  question: [[660, 0, 0.07, 0.8], [990, 0.07, 0.1, 0.7]],
  approval: [[784, 0, 0.1, 0.85], [987.77, 0.14, 0.14, 0.85]],
  rate: [[1046.5, 0, 0.4, 0.8], [1046.5, 0.45, 0.4, 0.7]],
  sleep: [[300, 0, 0.3, 0.7, sine]],
};

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, notes] of Object.entries(SOUNDS)) {
  const bytes = wav(render(notes));
  writeFileSync(join(OUT, `${name}.wav`), bytes);
  total += bytes.length;
  console.log(`${name}.wav — ${bytes.length} bytes`);
}
console.log(`\n${Object.keys(SOUNDS).length} sounds in ${OUT} — ${(total / 1024).toFixed(1)} KiB`);
