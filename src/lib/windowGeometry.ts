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

  await invoke("set_current_window_hit_region_rounded", {
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.max(1, Math.round(region.width)),
    height: Math.max(1, Math.round(region.height)),
    radius: Math.max(0, Math.round(region.radius)),
  });
}

export async function clearCurrentWindowRegion() {
  if (!isTauriRuntime()) return;
  await invoke("clear_current_window_hit_region");
}
