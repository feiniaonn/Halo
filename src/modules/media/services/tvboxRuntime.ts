import { invoke } from "@tauri-apps/api/core";

import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";

const remoteExtCache = new Map<string, Promise<string>>();

async function fetchRemoteExtText(url: string): Promise<string> {
  const response = await invoke<string>("fetch_tvbox_config", { url });
  return typeof response === "string" ? response.trim() : "";
}

export async function resolveSiteExtInput(site: Pick<NormalizedTvBoxSite, "extKind" | "extValue">): Promise<string> {
  if (site.extKind !== "url") {
    return site.extValue;
  }

  const target = site.extValue.trim();
  if (!target) return "";

  let task = remoteExtCache.get(target);
  if (!task) {
    task = fetchRemoteExtText(target)
      .then((result) => result || target)
      .catch(() => target);
    remoteExtCache.set(target, task);
  }

  return task;
}

export function clearTvBoxRuntimeCaches(): void {
  remoteExtCache.clear();
}
