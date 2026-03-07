import { emitTo } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { EVENT_LIVE_PLAYER_LAUNCH } from "@/modules/shared/services/events";
import type { LivePlayerLaunchPayload } from "@/modules/live/types/liveWindow.types";

export const LIVE_PLAYER_WINDOW_LABEL = "live_player";

const LIVE_PLAYER_BOOTSTRAP_STORAGE_KEY = "halo_live_player_bootstrap_payload_v1";

function buildLivePlayerUrl(): string {
  const next = new URL(window.location.href);
  next.searchParams.set("window", LIVE_PLAYER_WINDOW_LABEL);
  next.hash = "";
  return next.toString();
}

function rememberLaunchPayload(payload: LivePlayerLaunchPayload): void {
  try {
    localStorage.setItem(LIVE_PLAYER_BOOTSTRAP_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

async function emitLaunchPayload(payload: LivePlayerLaunchPayload): Promise<void> {
  await emitTo(LIVE_PLAYER_WINDOW_LABEL, EVENT_LIVE_PLAYER_LAUNCH, payload);
}

async function ensureFocused(windowHandle: WebviewWindow): Promise<void> {
  await windowHandle.unminimize().catch(() => void 0);
  await windowHandle.show();
  await windowHandle.setFocus();
}

export function readBootstrappedLiveLaunchPayload(): LivePlayerLaunchPayload | null {
  try {
    const raw = localStorage.getItem(LIVE_PLAYER_BOOTSTRAP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LivePlayerLaunchPayload;
    if (!parsed?.initialChannel?.name || !Array.isArray(parsed?.groups)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearBootstrappedLiveLaunchPayload(): void {
  try {
    localStorage.removeItem(LIVE_PLAYER_BOOTSTRAP_STORAGE_KEY);
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export async function focusLivePlayerWindow(): Promise<void> {
  if (!isTauri()) return;
  const existing = await WebviewWindow.getByLabel(LIVE_PLAYER_WINDOW_LABEL);
  if (!existing) return;
  await ensureFocused(existing);
}

export async function closeLivePlayerWindow(): Promise<void> {
  if (!isTauri()) return;
  const existing = await WebviewWindow.getByLabel(LIVE_PLAYER_WINDOW_LABEL);
  if (!existing) return;
  await existing.close().catch(() => void 0);
}

export async function openLivePlayerWindow(payload: LivePlayerLaunchPayload): Promise<void> {
  if (!isTauri()) return;

  rememberLaunchPayload(payload);

  const existing = await WebviewWindow.getByLabel(LIVE_PLAYER_WINDOW_LABEL);
  if (existing) {
    await ensureFocused(existing);
    await emitLaunchPayload(payload);
    return;
  }

  const win = new WebviewWindow(LIVE_PLAYER_WINDOW_LABEL, {
    url: buildLivePlayerUrl(),
    title: "Live Player",
    width: 1280,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    transparent: true,
    decorations: false,
    shadow: false,
    center: true,
    focus: true,
    visible: true,
    resizable: true,
    parent: "main",
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    void win.once("tauri://created", () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    void win.once("tauri://error", (event) => {
      if (settled) return;
      settled = true;
      reject(new Error(String(event.payload)));
    });
  });

  await ensureFocused(win);
}
