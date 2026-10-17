// Full-screen chat — a normal window, unlike the island.
//
// The transcript lives here rather than in Rust: the window renders it anyway,
// and a stateless history keeps one fewer thing to keep in sync. The token
// never reaches this file; Rust signs the request.
//
// The window is a workspace of sessions — one tab per conversation, switchable,
// kept in memory while the window exists. Nothing here is persisted: a restart
// starts from one empty tab (ponytail: hand sessions to settings.rs when a
// conversation has to survive the app).

import "./goo.css";
import { Bridge, onEvent, turnsOf, type ChatTurn } from "../core/bridge";
import { h, clear, svg } from "../views/dom";
import { ICONS } from "../views/icons";

const root = document.getElementById("goo-root")!;

interface Session {
  id: number;
  /** First thing asked here — the tab's label. Empty = nothing said yet. */
  title: string;
  turns: ChatTurn[];
}

let nextId = 1;
const newSession = (): Session => ({ id: nextId++, title: "", turns: [] });

let sessions: Session[] = [newSession()];
let active: Session = sessions[0];
let streaming = false;
let configured = false;

const stream = h("div", { class: "stream" });
const transcript = h("main", {}, stream);
const emptySlot = h("div", {});

// dir="auto": the first strong character decides — Persian reads right-to-left,
// English left-to-right, and mixed lines (a URL beside فارسی) come out right.
const input = h("textarea", {
  rows: 1,
  placeholder: "Message Goo…",
  spellcheck: "false",
  dir: "auto",
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

const tabs = h("div", { class: "tabs" });

const header = h(
  "header",
  {},
  h("span", { class: "title", text: "Goo" }),
  status,
  h("span", { class: "spacer" }),
  h("button", { text: "Settings", onclick: () => void Bridge.openSettingsWindow() }),
);

root.replaceChildren(header, tabs, transcript, footer);

// ── Sessions ─────────────────────────────────────────────────────────────────

function renderTabs() {
  clear(tabs);
  for (const s of sessions) {
    const tab = h(
      "div",
      { class: `tab${s === active ? " on" : ""}`, title: s.title || "New chat" },
      h("span", { class: "tab-label", text: s.title || "New chat", dir: "auto" }),
    );
    tab.addEventListener("click", () => {
      if (streaming || s === active) return;
      active = s;
      // The selected session becomes the shared transcript: the island's next
      // question lands here, and its history shows this conversation.
      void Bridge.chatLoad(sessionMessages(s));
      renderTabs();
      renderTranscript();
      input.focus();
    });
    if (sessions.length > 1) {
      const close = h("span", { class: "tab-close", text: "×", title: "Close" });
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeSession(s);
      });
      tab.append(close);
    }
    tabs.append(tab);
  }
  const add = h("div", { class: "tab add", title: "New chat", text: "+" });
  add.addEventListener("click", () => openNewSession());
  tabs.append(add);
}

function openNewSession() {
  if (streaming) return;
  active = newSession();
  sessions.push(active);
  // The island shares this transcript — a new chat here is a new chat there.
  void Bridge.chatLoad([]);
  renderTabs();
  renderTranscript();
  input.focus();
}

function closeSession(s: Session) {
  if (streaming || sessions.length === 1) return;
  const i = sessions.indexOf(s);
  sessions.splice(i, 1);
  if (s === active) {
    active = sessions[Math.max(0, i - 1)];
    void Bridge.chatLoad(sessionMessages(active));
    renderTranscript();
  }
  renderTabs();
}

function sessionMessages(s: Session): unknown[] {
  return s.turns.map((t) => ({ role: t.role, content: t.content }));
}

const titleOf = (text: string) => (text.length > 28 ? `${text.slice(0, 28)}…` : text);

/**
 * The one active conversation lives in Rust, next to the island's. Every
 * window reads it from there — this window's tabs, the island's transcript
 * and the overview's history are views of the same thing.
 */
async function refreshActive() {
  const raw = await Bridge.chatHistory();
  if (raw) active.turns = turnsOf(raw);
  if (!active.title && active.turns.length > 0) {
    active.title = titleOf(active.turns[0].content);
  }
  renderTabs();
  renderTranscript();
}

// ── Rendering ────────────────────────────────────────────────────────────────

function scrollToEnd() {
  transcript.scrollTop = transcript.scrollHeight;
}

function messageNode(turn: { role: ChatTurn["role"]; content: string }) {
  return h(
    "div",
    { class: `msg ${turn.role}` },
    h("div", { class: "who", text: turn.role === "user" ? "You" : "Goo" }),
    h("div", { class: "body", text: turn.content, dir: "auto" }),
  );
}

function renderTranscript() {
  clear(stream);
  if (active.turns.length === 0) {
    renderEmpty();
    return;
  }
  clearEmpty();
  for (const t of active.turns) stream.append(messageNode(t));
  scrollToEnd();
}

function renderEmpty() {
  clear(stream);
  stream.append(emptySlot);
  const card = h(
    "div",
    { class: "empty" },
    h("h2", { text: configured ? "Start a conversation" : "PeDitX-AI is not connected" }),
    h("p", {
      text: configured
        ? "Everything you ask here goes to PeDitX-AI — its persona, memory and Skills answer, and whatever tools it needs run there."
        : "Goo has no model of its own: it is the face of PeDitX-AI. Set PeDitX-AI's address in Settings, then come back here.",
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
  stream.append(h("div", { class: "notice err", text: message, dir: "auto" }));
  scrollToEnd();
}

function setBusy(busy: boolean) {
  streaming = busy;
  input.disabled = busy;
  sendBtn.disabled = busy;
}

// ── Send ─────────────────────────────────────────────────────────────────────

async function submit() {
  const text = input.value.trim();
  if (!text || streaming) return;
  if (!configured) {
    notice("No endpoint yet — open Settings first.");
    return;
  }

  input.value = "";
  autoGrow();
  clearEmpty();

  if (!active.title) {
    active.title = titleOf(text);
    renderTabs();
  }
  active.turns.push({ role: "user", content: text });
  const answer: ChatTurn = { role: "assistant", content: "" };
  active.turns.push(answer);

  stream.append(messageNode({ role: "user", content: text }));
  const node = messageNode(answer);
  stream.append(node);
  const body = node.querySelector(".body") as HTMLElement;
  scrollToEnd();

  setBusy(true);
  try {
    await Bridge.gooSend(text, (delta) => {
      answer.content += delta;
      body.textContent = answer.content;
      scrollToEnd();
    });
  } catch (err) {
    const message = String(err).replace(/^Error:\s*/, "") || "Something went wrong.";
    // Drop a reply that never arrived, so the next turn sends a clean history.
    if (!answer.content) {
      active.turns.pop();
      node.remove();
      if (active.turns.length === 0) renderEmpty();
    }
    notice(message);
  } finally {
    setBusy(false);
    // A chat-changed that landed mid-turn re-reads the stored transcript now.
    if (pendingRefresh) {
      pendingRefresh = false;
      void refreshActive();
    }
    input.focus();
  }
}

/** A chat-changed event while streaming is applied once the turn is done. */
let pendingRefresh = false;

function autoGrow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
}

sendBtn.addEventListener("click", () => void submit());
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
  // Opens on whatever the island was last talking about — one conversation.
  await refreshActive();
  input.focus();
}

void boot();

// The island asked something, reset, or selected another session: this window
// follows the shared transcript. While a turn is running, apply it after.
void onEvent("chat-changed", () => {
  if (streaming) {
    pendingRefresh = true;
    return;
  }
  void refreshActive();
});
