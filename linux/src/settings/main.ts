// Settings window — the place where anything that writes to disk is confirmed.
// One section points the island at PeDitX-AI; the rest is preferences.

import "./settings.css";
import { Bridge, onEvent, type AgentStatus } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;
const saveFeedback = h("div", { "aria-live": "polite", role: "status" });
let lastCheckedUrl = "";

async function save() {
  try {
    await Bridge.saveSettings({ ...settings });
    clear(saveFeedback);
    return true;
  } catch (err) {
    const boot = await Bridge.boot();
    if (boot) {
      settings = { ...settings, ...boot.settings };
      for (const read of READERS) read();
    }
    clear(saveFeedback);
    const message = String(err).replace(/^Error:\s*/, "");
    saveFeedback.append(h("div", {
      class: "notice err",
      text: message.startsWith("Settings were saved,") ? message : `Settings were not saved: ${message}`,
    }));
    return false;
  }
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

// ── PeDitX-AI section ────────────────────────────────────────────────────────
//
// Goo has nothing of its own to configure. One field says where PeDitX-AI is
// listening; everything else on this page is PeDitX-AI read back, so the user
// can see what the companion is about to speak as.

function backendSection(): HTMLElement {
  const dot = statusDot(false);
  const state = h("span", { class: "hint", text: "Not connected yet." });
  const readout = h("div", { class: "hint" });
  const feedback = h("div", {});

  const urlField = h("input", {
    type: "text",
    placeholder: "http://127.0.0.1:8765",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;

  const testBtn = h("button", { text: "Test connection" });
  const openChat = h("button", { text: "Open chat" });

  function note(kind: "ok" | "err" | "", text: string) {
    clear(feedback);
    feedback.append(h("div", { class: kind ? `notice ${kind}` : "notice", text }));
  }

  function paintReadout(s: AgentStatus | null) {
    clear(readout);
    if (!s) return;
    readout.append(h("div", {
      text: `Endpoint: ${s.endpoint || "not set in PeDitX-AI"}`,
    }));
    readout.append(h("div", {
      text: `Model: ${s.model || "not set in PeDitX-AI"}`
        + `  ·  access: ${s.mode}`
        + `  ·  key: ${s.hasKey ? "saved" : "none"}`,
    }));
    readout.append(h("div", {
      text: `Work steps: ${s.maxToolSteps === 0 ? "unlimited" : s.maxToolSteps}`
        + " (set in PeDitX-AI Settings)",
    }));
  }

  function refresh() {
    const url = settings.backendUrl.trim();
    if (document.activeElement !== urlField) urlField.value = settings.backendUrl;
    if (url !== lastCheckedUrl) {
      lastCheckedUrl = url;
      void checkConnection();
    }
  }

  async function checkConnection() {
    const url = settings.backendUrl.trim();
    if (!url) {
      dot.style.background = "#f4505e";
      state.textContent = "No address set.";
      clear(readout);
      return false;
    }
    dot.style.background = "#d5a500";
    state.textContent = `Checking PeDitX-AI at ${url}…`;
    try {
      const status = await Bridge.agentStatus();
      if (settings.backendUrl.trim() !== url) return false;
      dot.style.background = "#22c55e";
      state.textContent = `Connected to PeDitX-AI at ${url}`;
      paintReadout(status);
      return true;
    } catch {
      if (settings.backendUrl.trim() !== url) return false;
      dot.style.background = "#f4505e";
      state.textContent = `Could not reach PeDitX-AI at ${url}.`;
      clear(readout);
      return false;
    }
  }

  let commitPending: Promise<boolean> | null = null;
  async function commitUrl(): Promise<boolean> {
    if (commitPending) return commitPending;
    commitPending = (async () => {
    settings.backendUrl = urlField.value.trim();
      if (!(await save())) return false;
      refresh();
      return true;
    })();
    try { return await commitPending; }
    finally { commitPending = null; }
  }

  urlField.addEventListener("change", () => void commitUrl());
  urlField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      void commitUrl();
      urlField.blur();
    }
  });

  testBtn.addEventListener("click", async () => {
    if (!(await commitUrl())) return;
    note("", "Contacting PeDitX-AI…");
    try {
      const s = await Bridge.agentStatus();
      paintReadout(s);
      dot.style.background = "#22c55e";
      state.textContent = `Connected to PeDitX-AI at ${settings.backendUrl}`;
      note("ok", "PeDitX-AI answered.");
    } catch (err) {
      dot.style.background = "#f4505e";
      state.textContent = `Could not reach PeDitX-AI at ${settings.backendUrl}.`;
      paintReadout(null);
      note("err", String(err).replace(/^Error:\s*/, ""));
    }
  });

  openChat.addEventListener("click", () => void Bridge.openGooWindow());

  READERS.push(refresh);
  void refresh();

  return h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "PeDitX-AI" })),
    state,
    h("div", {
      class: "hint",
      text: "Goo is PeDitX-AI's companion, not a second assistant: it has no model, no key and no personality of its own. It asks PeDitX-AI, and PeDitX-AI answers with its own memory, Skills and access mode.",
    }),
    h("div", { class: "row" }, h("label", { text: "Address" }), urlField, testBtn),
    h("div", {
      class: "hint",
      text: "Where PeDitX-AI listens. Its own default is http://127.0.0.1:8765 — the endpoint, the key and the model live in PeDitX-AI's Settings, not here.",
    }),
    readout,
    h("div", { class: "row" }, openChat),
    feedback,
  );
}

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  let volumeSaveTimer = 0;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    window.clearTimeout(volumeSaveTimer);
    volumeSaveTimer = window.setTimeout(() => void save(), 180);
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  const hotkey = h("input", {
    type: "text", value: settings.hotkey, spellcheck: "false",
    style: "width:120px",
  }) as HTMLInputElement;
  hotkey.addEventListener("change", () => {
    settings.hotkey = hotkey.value.trim() || DEFAULT_SETTINGS.hotkey;
    hotkey.value = settings.hotkey;
    void save();
  });

  const soundToggle = toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); });
  const autostartToggle = toggle(settings.autostart, (v) => { settings.autostart = v; void save(); });
  const hotkeyToggle = toggle(settings.hotkeyEnabled, (v) => { settings.hotkeyEnabled = v; void save(); });
  const syncToggle = (el: HTMLElement, on: boolean) => {
    el.classList.toggle("on", on);
    el.setAttribute("aria-pressed", String(on));
  };
  const refresh = () => {
    volume.value = String(settings.soundVolume);
    autoClose.value = String(Math.round(settings.autoCloseInterval));
    screen.value = settings.screen;
    hotkey.value = settings.hotkey;
    syncToggle(soundToggle, settings.soundEnabled);
    syncToggle(autostartToggle, settings.autostart);
    syncToggle(hotkeyToggle, settings.hotkeyEnabled);
  };
  READERS.push(refresh);

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    h("div", { class: "row" },
      h("label", { text: "Sound" }),
      soundToggle,
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Auto-close" }),
      autoClose,
      h("span", { class: "hint", text: "seconds after you leave the island" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Island lives on" }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: "Launch at startup" }),
      autostartToggle,
    ),
    h("div", { class: "row" },
      h("label", { text: "Show island with shortcut" }),
      hotkeyToggle,
      hotkey,
      h("span", { class: "hint", text: "PeDitX-Goo holds these keys while on" }),
    ),
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

/** Sections re-read `settings` when another window writes the same object. */
const READERS: (() => void)[] = [];

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }

  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "PeDitX-Goo" }), h("span", { class: "version", text: version })),
    saveFeedback,
    backendSection(),
    generalSection(),
    h("div", {
      class: "hint",
      text: "No telemetry. The only network request is the one you configure here.",
    }),
  );

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
    for (const read of READERS) read();
  });
  void onEvent<string>("settings-error", (message) => {
    clear(saveFeedback);
    saveFeedback.append(h("div", { class: "notice err", text: message }));
  });
}

void main();
