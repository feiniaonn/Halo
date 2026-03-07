import { invoke } from "@tauri-apps/api/core";
import type {
  UpdaterCheckResult,
  UpdaterConfig,
  UpdaterEndpointProbeResult,
} from "../types/updater.types";

export async function updaterGetConfig(): Promise<UpdaterConfig> {
  return invoke<UpdaterConfig>("updater_get_config");
}

export async function updaterSetConfig(endpoint: string): Promise<void> {
  return invoke("updater_set_config", { endpoint });
}

export async function updaterCheck(): Promise<UpdaterCheckResult> {
  return invoke<UpdaterCheckResult>("updater_check");
}

export async function updaterDownloadAndInstall(): Promise<void> {
  return invoke("updater_download_and_install");
}

export async function updaterProbeEndpoint(
  endpoint?: string | null,
): Promise<UpdaterEndpointProbeResult> {
  return invoke<UpdaterEndpointProbeResult>("updater_probe_endpoint", {
    endpoint: endpoint ?? null,
  });
}
