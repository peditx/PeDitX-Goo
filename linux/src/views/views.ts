// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { Bridge } from "../core/bridge";
import { State, type AgentTask } from "../core/state";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { buildPrompt } from "./chat";
import { buildChoose, buildUpload, buildUploading } from "./upload";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  setFocus(id: string): void;
  /** The full-screen chat window. */
  openChat(): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(
  label: string,
  kind: "primary" | "secondary",
  onClick: () => void,
  kbd?: string,
): HTMLElement {
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: "Overview", onclick: () => go("overview") }, svg(ICONS.house, 13));
  const tabChat = h("button", { class: "tab", title: "Ask", onclick: () => go("prompt") }, svg(ICONS.bubble, 13));
  const tabDrop = h("button", { class: "tab", title: "Drop", onclick: () => go("upload") }, svg(ICONS.plus, 13));

  const gearBtn = h("button", { title: "Settings", onclick: () => go("settings") }, svg(ICONS.gear, 14));
  const soundBtn = h("button", { title: "Mute", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 14));
  // Collapse from anywhere — Escape needs a keyboard, this is the mouse's way.
  const collapseBtn = h("button", { title: "Collapse", onclick: () => actions.collapse() }, svg(ICONS.xmark, 12));

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabHome, tabChat, tabDrop),
    h("div", { class: "header-actions" }, gearBtn, soundBtn, collapseBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty");
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      gearBtn.classList.toggle("on", v === "settings");
      clear(gearBtn);
      gearBtn.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 14));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  const ticker = new Ticker();
  const who = h("div", { class: "who" });
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el);
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    { class: "icon-btn jump", title: "Open", onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 8),
  );
  const left = card(null, leftBody, jump);

  // Right side: the conversation list — every session, the live one marked —
  // with the Goo button that opens the full-screen window on it.
  const sessionsEl = h("div", { class: "overview-sessions" });
  const gooBtn = h(
    "button",
    {
      class: "icon-btn goo-btn",
      title: "Open chat",
      onclick: () => actions.openChat(),
    },
    svg(ICONS.goo, 18),
  );
  const right = card(null, h("div", { class: "overview-right" }, sessionsEl, gooBtn));

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  let detailOpen = false;
  let lastFocus: string | null = null;
  let mode: "ticker" | "card" | null = null;
  let cardKey = "";
  let sessionsKey: string | null = null;

  // The left card before anything has been said: where this island is pointed.
  const statusDot = h("i", { class: "status-dot" });
  const statusText = h("div", { class: "title" });
  const statusSub = h("div", { class: "sub" });
  const statusCard = card(
    null,
    h("div", { class: "stack", style: "padding:14px 16px 14px 96px;gap:4px" },
      h("div", { class: "who-row" }, statusDot, statusText),
      statusSub,
    ),
  );

  function renderSessions() {
    const key = State.sessions.map((s) => `${s.id}:${s.title}:${s.active ? 1 : 0}:${s.count}`).join("|");
    if (key === sessionsKey) return;
    sessionsKey = key;

    clear(sessionsEl);
    if (State.sessions.length === 0) {
      sessionsEl.append(
        h("div", { class: "overview-empty", style: "display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim-3);font:400 12px var(--font)" },
          "No conversations yet"
        )
      );
      return;
    }

    for (const s of State.sessions) {
      const row = h(
        "div",
        {
          class: `session-row${s.active ? " on" : ""}`,
          title: "Open this conversation",
          onclick: () => {
            actions.blip();
            void Bridge.sessionSelect(s.id);
          },
        },
        h("span", { class: "session-title", text: s.title, dir: "auto" }),
        h("span", { class: "session-count", text: String(s.count) }),
      );
      sessionsEl.append(row);
    }
  }

  return {
    el,
    tick(nowMs: number) {
      if (mode === "ticker") ticker.tick(nowMs);
    },
    sync() {
      const task = State.focusTask;
      if (task?.id !== lastFocus) {
        lastFocus = task?.id ?? null;
        detailOpen = false;
        cardKey = "";
        mode = null;
      }

      // A live turn keeps the ticker; between turns the card says where we point.
      const active = task != null && (task.state !== "idle" || task.steps.length > 0);

      if (task && active) {
        if (mode !== "ticker") {
          clear(leftBody);
          leftBody.append(tickerBody);
          mode = "ticker";
          cardKey = "";
        }
        clear(who);
        who.append(dot(task.color, 7), h("span", { class: "name", text: task.name }));
        if (task.steps.length > 1) {
          who.append(h("span", {
            class: "count",
            text: `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`,
          }));
        }
        ticker.sync(task);
      } else {
        const url = State.settings.backendUrl.trim();
        if (url !== cardKey) {
          cardKey = url;
          mode = "card";
          clear(leftBody);
          leftBody.append(statusCard);
          statusDot.style.background = url ? "#22C55E" : "#F4505E";
          statusText.textContent = url ? "PeDitX-AI" : "Not connected yet";
          statusSub.textContent = url
            ? `via ${url}`
            : "Open Settings and point this at PeDitX-AI.";
        }
      }

      jump.style.display = detailOpen ? "none" : "";

      // The conversation list on the right side
      renderSessions();
    },
  };
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px;flex-direction:row;align-items:center;gap:16px" },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: "Nothing running right now." }),
      h("div", { class: "sub", text: "Drop a file or window, or ask me anything." }),
    ),
    h("div", { class: "grow" }),
    btn("Ask", "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", dir: "auto" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Goo is asking a question"));
      const task = State.focusTask;
      title.textContent = task?.steps.at(-1) ?? "Goo needs an answer.";
      clear(row);
      row.append(h("div", { class: "sub", text: "Reply in the chat — this island can't answer on its own yet." }));
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: "That didn't go through." });
  const detail = h("div", { class: "detail", dir: "auto" });
  const row = h("div", { class: "actions" },
    btn("Retry", "primary", () => actions.setView(State.defaultView())),
    btn("Settings", "secondary", () => actions.openSettingsWindow()),
  );
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "PeDitX-Goo hit an error"));
      title.textContent = "That didn't go through.";
      detail.textContent = State.noteMessage ?? "No detail available.";
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", dir: "auto" });
  const row = h("div", { class: "actions" },
    btn("Open chat", "primary", () => actions.openChat()),
    btn("OK", "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "PeDitX-Goo answered"));
      title.textContent = State.focusTask?.steps.at(-1) ?? "Done.";
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: "Too many hits at once." }),
    h("div", { class: "sub", text: "Give me a sec — back to work in three seconds." }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title", dir: "auto" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const segButtons = [10, 15, 30].map((s) =>
    h("button", { onclick: () => actions.setAutoClose(s) }, `${s}s`),
  );
  const backendBadge = h("span", { class: "status-badge" });
  // Read-only here. Typing an address needs a keyboard, and the island is
  // non-activating: taking focus to type is what made this panel stick open.
  // The Settings window is a normal window and does that job properly.
  const addressText = h("span", {
    style: "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;"
      + "white-space:nowrap;color:#8e939c;font-size:11.5px",
  });
  const feedback = h("div", { style: "font-size:11px;padding:0 2px;min-height:14px" });

  const testBtn = h("button", {
    class: "link-btn",
    style: "color:#8e939c;font-size:11.5px;cursor:pointer",
    text: "Test",
  });
  testBtn.addEventListener("click", () => {
    clear(feedback);
    feedback.append(h("div", { style: "color:#9a9fa8", text: "Contacting PeDitX-AI…" }));
    void Bridge.agentStatus()
      .then((s) => {
        clear(feedback);
        feedback.append(h("div", {
          style: "color:#22C55E",
          text: `PeDitX-AI: ${s.model || "no model set"} · access ${s.mode}`,
        }));
      })
      .catch((err: unknown) => {
        clear(feedback);
        feedback.append(h("div", {
          style: "color:#F4505E",
          text: String(err).replace(/^Error:\s*/, ""),
        }));
      });
  });

  const settingsBtn = h("button", {
    class: "link-btn",
    style: "color:#8e939c;font-size:11.5px;cursor:pointer",
    text: "Edit…",
    onclick: () => actions.openSettingsWindow(),
  });

  const rows = h(
    "div",
    { class: "settings-rows" },
    // Where PeDitX-AI is listening — shown, not typed. Three rows, so the
    // panel fits the strip without scrolling.
    h("div", { class: "settings-row" },
      backendBadge, h("span", { text: "PeDitX-AI" }), addressText, testBtn, settingsBtn),
    feedback,
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: "Sound" }), volume),
    h(
      "div",
      { class: "settings-row" },
      svg(ICONS.timer, 12),
      autoLabel,
      h("div", { class: "seg" }, ...segButtons),
    ),
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack", style: "padding:18px 16px 18px 84px" }, rows)));

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = `Auto-close · ${Math.round(s.autoCloseInterval)}s`;
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      addressText.textContent = s.backendUrl.trim() || "not set";
      addressText.title = s.backendUrl;
      clear(backendBadge);
      backendBadge.append(
        dot(s.backendUrl.trim() ? "#22C55E" : "#F4505E", 6),
        h("span", { text: "Agent" }),
      );
    },
  };
}

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildPlaceholder(title: string, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px" },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", buildOverview(actions));
  map.set("empty", buildEmpty(actions));
  map.set("question", buildQuestion());
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("upload", buildUpload());
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  // Not in the Linux v1: sending a file by email (xdg-email), window attach + web result.
  map.set("mail", buildPlaceholder("Sending by email isn't in this version.", ""));
  map.set("searching", buildPlaceholder("Looking into it…", ""));
  map.set("result", buildPlaceholder("Result", ""));
  return map;
}
