import { invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";

export type StartupLogLevel = "info" | "warn" | "error";

export function reportStartupStep(step: string, level: StartupLogLevel = "info") {
  const message = `[startup] ${step}`;

  if (level === "error") {
    console.error(message);
  } else if (level === "warn") {
    console.warn(message);
  } else {
    console.log(message);
  }

  if (!isTauriRuntime()) {
    return;
  }

  void invoke("rust_log", { message, level }).catch(() => void 0);
}
