import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";
import { clampPercent, formatBytes, formatUptime } from "@/lib/formatters";
import { normalizeImportedPath } from "@/lib/pathUtils";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { useSystemOverview } from "@/modules/dashboard";
import { Card } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface Shortcut {
  id: string;
  name: string;
  path: string;
  order: number;
  pinned?: boolean;
  iconDataUrl?: string;
  iconCacheKey?: string;
}

type ShortcutFileFingerprint = {
  key: string;
  path: string;
  size: number;
  modified_ms: number;
};

type ShortcutIconCacheEntry = {
  iconDataUrl: string;
  updatedAt: number;
};

type ShortcutIconCache = Record<string, ShortcutIconCacheEntry>;

const SHORTCUT_ICON_CACHE_KEY = "halo_shortcut_icon_cache_v2";
const SHORTCUT_ICON_CACHE_MAX_ENTRIES = 500;

const defaultLinks = [
  { id: "media", title: "媒体", desc: "单仓点播与直播", href: "#" },
  { id: "music", title: "音乐", desc: "本地播放与播放记录", href: "#" },
] as const;

type Page = "dashboard" | "media" | "music" | "settings";

function loadShortcutIconCache(): ShortcutIconCache {
  const raw = localStorage.getItem(SHORTCUT_ICON_CACHE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as ShortcutIconCache;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function trimShortcutIconCache(cache: ShortcutIconCache): ShortcutIconCache {
  const entries = Object.entries(cache);
  if (entries.length <= SHORTCUT_ICON_CACHE_MAX_ENTRIES) return cache;
  entries.sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0));
  return Object.fromEntries(entries.slice(0, SHORTCUT_ICON_CACHE_MAX_ENTRIES));
}

function sortShortcuts(items: Shortcut[]): Shortcut[] {
  return [...items].sort((a, b) => {
    if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) {
      return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    }
    return a.order - b.order;
  });
}

function nextOrder(items: Shortcut[]): number {
  const maxOrder = items.reduce((acc, item) => Math.max(acc, item.order), -1);
  return maxOrder + 1;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 350,
      damping: 25,
    },
  },
};

