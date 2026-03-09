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
        setEndpointHealth({ state: "error", message: "更新源不能为空" });
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
          message: result.message ?? "更新源不可访问",
        });
      } catch (error) {
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
    } catch {
      setEndpointHealth({ state: "idle" });
    }

    try {
      setCurrentVersion(await getVersion());
    } catch {
      setCurrentVersion("--");
    }
  }, [isTauri, probeEndpoint]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      } catch {
        void 0;
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
    } catch (error) {
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
      setStatus({
        state: "error",
        message:
          message === "检查失败"
            ? "检查更新失败，请确认更新源地址和网络连接是否可用。"
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
      // Skip re-checking if we already know an update is available.
      // The Rust side reuses its cached manifest (60 s TTL) so no extra
      // network request is needed in the common check → install flow.
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

      // 安装阶段由 Rust 侧负责下载（含自动重试）、调用安装器并退出当前进程。
      // 这里不能再次重启旧进程，否则会复现双进程或错误路径问题。
      await updaterDownloadAndInstall();
    } catch (error) {
      const message = toMessage(error);
      if (message === "no_update") {
        setStatus({ state: "up_to_date" });
      } else {
        setStatus({ state: "error", message });
      }
    }
  }, [isTauri, lastCheck]);

  const relaunch = useCallback(async () => {
    // 当前更新流程不需要前端主动重启，保留签名避免影响现有调用方。
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
