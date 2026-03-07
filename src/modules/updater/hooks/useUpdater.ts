import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { relaunch as relaunchApp } from "@tauri-apps/plugin-process";
import type {
  UpdaterCheckResult,
  UpdaterEndpointHealth,
  UpdaterStatus,
} from "../types/updater.types";
import {
  updaterCheck,
  updaterDownloadAndInstall,
  updaterGetConfig,
  updaterProbeEndpoint,
  updaterSetConfig,
} from "../services/updaterService";

function toMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "未知错误";
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

  const [endpoint, setEndpoint] = useState<string>("");
  const endpointRef = useRef("");
  const [endpointHealth, setEndpointHealth] = useState<UpdaterEndpointHealth>({ state: "idle" });
  const [currentVersion, setCurrentVersion] = useState<string>("--");
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
        setEndpointHealth({ state: "error", message: "更新源不能为空" });
        return;
      }

      setEndpointHealth({ state: "checking" });
      try {
        const result = await updaterProbeEndpoint(target);
        if (result.reachable) {
          setEndpointHealth({ state: "ok", result });
        } else {
          setEndpointHealth({
            state: "error",
            result,
            message: result.message ?? "更新源不可访问",
          });
        }
      } catch (e) {
        setEndpointHealth({ state: "error", message: toMessage(e) });
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
      } else {
        setEndpointHealth({ state: "idle" });
      }
    } catch {
      // ignore
    }

    try {
      setCurrentVersion(await getVersion());
    } catch {
      // ignore
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
        unlistenDownload = await listen<{ chunkLength: number; contentLength: number | null }>(
          "updater:download",
          (e) => {
            setStatus((s) => {
              if (s.state !== "downloading") return s;
              const downloaded = s.downloaded + (e.payload?.chunkLength ?? 0);
              const total = e.payload?.contentLength ?? s.total;
              return { state: "downloading", downloaded, total };
            });
          },
        );
        unlistenStatus = await listen<{ state: string }>("updater:status", (e) => {
          const eventState = e.payload?.state;
          if (eventState === "downloading") {
            setStatus({ state: "downloading", downloaded: 0, total: null });
          } else if (eventState === "downloaded") {
            setStatus({ state: "downloaded" });
          } else if (eventState === "installed") {
            setStatus({ state: "installed" });
          }
        });
      } catch {
        // ignore
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
      setEndpointHealth({ state: "error", message: "更新源不能为空" });
      return;
    }

    try {
      await updaterSetConfig(next);
      const cfg = await updaterGetConfig();
      setEndpoint(cfg.endpoint);
      setStatus({ state: "idle" });
      await probeEndpoint(cfg.endpoint);
    } catch (e) {
      setStatus({ state: "error", message: toMessage(e) });
    }
  }, [endpoint, isTauri, probeEndpoint]);

  const check = useCallback(async () => {
    if (!isTauri) return;
    try {
      setStatus({ state: "checking" });
      const res = await updaterCheck();
      setLastCheck(res);
      if (res.available) {
        setStatus({ state: "available", result: res });
        emitUpdateSignal("halo:update-available", res);
      } else {
        setStatus({ state: "up_to_date" });
        emitUpdateSignal("halo:update-up-to-date", res);
      }
    } catch (e) {
      const msg = toMessage(e);
      setStatus({
        state: "error",
        message: msg === "检查失败" ? "检查更新失败，可确认更新源是否可访问。" : msg,
      });
      emitUpdateSignal("halo:update-check-failed", { message: msg });
    }
  }, [isTauri]);

  const checkAndPrompt = useCallback(async () => {
    await check();
  }, [check]);

  const downloadAndInstall = useCallback(async () => {
    if (!isTauri) return;
    try {
      const checkResult = await updaterCheck();
      setLastCheck(checkResult);
      if (!checkResult.available) {
        setStatus({ state: "up_to_date" });
        emitUpdateSignal("halo:update-up-to-date", checkResult);
        return;
      }
      setStatus({ state: "available", result: checkResult });
      emitUpdateSignal("halo:update-available", checkResult);
      setStatus({ state: "downloading", downloaded: 0, total: null });
      await updaterDownloadAndInstall();
      // Auto relaunch after 3 seconds
      setTimeout(() => {
        void relaunchApp().catch(() => {
          setStatus({ state: "error", message: "自动重启失败，请手动重启应用" });
        });
      }, 3000);
    } catch (e) {
      const msg = toMessage(e);
      if (msg === "no_update") {
        setStatus({ state: "up_to_date" });
      } else {
        setStatus({ state: "error", message: msg });
      }
    }
  }, [isTauri]);

  const relaunch = useCallback(async () => {
    if (!isTauri) return;
    try {
      await relaunchApp();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "重启失败" });
    }
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
