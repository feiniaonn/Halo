import { emitTo } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { EVENT_LIVE_PLAYER_LAUNCH, EVENT_LIVE_PLAYER_READY } from "@/modules/shared/services/events";
import { createWindowReadyBarrier } from "@/modules/shared/services/windowLaunchHandshake";
import type { LivePlayerLaunchPayload } from "@/modules/live/types/liveWindow.types";

export const LIVE_PLAYER_WINDOW_LABEL = "live_player";

const LIVE_PLAYER_BOOTSTRAP_STORAGE_KEY = "halo_live_player_bootstrap_payload_v1";
let isCreating = false;

function buildLivePlayerUrl(): string {
  const next = new URL(window.location.href);
  next.searchParams.set("window", LIVE_PLAYER_WINDOW_LABEL);
  next.hash = "";
  return next.toString();
}

function rememberLaunchPayload(payload: LivePlayerLaunchPayload): void {
  try {
    console.log("[Live] Saving bootstrap payload to localStorage...");
    localStorage.setItem(LIVE_PLAYER_BOOTSTRAP_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("[Live] Failed to save bootstrap payload:", err);
  }
}

async function emitLaunchPayload(payload: LivePlayerLaunchPayload): Promise<void> {
  console.log(`[Live] Emitting launch payload to ${LIVE_PLAYER_WINDOW_LABEL}...`);
  await emitTo(LIVE_PLAYER_WINDOW_LABEL, EVENT_LIVE_PLAYER_LAUNCH, payload);
}

async function ensureFocused(handle: WebviewWindow): Promise<void> {
  await handle.unminimize().catch(() => void 0);
  await handle.show();
  await handle.setFocus();
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
    console.log("[Live] Clearing bootstrap payload from localStorage.");
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

  if (isCreating) {
    console.warn("[Live] A window creation is already in progress, skipping duplicate call.");
    return;
  }

  const existing = await WebviewWindow.getByLabel(LIVE_PLAYER_WINDOW_LABEL);
  if (existing) {
    console.log("[Live] Existing window found, updating payload and focusing...");
    rememberLaunchPayload(payload);
    await ensureFocused(existing);
    await emitLaunchPayload(payload);
    return;
  }

  isCreating = true;
  try {
    console.log("[Live] Starting fresh window creation process...");
    rememberLaunchPayload(payload);

    const readyBarrier = createWindowReadyBarrier(EVENT_LIVE_PLAYER_READY, LIVE_PLAYER_WINDOW_LABEL);
    console.log("[Live] Handshake barrier armed.");
    await readyBarrier.armed;

    const win = new WebviewWindow(LIVE_PLAYER_WINDOW_LABEL, {
      url: buildLivePlayerUrl(),
      title: "Live Player",
      width: 1280,
      height: 760,
      minWidth: 900,
      minHeight: 560,
      transparent: false,
      decorations: true,
      shadow: true,
      center: true,
      focus: true,
      visible: true,
      resizable: true,
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      void win.once("tauri://created", () => {
        if (settled) return;
        settled = true;
        console.log("[Live] WebviewWindow 'tauri://created' event received.");
        resolve();
      });
      void win.once("tauri://error", (event) => {
        if (settled) return;
        settled = true;
        console.error("[Live] WebviewWindow 'tauri://error' event received:", event.payload);
        reject(new Error(String(event.payload)));
      });
    });

    await ensureFocused(win);
    console.log("[Live] Waiting for ready signal from player window components...");
    await readyBarrier.ready;
    console.log("[Live] Handshake complete. Pushing final launch payload...");
    await emitLaunchPayload(payload);
  } catch (err) {
    console.error("[Live] Window creation failed:", err);
    throw err;
  } finally {
    isCreating = false;
  }
}
