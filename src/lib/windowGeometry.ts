import { invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type PhysicalWindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PhysicalRoundedWindowRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

let lastRoundedRegionKey: string | null = null;
let pendingRoundedRegion: PhysicalRoundedWindowRegion | null = null;
let roundedRegionFlushPromise: Promise<void> | null = null;

export async function applyCurrentWindowRect(rect: PhysicalWindowRect) {
  if (!isTauriRuntime()) return;

  try {
    await invoke("set_current_window_bounds_atomic", {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    });
    return;
  } catch {
    void 0;
  }

  const win = getCurrentWindow();
  await win.setSize(new PhysicalSize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))));
  await win.setPosition(new PhysicalPosition(Math.round(rect.x), Math.round(rect.y)));
}

export async function setCurrentWindowRoundedRegion(region: PhysicalRoundedWindowRegion) {
  if (!isTauriRuntime()) return;
  const normalizedRegion = {
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.max(1, Math.round(region.width)),
    height: Math.max(1, Math.round(region.height)),
    radius: Math.max(0, Math.round(region.radius)),
  };
  const nextKey = JSON.stringify(normalizedRegion);
  if (nextKey === lastRoundedRegionKey && pendingRoundedRegion == null && roundedRegionFlushPromise == null) {
    return;
  }

  pendingRoundedRegion = normalizedRegion;
  if (roundedRegionFlushPromise) {
    return roundedRegionFlushPromise;
  }

  roundedRegionFlushPromise = (async () => {
    try {
      while (pendingRoundedRegion) {
        const nextRegion = pendingRoundedRegion;
        pendingRoundedRegion = null;
        const nextRegionKey = JSON.stringify(nextRegion);
        if (nextRegionKey === lastRoundedRegionKey) {
          continue;
        }
        await invoke("set_current_window_hit_region_rounded", nextRegion);
        lastRoundedRegionKey = nextRegionKey;
      }
    } finally {
      roundedRegionFlushPromise = null;
    }
  })();

  return roundedRegionFlushPromise;
}

export async function clearCurrentWindowRegion() {
  if (!isTauriRuntime()) return;
  pendingRoundedRegion = null;
  roundedRegionFlushPromise = null;
  lastRoundedRegionKey = null;
  await invoke("clear_current_window_hit_region");
}
