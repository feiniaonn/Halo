import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  register,
  unregisterAll,
} from "@tauri-apps/plugin-global-shortcut";
import { getMusicSettings, musicControl } from "./musicService";
import type {
  MusicCommand,
  MusicHotkeysBindings,
  MusicSettings,
} from "../types/music.types";

let initialized = false;
let focusListenerAttached = false;
let focusEnabled = false;
let focusBindings = new Map<string, string>();
let triggerBusy = false;

const actionByShortcut = new Map<string, string>();

function normalizeShortcut(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const mods = new Set<string>();
  let key: string | null = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      mods.add("Control");
      continue;
    }
    if (lower === "shift") {
      mods.add("Shift");
      continue;
    }
    if (lower === "alt" || lower === "option") {
      mods.add("Alt");
      continue;
    }
    if (
      lower === "meta"
      || lower === "cmd"
      || lower === "command"
      || lower === "super"
      || lower === "win"
    ) {
      mods.add("Meta");
      continue;
    }

    key = part.length === 1 ? part.toUpperCase() : part;
  }

  if (!key) return null;

  const ordered: string[] = [];
  if (mods.has("Control")) ordered.push("Control");
  if (mods.has("Shift")) ordered.push("Shift");
  if (mods.has("Alt")) ordered.push("Alt");
  if (mods.has("Meta")) ordered.push("Meta");
  ordered.push(key);
  return ordered.join("+");
}

function keyFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = event.key;
  if (!key) return null;

  const lower = key.toLowerCase();
  if (lower === "control" || lower === "shift" || lower === "alt" || lower === "meta") {
    return null;
  }

  if (lower === " ") return "Space";
  if (lower === "esc") return "Escape";
  if (lower === "arrowup") return "ArrowUp";
  if (lower === "arrowdown") return "ArrowDown";
  if (lower === "arrowleft") return "ArrowLeft";
  if (lower === "arrowright") return "ArrowRight";

  return key.length === 1 ? key.toUpperCase() : key;
}

function eventToShortcut(event: KeyboardEvent): string | null {
  const key = keyFromKeyboardEvent(event);
  if (!key) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  parts.push(key);

  return normalizeShortcut(parts.join("+"));
}

async function triggerMusicCommand(command: MusicCommand) {
  if (triggerBusy) return;
  triggerBusy = true;
  try {
    await musicControl(command);
  } catch {
    // Ignore transient control failures from hotkey path.
  } finally {
    triggerBusy = false;
  }
}

function attachFocusListener() {
  if (focusListenerAttached) return;
  window.addEventListener("keydown", onFocusKeydown);
  focusListenerAttached = true;
}

function detachFocusListener() {
  if (!focusListenerAttached) return;
  window.removeEventListener("keydown", onFocusKeydown);
  focusListenerAttached = false;
}

function onFocusKeydown(event: KeyboardEvent) {
  if (!focusEnabled) return;
  if (event.repeat) return;

  const shortcut = eventToShortcut(event);
  if (!shortcut) return;

  const command = focusBindings.get(shortcut);
  if (!command) return;

  event.preventDefault();
  if (command === "restore_home") {
    import("@tauri-apps/api/event").then(({ emit }) => {
      void emit("mini-player:restore-home");
    });
    return;
  }
  void triggerMusicCommand(command as MusicCommand);
}

function bindingsToEntries(bindings: MusicHotkeysBindings): Array<[string, string]> {
  const output: Array<[string, string]> = [];
  const previous = normalizeShortcut(bindings.previous);
  const playPause = normalizeShortcut(bindings.play_pause);
  const next = normalizeShortcut(bindings.next);
  const restore = normalizeShortcut(bindings.restore_mini_home);

  if (previous) output.push(["previous", previous]);
  if (playPause) output.push(["play_pause", playPause]);
  if (next) output.push(["next", next]);
  if (restore) output.push(["restore_home", restore]);
  return output;
}

export async function applyMusicHotkeys(settings: MusicSettings) {
  if (!isTauriRuntime()) return;

  const entries = bindingsToEntries(settings.music_hotkeys_bindings);
  focusBindings = new Map(entries.map(([command, shortcut]) => [shortcut, command]));

  await unregisterAll().catch(() => void 0);
  actionByShortcut.clear();

  focusEnabled = Boolean(
    settings.music_hotkeys_enabled
      && settings.music_hotkeys_scope === "focus"
      && entries.length > 0,
  );

  if (focusEnabled) attachFocusListener();
  else detachFocusListener();

  const shouldRegisterGlobal = Boolean(
    settings.music_hotkeys_enabled
      && settings.music_hotkeys_scope === "global"
      && entries.length > 0,
  );

  if (!shouldRegisterGlobal) return;

  const shortcuts = entries.map(([, shortcut]) => shortcut);
  for (const [command, shortcut] of entries) {
    actionByShortcut.set(shortcut.toLowerCase(), command);
  }

  await register(shortcuts, (event) => {
    if (event.state !== "Pressed") return;
    const normalized = normalizeShortcut(event.shortcut)?.toLowerCase();
    if (!normalized) return;
    const command = actionByShortcut.get(normalized);
    if (!command) return;

    if (command === "restore_home") {
      import("@tauri-apps/api/event").then(({ emit }) => {
        void emit("mini-player:restore-home");
      });
      return;
    }
    void triggerMusicCommand(command as MusicCommand);
  });
}

export async function initializeMusicHotkeyManager() {
  if (initialized) return;
  initialized = true;

  if (!isTauriRuntime()) return;

  try {
    const settings = await getMusicSettings();
    await applyMusicHotkeys(settings);
  } catch {
    // Keep silent for startup path.
  }

  void listen<MusicSettings>("music:settings-changed", (event) => {
    if (!event.payload) return;
    void applyMusicHotkeys(event.payload);
  });
}
