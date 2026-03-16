import { invoke } from "@tauri-apps/api/core";

import { clearTvBoxRuntimeCaches } from "@/modules/media/services/tvboxRuntime";
import { clearVodImageProxyCache } from "@/modules/media/services/vodImageProxy";
import { clearVodSourceSelectionSnapshot } from "@/modules/media/services/vodSourceSelection";

const MEDIA_STORAGE_KEYS = [
  "halo_media_active_site_key",
];

interface MediaBootstrapPolicy {
  clearFrontendStorage: boolean;
  reason?: string | null;
}

declare global {
  interface Window {
    __haloMediaBootstrapPromise?: Promise<MediaBootstrapPolicy>;
  }
}

function clearMediaFrontendStorage() {
  for (const key of MEDIA_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
  clearVodSourceSelectionSnapshot();
  clearTvBoxRuntimeCaches();
  clearVodImageProxyCache();
}

export async function ensureMediaBootstrap(): Promise<MediaBootstrapPolicy> {
  if (typeof window === "undefined") {
    return { clearFrontendStorage: false, reason: null };
  }
  if (!window.__haloMediaBootstrapPromise) {
    window.__haloMediaBootstrapPromise = invoke<MediaBootstrapPolicy>("prepare_media_bootstrap")
      .then((policy) => {
        if (policy.clearFrontendStorage) {
          clearMediaFrontendStorage();
        }
        return policy;
      })
      .catch(() => ({ clearFrontendStorage: false, reason: null }));
  }
  return window.__haloMediaBootstrapPromise;
}
