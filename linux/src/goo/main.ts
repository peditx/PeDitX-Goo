// Full-screen chat — a normal window, unlike the island.
//
// The sessions are Rust's, next to the island's: this window is a view of the
// same store, one tab per conversation. A New chat, a switch or a question
// asked in the island all land in the same list. The token never reaches this
// file; Rust signs the request.
//
// Nothing is persisted across restarts — sessions live as long as the app
// (ponytail: hand them to settings.rs when one has to survive that).

import "./goo.css";
import {
  Bridge,
  onEvent,
  titleOf,
  turnsOf,
  type ChatTurn,
  type SessionState,
} from "../core/bridge";
import { h, clear, svg } from "../views/dom";
import { ICONS } from "../views/icons";

const root = document.getElementById("goo-root")!;

interface Session {
  id: number;
  /** First thing asked here — the tab's label. */
  title: string;
  turns: ChatTurn[];
}

/** Local fallback for the plain-browser preview, where Rust is not there. */
let nextLocalId = 1;

let sessions: Session[] = [{ id: nextLocalId++, title: "New chat", turns: [] }];
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

/** Rebuilds the tabs and the transcript from the store — the single refresh. */
function applyState(st: SessionState) {
  sessions = st.sessions.map((s) => ({
    id: s.id,
    title: titleOf(s.messages),
    turns: turnsOf(s.messages),
  }));
  active = sessions.find((s) => s.id === st.active) ?? sessions[0];
  renderTabs();
  renderTranscript();
}

async function syncSessions() {
  const st = await Bridge.sessionList();
  if (st) applyState(st);
  else {
    // Plain-browser preview: the tabs live here alone.
    renderTabs();
    renderTranscript();
  }
}

function renderTabs() {
  clear(tabs);
  for (const s of sessions) {
    const tab = h(
      "div",
      { class: `tab${s === active ? " on" : ""}`, title: s.title },
      h("span", { class: "tab-label", text: s.title, dir: "auto" }),
    );
    tab.addEventListener("click", () => {
      if (streaming || s === active) return;
      // The selected session becomes the shared transcript: the island's next
      // question lands here, and its history shows this conversation.
      void switchTo(s);
    });
    if (sessions.length > 1) {
      const close = h("span", { class: "tab-close", text: "×", title: "Close" });
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        void closeSession(s);
      });
      tab.append(close);
    }
    tabs.append(tab);
  }
  const add = h("div", { class: "tab add", title: "New chat", text: "+" });
  add.addEventListener("click", () => void openNewSession());
  tabs.append(add);
}

async function switchTo(s: Session) {
  const st = await Bridge.sessionSelect(s.id);
  if (st) applyState(st);
  else {
    active = s;
    renderTabs();
    renderTranscript();
  }
  input.focus();
}

async function openNewSession() {
  if (streaming) return;
  // `force`: even an empty active session gets a tab the user can see — the
  // island's own New chat keeps passiveness so blanks do not pile up there.
  const st = await Bridge.sessionNew(true);
  if (st) applyState(st);
  else {
    active = { id: nextLocalId++, title: "New chat", turns: [] };
    sessions.push(active);
    renderTabs();
    renderTranscript();
  }
  input.focus();
}

async function closeSession(s: Session) {
  if (streaming || sessions.length === 1) return;
  const st = await Bridge.sessionClose(s.id);
  if (st) {
    applyState(st);
    return;
  }
  const i = sessions.indexOf(s);
  if (i < 0) return;
  sessions.splice(i, 1);
  if (s === active) active = sessions[Math.max(0, i - 1)];
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
    active.title = titleOf([{ role: "user", content: text }]);
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
    // A chat-changed that landed mid-turn re-reads the store now.
    if (pendingRefresh) {
      pendingRefresh = false;
      void syncSessions();
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
  // Opens on the shared store: tabs, active session, all of it.
  await syncSessions();
  input.focus();
}

void boot();

// The island asked something, started a session, or selected another: this
// window follows the store. While a turn is running, apply it after.
void onEvent("chat-changed", () => {
  if (streaming) {
    pendingRefresh = true;
    return;
  }
  void syncSessions();
});
