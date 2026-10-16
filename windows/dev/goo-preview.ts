// Dev harness: draws the character on its own, with no island, no FSM and
// nothing that can auto-hide. Open /dev/goo-preview.html?state=error in the
// browser to look at one state without launching the app.
//
// Not bundled — dev/upload-preview.html is the same deal.

import { BotEngine } from "../src/character/engine";
import type { BotStateName } from "../src/core/layout";

const q = new URLSearchParams(location.search);
const state = (q.get("state") ?? "idle") as BotStateName;

const W = 560;
const H = 440;
const dpr = Math.min(2, window.devicePixelRatio || 1);

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const label = document.getElementById("label");
canvas.width = W * dpr;
canvas.height = H * dpr;
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
const ctx = canvas.getContext("2d")!;

const eng = new BotEngine();
eng.setState(state, true);
if (label) label.textContent = `state: ${state}`;

// The eyes follow the pointer, which is the thing most worth checking.
canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  eng.lookX = ((e.clientX - r.left) / r.width) * 2 - 1;
  eng.lookY = ((e.clientY - r.top) / r.height) * 2 - 1;
});

let last = performance.now();
function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  eng.update(dt);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  eng.draw(ctx, W, H);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
