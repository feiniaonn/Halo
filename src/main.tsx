/* eslint-disable react-refresh/only-export-components */
import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { LivePlayerWindowPage as LivePlayerWindowPageStatic } from "@/pages/LivePlayerWindowPage";
import { LIVE_PLAYER_WINDOW_LABEL } from "@/modules/live/services/livePlayerWindow";
import { VodPlayerWindowPage as VodPlayerWindowPageStatic } from "@/pages/VodPlayerWindowPage";
import { VOD_PLAYER_WINDOW_LABEL } from "@/modules/media/services/vodPlayerWindow";
import { reportStartupStep } from "@/lib/startupLog";
import "./index.css";

const MainApp = App;
const LivePlayerWindowPage = import.meta.env.DEV
  ? LivePlayerWindowPageStatic
  : React.lazy(async () => {
    const mod = await import("@/pages/LivePlayerWindowPage");
    return { default: mod.LivePlayerWindowPage };
  });
const VodPlayerWindowPage = import.meta.env.DEV
  ? VodPlayerWindowPageStatic
  : React.lazy(async () => {
    const mod = await import("@/pages/VodPlayerWindowPage");
    return { default: mod.VodPlayerWindowPage };
  });

type StartupFallbackProps = {
  title: string;
  detail: string;
};

function StartupFallback({ title, detail }: StartupFallbackProps) {
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        margin: 0,
        padding: "18px",
        boxSizing: "border-box",
        overflow: "auto",
        background: "#f4f5f7",
        color: "#111827",
        fontFamily: "Segoe UI, PingFang SC, Microsoft YaHei, sans-serif",
      }}
    >
      <h2 style={{ margin: "0 0 10px", fontSize: "16px", fontWeight: 700 }}>{title}</h2>
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: "12px",
          lineHeight: 1.5,
          background: "#ffffff",
          border: "1px solid #d1d5db",
          borderRadius: "8px",
          padding: "12px",
        }}
      >
        {detail}
      </pre>
    </div>
  );
}

function StartupBlank() {
  return <div style={{ height: "100%", width: "100%", background: "transparent" }} />;
}

type WindowRole = "main" | typeof LIVE_PLAYER_WINDOW_LABEL | typeof VOD_PLAYER_WINDOW_LABEL;

function resolveWindowRoleFromUrl(): WindowRole {
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("window");
    if (value === LIVE_PLAYER_WINDOW_LABEL || value === VOD_PLAYER_WINDOW_LABEL) {
      return value;
    }
  } catch {
    // Ignore malformed URLs and fall back to Tauri label detection.
  }
  return "main";
}

type RootErrorBoundaryState = {
  error: Error | null;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[startup] React render crashed:", error, errorInfo.componentStack);
    reportStartupStep(
      `RootErrorBoundary caught render error: ${error.message}`,
      "error",
    );
  }

  render() {
    if (this.state.error) {
      const detail = [this.state.error.message, this.state.error.stack].filter(Boolean).join("\n\n");
      return <StartupFallback title="应用启动失败（渲染异常）" detail={detail || "Unknown render error"} />;
    }
    return this.props.children;
  }
}

function RuntimeGuardedApp() {
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null);
  const [windowRole, setWindowRole] = React.useState<WindowRole>(() => {
    const role = resolveWindowRoleFromUrl();
    reportStartupStep(`RuntimeGuardedApp initial role=${role} url=${window.location.search || "<none>"}`);
    return role;
  });

  React.useEffect(() => {
    reportStartupStep("RuntimeGuardedApp mounted");
  }, []);

  React.useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const parts = [
        event.message || "Unhandled window error",
        event.filename ? `file: ${event.filename}:${event.lineno}:${event.colno}` : "",
      ].filter(Boolean);
      const stack = event.error instanceof Error ? event.error.stack ?? "" : "";
      reportStartupStep(`window.onerror: ${parts.join(" | ")}`, "error");
      setRuntimeError([...parts, stack].filter(Boolean).join("\n"));
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error
        ? `${event.reason.message}\n${event.reason.stack ?? ""}`
        : String(event.reason);
      reportStartupStep(`unhandledrejection: ${reason}`, "error");
      setRuntimeError(`Unhandled promise rejection\n${reason}`);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  React.useEffect(() => {
    if (!import.meta.env.PROD) {
      return;
    }

    document.documentElement.classList.add("halo-prod");

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toUpperCase();
      const isDevtoolsShortcut = key === "F12"
        || ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === "I" || key === "J" || key === "C"));
      if (isDevtoolsShortcut) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown, true);
      document.documentElement.classList.remove("halo-prod");
    };
  }, []);

  React.useEffect(() => {
    if (!isTauriRuntime()) return;
    
    // Check URL first as it's the most reliable for our custom navigation
    const fromUrl = resolveWindowRoleFromUrl();
    reportStartupStep(`RuntimeGuardedApp effect role check urlRole=${fromUrl}`);
    if (fromUrl !== "main") {
      reportStartupStep(`RuntimeGuardedApp switching role from URL -> ${fromUrl}`);
      setWindowRole(fromUrl);
      return;
    }

    // Fallback to window label
    try {
      const label = getCurrentWindow().label;
      reportStartupStep(`RuntimeGuardedApp current window label=${label}`);
      if (label === LIVE_PLAYER_WINDOW_LABEL || label === VOD_PLAYER_WINDOW_LABEL) {
        reportStartupStep(`RuntimeGuardedApp switching role from label -> ${label}`);
        setWindowRole(label);
      }
    } catch (error) {
      console.error("[Runtime] Failed to read window label:", error);
      reportStartupStep(`RuntimeGuardedApp failed to read window label: ${String(error)}`, "warn");
    }
  }, []);

  if (runtimeError) {
    return <StartupFallback title="应用启动失败（运行时异常）" detail={runtimeError} />;
  }

  return (
    <RootErrorBoundary>
      <Suspense fallback={<StartupBlank />}>
        {windowRole === LIVE_PLAYER_WINDOW_LABEL ? (
          <LivePlayerWindowPage />
        ) : windowRole === VOD_PLAYER_WINDOW_LABEL ? (
          <VodPlayerWindowPage />
        ) : (
          <MainApp />
        )}
      </Suspense>
    </RootErrorBoundary>
  );
}

const startupNode = import.meta.env.DEV ? (
  <RuntimeGuardedApp />
) : (
  <React.StrictMode>
    <RuntimeGuardedApp />
  </React.StrictMode>
);

reportStartupStep("main.tsx before createRoot");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(startupNode);
reportStartupStep("main.tsx after createRoot.render");
window.requestAnimationFrame(() => {
  reportStartupStep("main.tsx first animation frame");
});
