import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  updaterCheck,
  updaterDownloadAndInstall,
  updaterGetConfig,
  updaterProbeEndpoint,
  updaterSetConfig,
} from "../services/updaterService";
import { reportRuntimeError } from "@/modules/shared/services/runtimeError";
import type {
  UpdaterCheckResult,
  UpdaterEndpointHealth,
  UpdaterStatus,
} from "../types/updater.types";

function toMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

function emitUpdateSignal(name: string, detail?: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export type UseUpdaterResult = {
  isTauri: boolean;
  endpoint: string;
  setEndpoint: (value: string) => void;
  endpointHealth: UpdaterEndpointHealth;
  currentVersion: string;
  status: UpdaterStatus;
  lastCheck: UpdaterCheckResult | null;
  saveEndpoint: () => Promise<void>;
  probeEndpoint: (value?: string) => Promise<void>;
  check: () => Promise<void>;
  checkAndPrompt: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  relaunch: () => Promise<void>;
};

export function useUpdater(): UseUpdaterResult {
  const isTauri = useMemo(() => isTauriRuntime(), []);

  const [endpoint, setEndpoint] = useState("");
  const endpointRef = useRef("");
  const [endpointHealth, setEndpointHealth] = useState<UpdaterEndpointHealth>({
    state: "idle",
  });
  const [currentVersion, setCurrentVersion] = useState("--");
  const [status, setStatus] = useState<UpdaterStatus>({ state: "idle" });
  const [lastCheck, setLastCheck] = useState<UpdaterCheckResult | null>(null);

  useEffect(() => {
    endpointRef.current = endpoint;
  }, [endpoint]);

  const probeEndpoint = useCallback(
    async (value?: string) => {
      if (!isTauri) return;

      const target = (value ?? endpointRef.current).trim();
      if (!target) {
        setEndpointHealth({ state: "error", message: "Updater endpoint is required." });
        return;
      }

      setEndpointHealth({ state: "checking" });
      try {
        const result = await updaterProbeEndpoint(target);
        if (result.reachable) {
          setEndpointHealth({ state: "ok", result });
          return;
        }

        setEndpointHealth({
          state: "error",
          result,
          message: result.message ?? "Updater endpoint is not reachable.",
        });
      } catch (error) {
        reportRuntimeError({
          title: "Failed to probe updater endpoint",
          summary: "Updater endpoint health check failed.",
          error,
          source: "updater.probe",
        });
        setEndpointHealth({ state: "error", message: toMessage(error) });
      }
    },
    [isTauri],
  );

  const load = useCallback(async () => {
    if (!isTauri) return;

    try {
      const cfg = await updaterGetConfig();
      setEndpoint(cfg.endpoint);
      if (cfg.endpoint.trim()) {
        void probeEndpoint(cfg.endpoint);
      }
    } catch (error) {
      reportRuntimeError({
        title: "Failed to load updater settings",
        summary: "Updater configuration could not be loaded.",
        error,
        source: "updater.load-config",
      });
      setEndpointHealth({ state: "idle" });
    }

    try {
      setCurrentVersion(await getVersion());
    } catch {
      setCurrentVersion("--");
    }
  }, [isTauri, probeEndpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isTauri) return;

    let unlistenDownload: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;

    void (async () => {
      try {
        unlistenDownload = await listen<{
          chunkLength: number;
          contentLength: number | null;
        }>("updater:download", (event) => {
          setStatus((current) => {
            if (current.state !== "downloading") return current;
            return {
              state: "downloading",
              downloaded: current.downloaded + (event.payload?.chunkLength ?? 0),
              total: event.payload?.contentLength ?? current.total,
            };
          });
        });

        unlistenStatus = await listen<{ state: string }>("updater:status", (event) => {
          const nextState = event.payload?.state;
          if (nextState === "downloading") {
            setStatus({ state: "downloading", downloaded: 0, total: null });
          } else if (nextState === "downloaded") {
            setStatus({ state: "downloaded" });
          } else if (nextState === "installed") {
            setStatus({ state: "installed" });
          }
        });
      } catch (error) {
        reportRuntimeError({
          title: "Failed to initialize updater listeners",
          summary: "Updater progress listeners could not be attached.",
          error,
          source: "updater.listeners",
        });
      }
    })();

    return () => {
      unlistenDownload?.();
      unlistenStatus?.();
    };
  }, [isTauri]);

  const saveEndpoint = useCallback(async () => {
    if (!isTauri) return;

    const next = endpoint.trim();
    if (!next) {
      setEndpointHealth({ state: "error", message: "Updater endpoint is required." });
      return;
    }

    try {
      await updaterSetConfig(next);
      const cfg = await updaterGetConfig();
      setEndpoint(cfg.endpoint);
      setStatus({ state: "idle" });
      await probeEndpoint(cfg.endpoint);
    } catch (error) {
      reportRuntimeError({
        title: "Failed to save updater endpoint",
        summary: "Updater endpoint could not be saved.",
        error,
        source: "updater.save-config",
      });
      setStatus({ state: "error", message: toMessage(error) });
    }
  }, [endpoint, isTauri, probeEndpoint]);

  const check = useCallback(async () => {
    if (!isTauri) return;

    try {
      setStatus({ state: "checking" });
      const result = await updaterCheck();
      setLastCheck(result);

      if (result.available) {
        setStatus({ state: "available", result });
        emitUpdateSignal("halo:update-available", result);
      } else {
        setStatus({ state: "up_to_date" });
        emitUpdateSignal("halo:update-up-to-date", result);
      }
    } catch (error) {
      const message = toMessage(error);
      reportRuntimeError({
        title: "Failed to check for updates",
        summary: "Updater check failed.",
        error,
        source: "updater.check",
      });
      setStatus({
        state: "error",
        message:
          message === "check_failed"
            ? "Update check failed. Verify the endpoint and network connection."
            : message,
      });
      emitUpdateSignal("halo:update-check-failed", { message });
    }
  }, [isTauri]);

  const checkAndPrompt = useCallback(async () => {
    await check();
  }, [check]);

  const downloadAndInstall = useCallback(async () => {
    if (!isTauri) return;

    try {
      if (!lastCheck?.available) {
        setStatus({ state: "checking" });
        const checkResult = await updaterCheck();
        setLastCheck(checkResult);

        if (!checkResult.available) {
          setStatus({ state: "up_to_date" });
          emitUpdateSignal("halo:update-up-to-date", checkResult);
          return;
        }

        setStatus({ state: "available", result: checkResult });
        emitUpdateSignal("halo:update-available", checkResult);
      }

      setStatus({ state: "downloading", downloaded: 0, total: null });
      await updaterDownloadAndInstall();
    } catch (error) {
      const message = toMessage(error);
      if (message === "no_update") {
        setStatus({ state: "up_to_date" });
      } else {
        reportRuntimeError({
          title: "Failed to install update",
          summary: "Updater download or install failed.",
          error,
          source: "updater.install",
        });
        setStatus({ state: "error", message });
      }
    }
  }, [isTauri, lastCheck]);

  const relaunch = useCallback(async () => {
    if (!isTauri) return;
  }, [isTauri]);

  return {
    isTauri,
    endpoint,
    setEndpoint,
    endpointHealth,
    currentVersion,
    status,
    lastCheck,
    saveEndpoint,
    probeEndpoint,
    check,
    checkAndPrompt,
    downloadAndInstall,
    relaunch,
  };
}

