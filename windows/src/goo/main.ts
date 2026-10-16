// Full-screen chat — a normal window, unlike the island.
//
// The transcript lives here rather than in Rust: the window renders it anyway,
// and a stateless history keeps one fewer thing to keep in sync. The token
// never reaches this file; Rust signs the request.

import "./goo.css";
import { Bridge, type ChatTurn } from "../core/bridge";
import { h, clear, svg } from "../views/dom";
import { ICONS } from "../views/icons";

const root = document.getElementById("goo-root")!;

let turns: ChatTurn[] = [];
let streaming = false;
let configured = false;

const stream = h("div", { class: "stream" });
const transcript = h("main", {}, stream);
const emptySlot = h("div", {});

const input = h("textarea", {
  rows: 1,
  placeholder: "Message Goo…",
  spellcheck: "false",
}) as HTMLTextAreaElement;

const sendBtn = h(
  "button",
  { class: "send", title: "Send", "aria-label": "Send" },
  svg(ICONS.arrowUp, 15),
) as HTMLButtonElement;

const composer = h("div", { class: "composer" }, input, sendBtn);
const footer = h("footer", {}, composer);

const statusText = h("span", { text: "checking…" });
const statusDot = h("i", { class: "dot" });
const status = h("div", { class: "status" }, statusDot, statusText);
const newChatBtn = h("button", { class: "ghost", text: "New chat" }) as HTMLButtonElement;

const header = h(
  "header",
  {},
  h("span", { class: "title", text: "Goo" }),
  status,
  h("span", { class: "spacer" }),
  newChatBtn,
  h("button", { text: "Settings", onclick: () => void Bridge.openSettingsWindow() }),
);

root.replaceChildren(header, transcript, footer);

// ── Rendering ────────────────────────────────────────────────────────────────

function scrollToEnd() {
  transcript.scrollTop = transcript.scrollHeight;
}

function messageNode(turn: { role: ChatTurn["role"]; content: string }) {
  return h(
    "div",
    { class: `msg ${turn.role}` },
    h("div", { class: "who", text: turn.role === "user" ? "You" : "Goo" }),
    h("div", { class: "body", text: turn.content }),
  );
}

function renderEmpty() {
  clear(stream);
  stream.append(emptySlot);
  const card = h(
    "div",
    { class: "empty" },
    h("h2", { text: configured ? "Start a conversation" : "Connect your endpoint" }),
    h("p", {
      text: configured
        ? "Messages go to whatever OpenAI-compatible endpoint you pointed Settings at — 9Router, PeDitX-AI, or a service on your own LAN."
        : "PeDitX-Goo talks to any OpenAI-compatible Chat Completions endpoint. Add the address in Settings, then come back here.",
    }),
  );
  if (!configured) {
    card.append(
      h("button", {
        class: "primary",
        text: "Open Settings",
        onclick: () => void Bridge.openSettingsWindow(),
      }),
    );
  }
  emptySlot.replaceChildren(card);
}

function clearEmpty() {
  emptySlot.replaceChildren();
}

function notice(message: string) {
  stream.append(h("div", { class: "notice err", text: message }));
  scrollToEnd();
}

function setBusy(busy: boolean) {
  streaming = busy;
  input.disabled = busy;
  sendBtn.disabled = busy;
  newChatBtn.disabled = busy;
}

// ── Send ─────────────────────────────────────────────────────────────────────

async function submit() {
  const text = input.value.trim();
  if (!text || streaming) return;
  if (!configured) {
    notice("No endpoint yet — open Settings first.");
    return;
  }

  // Snapshot taken before the new turn: Rust appends the prompt itself.
  const history = turns.map((t) => ({ role: t.role, content: t.content }));

  input.value = "";
  autoGrow();
  clearEmpty();

  turns.push({ role: "user", content: text });
  const answer: ChatTurn = { role: "assistant", content: "" };
  turns.push(answer);

  stream.append(messageNode({ role: "user", content: text }));
  const node = messageNode(answer);
  stream.append(node);
  const body = node.querySelector(".body") as HTMLElement;
  scrollToEnd();

  setBusy(true);
  try {
    await Bridge.gooSend(history, text, (delta) => {
      answer.content += delta;
      body.textContent = answer.content;
      scrollToEnd();
    });
  } catch (err) {
    const message = String(err).replace(/^Error:\s*/, "") || "Something went wrong.";
    // Drop a reply that never arrived, so the next turn sends a clean history.
    if (!answer.content) {
      turns.pop();
      node.remove();
      if (turns.length === 0) renderEmpty();
    }
    notice(message);
  } finally {
    setBusy(false);
    input.focus();
  }
}

function autoGrow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
}

function reset() {
  if (streaming) return;
  turns = [];
  renderEmpty();
  input.focus();
}

sendBtn.addEventListener("click", () => void submit());
newChatBtn.addEventListener("click", reset);
input.addEventListener("input", autoGrow);
input.addEventListener("keydown", (e) => {
  const event = e as KeyboardEvent;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submit();
  }
});

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  configured = (await Bridge.gooConfigured()) ?? false;
  statusDot.style.background = configured ? "#22c55e" : "#f4505e";
  statusText.textContent = configured ? "ready" : "not configured";
  renderEmpty();
  input.focus();
}

void boot();
