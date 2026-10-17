// App state — mirror of AppState.swift (the parts the island needs).

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../character/engine";

export type AgentSource = "goo";
export type PillBadge = "approval" | "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  source: AgentSource;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

/** One row of the conversation list the overview shows. */
export interface SessionInfo {
  id: number;
  title: string;
  active: boolean;
  count: number;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

const task = (id: string, name: string, color: string, source: AgentSource): AgentTask => ({
  id, name, color, state: "idle", stepIndex: 0, steps: [], source,
});

/** The one pill the overview shows: the backend itself. */
export const GOO_TASKS: AgentTask[] = [task("peditx_goo", "PeDitX-Goo", "#2F6BFF", "goo")];

export const GOO_TASK_ID = "peditx_goo";

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  screen: "primary" | "cursor";
  autostart: boolean;
  /**
   * Where PeDitX-AI is listening — `http://127.0.0.1:8765` unless moved.
   * Goo has no endpoint, key or model of its own; this points at the agent.
   * Plain text on purpose: an address is not a secret.
   */
  backendUrl: string;
  /** Global shortcut that reveals the island, written as "Ctrl+Shift+N". */
  hotkey: string;
  /** Whether the desktop is holding that shortcut for us. */
  hotkeyEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  screen: "primary",
  autostart: false,
  backendUrl: "http://127.0.0.1:8765",
  hotkey: "Ctrl+Shift+N",
  hotkeyEnabled: false,
};

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  /** Cursor in logical screen pixels, origin top-left (like AppState.mousePosition). */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  droppedFile: { name: string; path: string } | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  /** Every conversation, refreshed from Rust on chat-changed. */
  sessions: SessionInfo[] = [];

  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.steps.push(step);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** The overview always shows the one pill — there is nothing to toggle. */
  loadTasks() {
    for (const proto of GOO_TASKS) {
      if (!this.tasks.some((t) => t.id === proto.id)) this.tasks.push({ ...proto, steps: [] });
    }
    if (!this.focusId) this.focusId = GOO_TASK_ID;
    this.notify();
  }

  defaultView(): IslandViewName {
    return this.tasks.length === 0 ? "empty" : "overview";
  }
}

export const State = new AppState();
