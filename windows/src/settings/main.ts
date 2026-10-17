// Settings window — the place where anything that writes to disk is confirmed.
// One section connects the island to an endpoint; the rest is preferences.

import "./settings.css";
import { Bridge, onEvent } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";

/** Key of the optional bearer token. The address itself lives in `settings`. */
const API_KEY = "goo-api-key";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
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

// ── Backend section ─────────────────────────────────────────────────────────

function backendSection(): HTMLElement {
  const dot = statusDot(false);
  const state = h("span", { class: "hint", text: "Not connected yet." });
  const feedback = h("div", {});

  const urlField = h("input", {
    type: "text",
    placeholder: "http://192.168.1.1:8765/v1",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  const keyField = h("input", {
    type: "password",
    placeholder: "API key (optional)",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  const modelList = h("datalist", { id: "goo-models" });
  const modelField = h("input", {
    type: "text",
    list: "goo-models",
    placeholder: "model id",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;

  const saveKey = h("button", { class: "primary", text: "Save key" });
  const clearKey = h("button", { class: "danger", text: "Remove" });
  const testBtn = h("button", { text: "Test & fetch models" });
  const openChat = h("button", { text: "Open chat" });

  function note(kind: "ok" | "err" | "", text: string) {
    clear(feedback);
    feedback.append(h("div", { class: kind ? `notice ${kind}` : "notice", text }));
  }

  function refresh() {
    const url = settings.backendUrl.trim();
    dot.style.background = url ? "#22c55e" : "#f4505e";
    state.textContent = url ? `Address saved — ${url}` : "Not connected yet.";
    if (document.activeElement !== urlField) urlField.value = settings.backendUrl;
    if (document.activeElement !== modelField) modelField.value = settings.model;
    void Bridge.secretPresent(API_KEY).then((has) => {
      const present = has ?? false;
      if (document.activeElement !== keyField) {
        keyField.value = "";
        keyField.placeholder = present ? "••••••••  (saved)" : "API key (optional)";
      }
      clearKey.style.display = present ? "" : "none";
    });
  }

  /** The address lives in Settings, so it round-trips and stays visible. */
  async function commitUrl() {
    settings.backendUrl = urlField.value.trim();
    await save();
    refresh();
  }

  urlField.addEventListener("change", () => void commitUrl());
  modelField.addEventListener("change", () => {
    settings.model = modelField.value.trim();
    void save();
    refresh();
  });

  saveKey.addEventListener("click", async () => {
    const value = keyField.value.trim();
    clear(feedback);
    if (!value) return;
    try {
      await Bridge.secretSet(API_KEY, value);
      note("ok", "Saved. It never touches disk.");
      refresh();
    } catch (err) {
      note("err", `Could not save: ${String(err)}`);
    }
  });

  clearKey.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear(API_KEY);
      note("ok", "Key removed.");
      refresh();
    } catch (err) {
      note("err", `Could not remove: ${String(err)}`);
    }
  });

  testBtn.addEventListener("click", async () => {
    await commitUrl();
    note("", "Contacting the endpoint…");
    try {
      const list = await Bridge.gooModels();
      clear(modelList);
      for (const id of list) modelList.append(h("option", { value: id }));
      // Picking the first is what makes an install work before anything else
      // is chosen; the field stays editable.
      if (!settings.model && list.length > 0) {
        settings.model = list[0];
        await save();
        refresh();
      }
      note(
        "ok",
        list.length > 0
          ? `Connected — ${list.length} model${list.length === 1 ? "" : "s"}.`
          : "Connected, but the endpoint listed no models — type the model id by hand.",
      );
    } catch (err) {
      note("err", String(err).replace(/^Error:\s*/, ""));
    }
  });

  openChat.addEventListener("click", () => void Bridge.openGooWindow());

  void refresh();
  // The island writes the same settings object, so this panel has to re-read
  // it — otherwise the address shown here is the one from before the change.
  READERS.push(() => refresh());

  return h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Endpoint" })),
    state,
    h("div", {
      class: "hint",
      text: "Any OpenAI-compatible Chat Completions endpoint: 9Router, PeDitX-AI, or a service on your own LAN. Plain http is fine — nothing forces https, and nothing is upgraded for you.",
    }),
    h("div", { class: "row" }, h("label", { text: "Base URL" }), urlField, testBtn),
    h("div", {
      class: "hint",
      text: "Local: http://127.0.0.1:20128/v1  |  Router or LAN: http://192.168.1.1:8765/v1  |  Public: https://api.example.com/v1  — a pasted /v1 or /chat/completions path is accepted as written.",
    }),
    h("div", { class: "row" }, h("label", { text: "Key" }), keyField, saveKey, clearKey),
    h("div", {
      class: "hint",
      text: "Optional: a service on your LAN often needs none, and the request then goes out without an Authorization header. Held in the system keyring, never on disk.",
    }),
    h("div", { class: "row" }, h("label", { text: "Model" }), modelField, modelList),
    h("div", {
      class: "hint",
      text: "Filled in by Test & fetch models. Sent with every turn; leave it as the endpoint's first model if you are not sure.",
    }),
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
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
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

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    h("div", { class: "row" },
      h("label", { text: "Sound" }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
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
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Show island with shortcut" }),
      toggle(settings.hotkeyEnabled, (v) => { settings.hotkeyEnabled = v; void save(); }),
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
}

void main();