export function HomePage({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(() => {
    const saved = localStorage.getItem("halo_shortcuts");
    if (!saved) return [];
    try {
      type PersistedShortcut = {
        id?: string;
        name?: string;
        path?: string;
        order?: number;
        pinned?: boolean;
      };
      const parsed = JSON.parse(saved) as PersistedShortcut[] | null;
      if (!Array.isArray(parsed)) return [];
      const normalized = parsed
        .filter((s) => typeof s?.path === "string" && typeof s?.name === "string")
        .map((s, index) => {
          const normalizedPath = normalizeImportedPath(s.path as string);
          const name = s.name as string;
          return {
            id: typeof s.id === "string" ? s.id : crypto.randomUUID(),
            name,
            path: normalizedPath,
            order: typeof s.order === "number" ? s.order : index,
            pinned: !!s.pinned,
          };
        });
      return sortShortcuts(normalized);
    } catch {
      return [];
    }
  });
  const [dragOver, setDragOver] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingShortcutId, setDraggingShortcutId] = useState<string | null>(null);
  const [dragOverShortcutId, setDragOverShortcutId] = useState<string | null>(null);
  const attemptedIconFixRef = useRef<Set<string>>(new Set());
  const iconCacheRef = useRef<ShortcutIconCache>(loadShortcutIconCache());
  const { systemOverview, systemLoading, systemError, lastUpdated } = useSystemOverview();

  const persistIconCache = useCallback(() => {
    iconCacheRef.current = trimShortcutIconCache(iconCacheRef.current);
    localStorage.setItem(SHORTCUT_ICON_CACHE_KEY, JSON.stringify(iconCacheRef.current));
  }, []);

  const getShortcutFingerprint = useCallback(async (path: string) => {
    const normalizedPath = normalizeImportedPath(path);
    try {
      return await invoke<ShortcutFileFingerprint>("shortcut_get_file_fingerprint", {
        path: normalizedPath,
      });
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const persistedShortcuts = shortcuts.map((shortcut) => ({
      id: shortcut.id,
      name: shortcut.name,
      path: shortcut.path,
      order: shortcut.order,
      pinned: !!shortcut.pinned,
    }));
    localStorage.setItem("halo_shortcuts", JSON.stringify(persistedShortcuts));
  }, [shortcuts]);

  useEffect(() => {
    let unlistenDrop: (() => void) | undefined;
    let unlistenEnter: (() => void) | undefined;
    let unlistenLeave: (() => void) | undefined;

    if (!isTauri()) return;
    (async () => {
      unlistenDrop = await listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
        setDragOver(false);
        const paths = event.payload?.paths ?? [];

        for (const path of paths) {
          const normalizedPath = normalizeImportedPath(path);
          const lower = normalizedPath.toLowerCase();
          if (!lower.endsWith(".exe") && !lower.endsWith(".lnk")) continue;

          const name = normalizedPath.split("\\").pop()?.replace(/\.(exe|lnk)$/i, "") || "应用";

          setShortcuts((prev) => {
            if (prev.some((s) => s.path === normalizedPath)) return prev;
            const next = [
              ...prev,
              {
                id: crypto.randomUUID(),
                name,
                path: normalizedPath,
                order: nextOrder(prev),
                pinned: false,
              },
            ];
            return sortShortcuts(next);
          });
        }
      });

      unlistenEnter = await listen("tauri://drag-enter", () => setDragOver(true));
      unlistenLeave = await listen("tauri://drag-leave", () => setDragOver(false));
    })();

    return () => {
      unlistenDrop?.();
      unlistenEnter?.();
      unlistenLeave?.();
    };
  }, []);



  useEffect(() => {
    if (shortcuts.length === 0) return;
    const missing = shortcuts.filter((s) => !s.iconDataUrl);
    if (missing.length === 0) return;
    let canceled = false;

    void (async () => {
      for (const s of missing) {
        if (canceled) return;
        if (attemptedIconFixRef.current.has(s.id)) continue;
        attemptedIconFixRef.current.add(s.id);
        const normalizedPath = normalizeImportedPath(s.path);
        let cacheKey: string | undefined;

        const fingerprint = await getShortcutFingerprint(normalizedPath);
        if (fingerprint?.key) {
          cacheKey = fingerprint.key;
          const cached = iconCacheRef.current[cacheKey];
          if (cached?.iconDataUrl) {
            setShortcuts((prev) =>
              prev.map((p) =>
                p.id === s.id
                  ? { ...p, iconDataUrl: cached.iconDataUrl, iconCacheKey: cacheKey }
                  : p,
              ),
            );
            continue;
          }
        }

        try {
          const extracted = await invoke<string>("extract_icon_data_url", {
            filePath: normalizedPath,
          });
          if (!extracted) continue;
          if (canceled) return;

          setShortcuts((prev) =>
            prev.map((p) =>
              p.id === s.id
                ? { ...p, iconDataUrl: extracted, iconCacheKey: cacheKey }
                : p,
            ),
          );
          if (cacheKey) {
            iconCacheRef.current[cacheKey] = {
              iconDataUrl: extracted,
              updatedAt: Date.now(),
            };
            persistIconCache();
          }
        } catch {
          // ignore
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [getShortcutFingerprint, persistIconCache, shortcuts]);

  const handleLaunch = async (path: string) => {
    const normalizedPath = normalizeImportedPath(path);
    try {
      await invoke("launch_path", { path: normalizedPath });
    } catch (e) {
      console.error("Failed to launch:", normalizedPath, e);
      try {
        await message(`\u65e0\u6cd5\u542f\u52a8\u5e94\u7528\uff1a${normalizedPath}\n\u9519\u8bef\uff1a${String(e)}`, { kind: "error" });
      } catch {
        void 0;
      }
    }
  };

  const handleRefreshIcon = useCallback(
    async (id: string, event?: React.MouseEvent) => {
      event?.stopPropagation();
      const target = shortcuts.find((s) => s.id === id);
      if (!target) return;

      attemptedIconFixRef.current.delete(id);
      setShortcuts((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, iconDataUrl: undefined, iconCacheKey: undefined } : s,
        ),
      );

      const normalizedPath = normalizeImportedPath(target.path);
      const fingerprint = await getShortcutFingerprint(normalizedPath);
      const cacheKey = fingerprint?.key;
      if (cacheKey && iconCacheRef.current[cacheKey]) {
        delete iconCacheRef.current[cacheKey];
        persistIconCache();
      }

      try {
        const extracted = await invoke<string>("extract_icon_data_url", {
          filePath: normalizedPath,
        });
        if (!extracted) {
          throw new Error("图标提取失败");
        }

        setShortcuts((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, iconDataUrl: extracted, iconCacheKey: cacheKey } : s,
          ),
        );
        if (cacheKey) {
          iconCacheRef.current[cacheKey] = {
            iconDataUrl: extracted,
            updatedAt: Date.now(),
          };
          persistIconCache();
        }
      } catch (e) {
        try {
          await message(`图标刷新失败：${String(e)}`, { kind: "warning" });
        } catch {
          void 0;
        }
      }
    },
    [getShortcutFingerprint, persistIconCache, shortcuts],
  );

  const setShortcutPinned = useCallback((id: string, pinned: boolean) => {
    setShortcuts((prev) =>
      sortShortcuts(
        prev.map((item) => (item.id === id ? { ...item, pinned } : item)),
      ),
    );
  }, []);

  const renameShortcut = useCallback((id: string) => {
    const current = shortcuts.find((item) => item.id === id);
    if (!current) return;
    const nextName = window.prompt("请输入新的快捷方式名称", current.name);
    if (!nextName) return;
    const normalized = nextName.trim();
    if (!normalized) return;
    setShortcuts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, name: normalized } : item)),
    );
  }, [shortcuts]);

  const openShortcutLocation = useCallback(async (id: string) => {
    const current = shortcuts.find((item) => item.id === id);
    if (!current) return;
    try {
      await invoke("reveal_path", { path: normalizeImportedPath(current.path) });
    } catch (e) {
      await message(`无法打开文件位置：${String(e)}`, { kind: "error" });
    }
  }, [shortcuts]);

  const moveShortcutByDrop = useCallback((dragId: string, targetId: string | null) => {
    if (!dragId) return;
    setShortcuts((prev) => {
      const moving = prev.find((item) => item.id === dragId);
      if (!moving) return prev;

      const rest = sortShortcuts(prev.filter((item) => item.id !== dragId));
      const insertAt = targetId
        ? rest.findIndex((item) => item.id === targetId)
        : rest.length;
      const actualIndex = insertAt < 0 ? rest.length : insertAt;

      const reordered = [...rest];
      reordered.splice(actualIndex, 0, {
        ...moving,
        order: 0,
      });

      const normalized = reordered.map((item, idx) => ({
        ...item,
        order: idx,
      }));
      return sortShortcuts(normalized);
    });
  }, []);

  const removeShortcut = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    attemptedIconFixRef.current.delete(id);
    setSelectedId((prev) => (prev === id ? null : prev));
    setShortcuts((prev) => prev.filter((s) => s.id !== id));
  };

  const cpuPercent = clampPercent(systemOverview?.cpuUsage ?? 0);
  const memoryPercent = clampPercent(
    systemOverview && systemOverview.memoryTotalBytes > 0
      ? (systemOverview.memoryUsedBytes / systemOverview.memoryTotalBytes) * 100
      : 0,
  );
  const diskPercent = clampPercent(
    systemOverview && systemOverview.diskTotalBytes > 0
      ? (systemOverview.diskUsedBytes / systemOverview.diskTotalBytes) * 100
      : 0,
  );
  const gpuPercent = systemOverview?.gpuUsage == null ? null : clampPercent(systemOverview.gpuUsage);
  const appCpuPercent =
    systemOverview?.appCpuUsage == null ? null : clampPercent(systemOverview.appCpuUsage);
  const appMemoryPercent =
    systemOverview &&
    systemOverview.memoryTotalBytes > 0 &&
    systemOverview.appMemoryUsedBytes != null
      ? clampPercent((systemOverview.appMemoryUsedBytes / systemOverview.memoryTotalBytes) * 100)
      : null;
  const appGpuPercent =
    systemOverview?.appGpuUsage == null ? null : clampPercent(systemOverview.appGpuUsage);
  const osLabel = [systemOverview?.osName, systemOverview?.osVersion].filter(Boolean).join(" ") || "\u672a\u77e5\u7cfb\u7edf";
  const shortcutsList = sortShortcuts(shortcuts);

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 pt-1 pb-10 relative">


      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="shrink-0 flex items-center justify-between px-1"
      >
        <div>
          <h1 className="text-[32px] sm:text-[40px] font-black tracking-tight bg-gradient-to-br from-foreground via-foreground/90 to-foreground/50 bg-clip-text text-transparent drop-shadow-sm">
            欢迎使用 Halo
          </h1>
          <p className="mt-2 text-[14px] font-medium tracking-wide text-muted-foreground/80 bg-muted/30 inline-block px-3 py-1 rounded-full border border-white/5 backdrop-blur-sm">
            你的极简高效桌面数字中枢
          </p>
        </div>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-6"
      >
        <motion.section variants={itemVariants} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {defaultLinks.map((item) => (
            <Card
              key={item.id}
              onClick={() => onNavigate?.(item.id as Page)}
              className={cn(
                "glass-card border-none flex min-h-[196px] flex-col gap-4 p-7 relative overflow-hidden group",
                "cursor-pointer transition-transform duration-400 hover:-translate-y-1 shadow-[0_8px_32px_rgba(0,0,0,0.06)] hover:shadow-lg",
              )}
            >
              <div className="relative z-10 flex flex-col h-full bg-transparent">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-110 transition-all duration-300 shadow-sm">
                    {item.id === "media" ? (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="7" width="20" height="15" rx="2" ry="2" /><polyline points="17 2 12 7 7 2" /></svg>
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                    )}
                  </div>
                </div>
                <div>
                  <h2 className="text-[19px] font-bold tracking-tight text-foreground/90 group-hover:text-primary transition-colors">{item.title}</h2>
                  <p className="mt-1.5 text-[14px] text-muted-foreground/80 font-medium tracking-wide">{item.desc}</p>
                </div>
                <div className="mt-auto flex items-center pt-2 overflow-hidden">
                  <span className="text-[13px] font-bold text-primary opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 flex items-center gap-1">
                    进入探索 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </motion.section>

        <motion.section variants={itemVariants}>
          <Card
            className={cn(
              "glass-card border-none relative overflow-hidden rounded-3xl p-6 transition-all duration-300",
              dragOver && "scale-[1.01] border-dashed border-primary/60 bg-primary/5 shadow-[0_0_30px_rgba(var(--primary),0.15)_inset]",
            )}
          >
            <div className="mb-5 flex items-center justify-between px-1">
              <div className="flex items-center gap-2.5">
                <div className="flex bg-primary/10 p-2 rounded-xl text-primary">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="2" y="3" width="20" height="14" rx="3" ry="3" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <h2 className="text-[17px] font-semibold tracking-tight">{"\u5feb\u6377\u542f\u52a8\u680f"}</h2>
              </div>
              <span className="text-[13px] text-muted-foreground hidden sm:block">{"\u62d6\u5165 EXE/LNK \u6dfb\u52a0\uff0c\u53f3\u952e\u6216 \u21bb \u53ef\u5237\u65b0\u56fe\u6807"}</span>
            </div>

            {shortcuts.length === 0 ? (
              <div className="flex min-h-[130px] flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/5 dark:border-white/10 bg-black/5 dark:bg-white/5 p-4 text-[14px] text-muted-foreground/60 transition-colors hover:border-black/10 dark:hover:border-white/20">
                <p className="font-medium text-muted-foreground">{"\u6682\u65e0\u5feb\u6377\u65b9\u5f0f"}</p>
                <p className="mt-1.5 text-[13px]">{"\u8bf7\u5c06\u684c\u9762\u4e0a\u7684\u5e94\u7528\u62d6\u62fd\u81f3\u6b64"}</p>
              </div>
            ) : (
              <div
                className="rounded-2xl border border-black/5 dark:border-white/10 bg-white/30 dark:bg-black/20 p-4 transition-colors"
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const dragId = e.dataTransfer.getData("text/shortcut-id") || draggingShortcutId;
                  if (dragId) {
                    moveShortcutByDrop(dragId, null);
                  }
                  setDraggingShortcutId(null);
                  setDragOverShortcutId(null);
                }}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <div className="text-[13px] font-medium text-foreground/75">{"\u5df2\u6dfb\u52a0\u5feb\u6377\u65b9\u5f0f"}</div>
                  <div className="text-[12px] font-medium text-muted-foreground bg-black/5 dark:bg-white/10 px-2 py-0.5 rounded-full">
                    {shortcutsList.length}
                  </div>
                </div>
                <div className="flex min-h-[96px] flex-wrap gap-x-2 gap-y-3">
                  <AnimatePresence>
                    {shortcutsList.map((app) => (
                      <ContextMenu key={app.id}>
                        <ContextMenuTrigger asChild>
                          <motion.div
                            layout
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            draggable
                            onDragStart={(e: any) => {
                              setDraggingShortcutId(app.id);
                              e.dataTransfer.setData("text/shortcut-id", app.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              setDraggingShortcutId(null);
                              setDragOverShortcutId(null);
                            }}
                            onDragOver={(e: any) => {
                              e.preventDefault();
                              setDragOverShortcutId(app.id);
                            }}
                            onDrop={(e: any) => {
                              e.preventDefault();
                              const dragId =
                                e.dataTransfer.getData("text/shortcut-id") || draggingShortcutId;
                              if (dragId && dragId !== app.id) {
                                moveShortcutByDrop(dragId, app.id);
                              }
                              setDraggingShortcutId(null);
                              setDragOverShortcutId(null);
                            }}
                            className={cn(
                              "group relative flex w-[84px] cursor-pointer flex-col items-center gap-2.5 rounded-2xl p-2.5 transition-all duration-200",
                              "hover:bg-white/50 dark:hover:bg-white/10 hover:shadow-sm",
                              selectedId === app.id && "bg-white/50 dark:bg-white/10 ring-2 ring-primary/40",
                              dragOverShortcutId === app.id && draggingShortcutId !== app.id && "ring-2 ring-primary/70 bg-primary/5",
                            )}
                            onClick={() => setSelectedId(app.id)}
                            onDoubleClick={() => handleLaunch(app.path)}
                            title={app.path}
                          >
                            <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-white/60 dark:bg-white/5 shadow-sm ring-1 ring-black/5 dark:ring-white/10 transition-transform duration-300 group-hover:scale-110 group-active:scale-95 group-hover:shadow-[0_8px_16px_rgba(0,0,0,0.08)]">
                              {app.iconDataUrl ? (
                                <img
                                  src={app.iconDataUrl}
                                  alt={app.name}
                                  className="h-[65%] w-[65%] object-contain drop-shadow-sm"
                                  onError={() => {
                                    if (app.iconCacheKey && iconCacheRef.current[app.iconCacheKey]) {
                                      delete iconCacheRef.current[app.iconCacheKey];
                                      persistIconCache();
                                    }
                                    setShortcuts((prev) =>
                                      prev.map((p) =>
                                        p.id === app.id
                                          ? { ...p, iconDataUrl: undefined, iconCacheKey: undefined }
                                          : p,
                                      ),
                                    );
                                    attemptedIconFixRef.current.delete(app.id);
                                  }}
                                />
                              ) : (
                                <span className="text-2xl font-bold tracking-tight text-muted-foreground/60">{app.name[0]}</span>
                              )}
                            </div>
                            <span className="w-full truncate px-1 text-center text-[12px] font-medium leading-tight">{app.name}</span>
                            {app.pinned && (
                              <span className="absolute -left-1 -top-1 rounded-full bg-primary p-1 shadow-md text-white">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M16 12l0 6 2 0 0 2 -12 0 0 -2 2 0 0 -6 -2 -3 0 -2 12 0 0 2 -2 3z" />
                                </svg>
                              </span>
                            )}

                            <button
                              onClick={(e) => {
                                void handleRefreshIcon(app.id, e);
                              }}
                              title={"\u5237\u65b0\u56fe\u6807"}
                              className="absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/95 ring-1 ring-border text-foreground opacity-0 shadow-md backdrop-blur transition-all duration-200 group-hover:opacity-100 hover:scale-110 hover:text-primary"
                            >
                              {"\u21bb"}
                            </button>
                          </motion.div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-48 bg-background/95 backdrop-blur-xl border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.12)]">
                          <ContextMenuItem onSelect={() => renameShortcut(app.id)}>
                            {"\u91cd\u547d\u540d"}
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => openShortcutLocation(app.id)}>
                            {"\u6253\u5f00\u6587\u4ef6\u4f4d\u7f6e"}
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={(e) => handleRefreshIcon(app.id, e as any)}>
                            {"\u5237\u65b0\u56fe\u6807"}
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => setShortcutPinned(app.id, !app.pinned)}>
                            {app.pinned ? "\u53d6\u6d88\u56fa\u5b9a" : "\u56fa\u5b9a\u5230\u9876\u90e8"}
                          </ContextMenuItem>
                          <ContextMenuSeparator className="bg-white/10" />
                          <ContextMenuItem
                            className="text-red-500 focus:text-red-50 focus:bg-red-500/80"
                            onSelect={() => removeShortcut(app.id)}
                          >
                            {"\u79fb\u9664"}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </Card>
        </motion.section>

        <motion.section variants={itemVariants}>
          <Card className="glass-card border-none rounded-3xl p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

            <div className="mb-6 flex items-center justify-between gap-2 px-1 relative z-10">
              <div className="flex items-center gap-2.5">
                <div className="flex bg-primary/10 p-2 rounded-xl text-primary">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
                    <polyline points="7.5 19.79 7.5 14.6 3 12" />
                    <polyline points="21 12 16.5 14.6 16.5 19.79" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                </div>
                <h2 className="text-[17px] font-semibold tracking-tight">{"\u7cfb\u7edf\u6982\u89c8"}</h2>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-medium text-muted-foreground bg-black/5 dark:bg-white/10 px-3 py-1.5 rounded-xl backdrop-blur-sm">
                  {!systemLoading && systemOverview ? osLabel : "--"}
                  <span className="mx-2 text-black/20 dark:text-white/20">|</span>
                  {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "--"}
                </div>
              </div>
            </div>

            {systemLoading && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 relative z-10">
                <div className="h-28 animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
                <div className="h-28 animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
                <div className="h-28 animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
              </div>
            )}

            {!systemLoading && systemError && !systemOverview && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-[14px] font-medium text-red-600 relative z-10">
                {systemError}
              </div>
            )}

            {systemOverview && (
              <div className="space-y-5 relative z-10">
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="glass-card border-none p-5 lg:col-span-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
                          系统运行时间
                        </div>
                        <div className="mt-2 text-[34px] md:text-[40px] font-black tracking-tighter text-foreground/90 leading-none">
                          {formatUptime(systemOverview.uptimeSecs)}
                        </div>
                      </div>
                      <div className="text-right text-[12px] text-muted-foreground">
                        <div>系统数据每秒刷新</div>
                        <div>运行时间每分钟刷新</div>
                      </div>
                    </div>
                  </Card>

                  <Card className="glass-card border-none p-5">
                    <div className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
                      设备信息
                    </div>
                    <div className="mt-3 text-[16px] font-bold truncate" title={systemOverview.hostName ?? "未知设备"}>
                      {systemOverview.hostName ?? "未知设备"}
                    </div>
                    <div className="mt-2 text-[12px] text-muted-foreground">{osLabel}</div>
                    <div className="mt-2 text-[12px] text-muted-foreground">
                      更新时间: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "--"}
                    </div>
                  </Card>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-foreground/90">系统资源占用</h3>
                    <span className="text-[12px] text-muted-foreground">CPU / 内存 / 磁盘 / GPU</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <Card className="glass-card border-none p-4">
                      <div className="flex items-center justify-between text-[13px] font-semibold">
                        <span>CPU</span>
                        <span className="text-blue-600 dark:text-blue-400">{cpuPercent.toFixed(0)}%</span>
                      </div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-500" style={{ width: `${cpuPercent}%` }} />
                      </div>
                    </Card>

                    <Card className="glass-card border-none p-4">
                      <div className="flex items-center justify-between text-[13px] font-semibold">
                        <span>内存</span>
                        <span className="text-violet-600 dark:text-violet-400">{memoryPercent.toFixed(0)}%</span>
                      </div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-violet-600 transition-all duration-500" style={{ width: `${memoryPercent}%` }} />
                      </div>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        {formatBytes(systemOverview.memoryUsedBytes)} / {formatBytes(systemOverview.memoryTotalBytes)}
                      </div>
                    </Card>

                    <Card className="glass-card border-none p-4">
                      <div className="flex items-center justify-between text-[13px] font-semibold">
                        <span>磁盘</span>
                        <span className="text-emerald-600 dark:text-emerald-400">{diskPercent.toFixed(0)}%</span>
                      </div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500" style={{ width: `${diskPercent}%` }} />
                      </div>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        {formatBytes(systemOverview.diskUsedBytes)} / {formatBytes(systemOverview.diskTotalBytes)}
                      </div>
                    </Card>

                    <Card className="glass-card border-none p-4">
                      <div className="flex items-center justify-between text-[13px] font-semibold">
                        <span>GPU</span>
                        <span className="text-amber-600 dark:text-amber-400">
                          {gpuPercent == null ? "--" : `${gpuPercent.toFixed(0)}%`}
                        </span>
                      </div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-500" style={{ width: `${gpuPercent ?? 0}%` }} />
                      </div>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        {systemOverview.gpuMemoryUsedBytes != null && systemOverview.gpuMemoryTotalBytes != null
                          ? `${formatBytes(systemOverview.gpuMemoryUsedBytes)} / ${formatBytes(systemOverview.gpuMemoryTotalBytes)}`
                          : "显存数据不可用"}
                      </div>
                    </Card>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[14px] font-semibold text-foreground/90">项目实际占用（Halo 进程）</h3>
                    <span className="text-[12px] text-muted-foreground">进程级实时数据</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Card className="glass-card border-none p-4">
                      <div className="flex items-center justify-between text-[13px] font-semibold">
                        <span>CPU</span>
                        <span className="text-cyan-600 dark:text-cyan-400">
                          {appCpuPercent == null ? "--" : `${appCpuPercent.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-cyan-600 transition-all duration-500" style={{ width: `${appCpuPercent ?? 0}%` }} />
                      </div>
                    </Card>

                    <Card className="glass-card border-none p-4">
                      <div className="flex items-center justify-between text-[13px] font-semibold">
                        <span>内存</span>
                        <span className="text-fuchsia-600 dark:text-fuchsia-400">
                          {appMemoryPercent == null ? "--" : `${appMemoryPercent.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-fuchsia-600 transition-all duration-500" style={{ width: `${appMemoryPercent ?? 0}%` }} />
                      </div>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        {formatBytes(systemOverview.appMemoryUsedBytes ?? 0)}
                      </div>
                    </Card>

                    <Card className="glass-card border-none p-4">
                      <div className="flex items-center justify-between text-[13px] font-semibold">
                        <span>GPU</span>
                        <span className="text-amber-600 dark:text-amber-400">
                          {appGpuPercent == null ? "--" : `${appGpuPercent.toFixed(1)}%`}
                        </span>
                      </div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-500" style={{ width: `${appGpuPercent ?? 0}%` }} />
                      </div>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        {systemOverview.appGpuMemoryUsedBytes != null && systemOverview.appGpuMemoryTotalBytes != null
                          ? `${formatBytes(systemOverview.appGpuMemoryUsedBytes)} / ${formatBytes(systemOverview.appGpuMemoryTotalBytes)}`
                          : "进程 GPU 数据不可用"}
                      </div>
                    </Card>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </motion.section>
      </motion.div >
    </div >
  );
}
