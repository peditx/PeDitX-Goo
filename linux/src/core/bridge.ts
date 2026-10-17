// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Settings } from "./state";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[peditx-goo] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  openUrl: (url: string) => call<void>("open_url", { url }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Opens the full-screen chat window. */
  openGooWindow: () => call<void>("open_goo_window"),
  /** An address is set — never which half of it is missing. */
  gooConfigured: () => call<boolean>("goo_configured"),
  /**
   * PeDitX-AI read back: its endpoint, its model, its access mode. An error
   * string is what Settings shows the user when it is not running.
   */
  agentStatus: () => callOrThrow<AgentStatus>("agent_status"),

  /** Writes to $XDG_STATE_HOME/peditx-goo/goo.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn, handed to PeDitX-AI whole. */
  chatSend: (query: string, context: ChatContext | null) =>
    callOrThrow<{ text: string }>("chat_send", { query, context }),
  chatReset: () => call<void>("chat_reset"),
  /** The shared transcript, raw, as the Rust side holds it. */
  chatHistory: () => call<unknown[]>("chat_history"),
  /** Makes `messages` the shared transcript — how a session tab is selected. */
  chatLoad: (messages: unknown[]) => call<void>("chat_load", { messages }),

  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),

  /** One streamed turn for the full-screen window, on the shared transcript. */
  gooSend: (prompt: string, onDelta: (text: string) => void) => streamGoo(prompt, onDelta),
};

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

/** PeDitX-AI read back: its endpoint, model and access mode. Never the key. */
export interface AgentStatus {
  endpoint: string;
  model: string;
  mode: string;
  hasKey: boolean;
}

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type GooEvent = { type: "delta"; text: string } | { type: "done" };

/**
 * One streamed turn. Rust signs the request and reads the bearer key; all that
 * crosses back is text, so this file never touches the secret. The transcript
 * is Rust's: the prompt is appended there, not here.
 */
export async function streamGoo(
  prompt: string,
  onDelta: (text: string) => void,
): Promise<void> {
  if (!IS_TAURI) throw new Error("not running inside PeDitX-Goo");
  const channel = new Channel<GooEvent>();
  channel.onmessage = (event) => {
    if (event.type === "delta") onDelta(event.text);
  };
  await invoke("goo_send", { prompt, channel });
}

/** `content` as the answer reads it: a string, or a list of text blocks. */
function turnText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String((block as { text?: unknown }).text ?? "")
          : "",
      )
      .join("\n");
  }
  return "";
}

/**
 * The shared transcript as the UI draws it: user and assistant turns with
 * content, tool calls and tool results dropped — they are the agent's plumbing.
 */
export function turnsOf(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const item of raw) {
    const m = item as { role?: unknown; content?: unknown };
    if (m?.role !== "user" && m?.role !== "assistant") continue;
    const text = turnText(m.content).trim();
    if (text) out.push({ role: m.role as ChatTurn["role"], content: text });
  }
  return out;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside PeDitX-Goo");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/** Files dragged onto the island. Only reaches us when the window takes the mouse. */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
