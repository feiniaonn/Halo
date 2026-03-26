import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type {
  MusicControlSource,
  MusicMiniVisibleKey,
  MusicSettings,
} from "../types/music.types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export type MusicHotkeyAction = keyof MusicSettings["music_hotkeys_bindings"];

export type MusicHotkeyCaptureState = {
  action: MusicHotkeyAction;
  preview: string;
  changed: boolean;
};

const MINI_KEY_LABELS: Record<MusicMiniVisibleKey, string> = {
  previous: "上一首",
  play_pause: "播放/暂停",
  next: "下一首",
};

const HOTKEY_LABELS: Record<MusicHotkeyAction, string> = {
  previous: "上一首",
  play_pause: "播放/暂停",
  next: "下一首",
  restore_mini_home: "恢复主页（迷你模式）",
};

function normalizeSourceKind(kind: string): string {
  if (kind === "browser") return "浏览器";
  if (kind === "native") return "本地软件";
  return kind;
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.2 1.2 0 0 1-1.7 1.7l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V19a1.2 1.2 0 1 1-2.4 0v-.1a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a1.2 1.2 0 0 1-1.7-1.7l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H5a1.2 1.2 0 1 1 0-2.4h.1a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a1.2 1.2 0 1 1 1.7-1.7l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9V5a1.2 1.2 0 1 1 2.4 0v.1a1 1 0 0 0 .7.9h.1a1 1 0 0 0 1.1-.2l.1-.1a1.2 1.2 0 1 1 1.7 1.7l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6H19a1.2 1.2 0 1 1 0 2.4h-.1a1 1 0 0 0-.9.7Z" />
    </svg>
  );
}



export function MusicSettingsModal({
  show,
  settings,
  settingsLoading,
  settingsSaving,
  settingsMessage,
  controlSources,
  hotkeyCapture,
  hotkeyInputRefs,
  showUnsavedPrompt,
  hotkeyFieldValue,
  onStartHotkeyCapture,
  onPatchSettings,
  onToggleVisibleKey,
  onToggleWhitelistSource,
  onAllowAllSources,
  onRequestClose,
  onSave,
  onDiscardAndClose,
  onSaveAndClose,
  onCloseUnsavedPrompt,
}: {
  show: boolean;
  settings: MusicSettings;
  settingsLoading: boolean;
  settingsSaving: boolean;
  settingsMessage: string | null;
  controlSources: MusicControlSource[];
  hotkeyCapture: MusicHotkeyCaptureState | null;
  hotkeyInputRefs: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  showUnsavedPrompt: boolean;
  hotkeyFieldValue: (action: MusicHotkeyAction) => string;
  onStartHotkeyCapture: (action: MusicHotkeyAction) => void;
  onPatchSettings: (patch: Partial<MusicSettings>) => void;
  onToggleVisibleKey: (key: MusicMiniVisibleKey, checked: boolean) => void;
  onToggleWhitelistSource: (sourceId: string, checked: boolean) => void;
  onAllowAllSources: () => void;
  onRequestClose: () => void;
  onSave: () => void;
  onDiscardAndClose: () => void;
  onSaveAndClose: () => void;
  onCloseUnsavedPrompt: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"general" | "lyrics" | "hotkeys">("general");

  const handleScrapeToggle = (checked: boolean) => {
    if (!checked) {
      onPatchSettings({
        music_lyrics_scrape_enabled: false,
      });
      return;
    }

    if (settings.music_lyrics_scrape_notice_ack) {
      onPatchSettings({
        music_lyrics_scrape_enabled: true,
      });
      return;
    }

    const accepted = window.confirm(
      "歌词抓取属于实验功能，仅用于你已具备合法收听权限的内容展示，不得用于传播或商用。是否继续开启？",
    );
    if (!accepted) {
      return;
    }

    onPatchSettings({
      music_lyrics_scrape_enabled: true,
      music_lyrics_scrape_notice_ack: true,
    });
  };

  return (
    <Dialog open={show} onOpenChange={(open) => { if (!open) onRequestClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-background/95 backdrop-blur-xl border-white/10 shadow-2xl glass-panel">
        <DialogHeader className="px-5 py-4 border-b border-white/10 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <SettingsIcon className="size-5 text-primary" />
            音乐组件设置
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent relative">
          {settingsLoading ? (
            <p className="text-xs text-muted-foreground">设置加载中...</p>
          ) : (
            <div className="space-y-4">
              <Card className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.015] px-4 py-3 shadow-sm">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">把音乐控制调成你习惯的手感</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    改完后记得点“保存更改”，避免下次打开恢复默认。
                  </p>
                </div>
                <button
                  type="button"
                  disabled={settingsSaving}
                  onClick={onSave}
                  className="rounded-lg bg-primary text-primary-foreground px-4 py-1.5 text-xs font-medium transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45 shadow-sm"
                >
                  {settingsSaving ? "保存中..." : "保存更改"}
                </button>
              </Card>

              <nav className="flex rounded-lg bg-black/10 dark:bg-white/5 p-1 w-full shrink-0" aria-label="设置标签">
                <button
                  onClick={() => setActiveTab("general")}
                  className={cn(
                    "flex-1 rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
                    activeTab === "general"
                      ? "bg-background/80 text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  常规设置
                </button>
                <button
                  onClick={() => setActiveTab("lyrics")}
                  className={cn(
                    "flex-1 rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
                    activeTab === "lyrics"
                      ? "bg-background/80 text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  歌词显示
                </button>
                <button
                  onClick={() => setActiveTab("hotkeys")}
                  className={cn(
                    "flex-1 rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
                    activeTab === "hotkeys"
                      ? "bg-background/80 text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  快捷键与白名单
                </button>
              </nav>

              {activeTab === "general" && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <Card className="rounded-xl border border-white/5 bg-white/[0.015] space-y-2.5 p-4 shadow-sm">
                    <div>
                      <h3 className="text-sm font-semibold">播放控制</h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        决定优先控制哪个来源，以及控制失败时的重试策略。
                      </p>
                    </div>
                    <div className="grid gap-2.5 md:grid-cols-3">
                      <label className="flex flex-col gap-1 text-xs">
                        <span className="text-[10px] text-muted-foreground">控制目标</span>
                        <select
                          value={settings.music_control_target_mode}
                          onChange={(event) =>
                            onPatchSettings({
                              music_control_target_mode: event.target.value as MusicSettings["music_control_target_mode"],
                            })
                          }
                          className="rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                        >
                          <option value="auto">自动（推荐）</option>
                          <option value="browser">优先浏览器</option>
                          <option value="native">优先本地软件</option>
                        </select>
                      </label>

                      <label className="flex flex-col gap-1 text-xs">
                        <span className="text-[10px] text-muted-foreground">超时（毫秒）</span>
                        <input
                          type="number"
                          min={200}
                          max={5000}
                          value={settings.music_control_timeout_ms}
                          onChange={(event) =>
                            onPatchSettings({
                              music_control_timeout_ms: Number(event.target.value || 0),
                            })
                          }
                          className="rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                        />
                      </label>

                      <label className="flex flex-col gap-1 text-xs">
                        <span className="text-[10px] text-muted-foreground">重试次数</span>
                        <input
                          type="number"
                          min={0}
                          max={5}
                          value={settings.music_control_retry_count}
                          onChange={(event) =>
                            onPatchSettings({
                              music_control_retry_count: Number(event.target.value || 0),
                            })
                          }
                          className="rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                        />
                      </label>
                    </div>

                    <div className="grid gap-2.5 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs md:col-span-2">
                        <span className="text-[10px] text-muted-foreground">{HOTKEY_LABELS.restore_mini_home}</span>
                        <input
                          ref={(node) => {
                            if (node && hotkeyInputRefs && typeof hotkeyInputRefs === "object" && "current" in hotkeyInputRefs && hotkeyInputRefs.current) {
                              Object.assign(hotkeyInputRefs.current, { restore_mini_home: node });
                            }
                          }}
                          placeholder="默认 Control+Shift+H，可点击后按组合键重录"
                          readOnly
                          value={hotkeyFieldValue("restore_mini_home")}
                          onClick={() => onStartHotkeyCapture("restore_mini_home")}
                          onFocus={() => onStartHotkeyCapture("restore_mini_home")}
                          className={cn(
                            "rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 outline-none transition-all cursor-pointer hover:border-white/20",
                            hotkeyCapture?.action === "restore_mini_home" ? "border-primary/60 ring-1 ring-primary/50" : "",
                          )}
                        />
                        <span className="text-[10px] text-muted-foreground/70">
                          该快捷键独立于播放控制热键，迷你模式下始终可用。
                        </span>
                      </label>
                    </div>
                  </Card>

                  <Card className="rounded-xl border border-white/5 bg-white/[0.015] space-y-2.5 p-4 shadow-sm">
                    <div>
                      <h3 className="text-sm font-semibold">迷你模式显示</h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">自定义迷你模式显示哪些控制键和信息。</p>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-xs transition-colors">
                        <span>显示迷你控制按钮</span>
                        <Switch
                          checked={settings.music_mini_controls_enabled}
                          onCheckedChange={(checked) =>
                            onPatchSettings({
                              music_mini_controls_enabled: checked,
                            })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-xs transition-colors">
                        <span>没有播放时也显示今日概览</span>
                        <Switch
                          checked={settings.music_mini_show_stats_without_session}
                          onCheckedChange={(checked) =>
                            onPatchSettings({
                              music_mini_show_stats_without_session: checked,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[10px] text-muted-foreground">迷你模式可见按钮</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(["previous", "play_pause", "next"] as MusicMiniVisibleKey[]).map((key) => (
                          <label
                            key={key}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer",
                              settings.music_mini_visible_keys.includes(key)
                                ? "border-primary/40 bg-primary/10 text-foreground"
                                : "border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10",
                            )}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={settings.music_mini_visible_keys.includes(key)}
                              onChange={(event) => onToggleVisibleKey(key, event.target.checked)}
                            />
                            <span>{MINI_KEY_LABELS[key]}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                  </Card>
                </div>
              )}

              {activeTab === "lyrics" && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <Card className="rounded-xl border border-white/5 bg-white/[0.015] space-y-2.5 p-4 shadow-sm">
                    <div>
                      <h3 className="text-sm font-semibold">歌词显示</h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        支持音乐页完整歌词和迷你窗单行歌词。
                      </p>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-xs transition-colors">
                        <span>显示译文</span>
                        <Switch
                          checked={settings.music_lyrics_show_translation}
                          onCheckedChange={(checked) =>
                            onPatchSettings({
                              music_lyrics_show_translation: checked,
                            })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-xs transition-colors">
                        <span>显示罗马音</span>
                        <Switch
                          checked={settings.music_lyrics_show_romanized}
                          onCheckedChange={(checked) =>
                            onPatchSettings({
                              music_lyrics_show_romanized: checked,
                            })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-xs transition-colors">
                        <span>自动跟随当前歌词</span>
                        <Switch
                          checked={settings.music_lyrics_auto_follow}
                          onCheckedChange={(checked) =>
                            onPatchSettings({
                              music_lyrics_auto_follow: checked,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid gap-2.5 md:grid-cols-3">
                      <label className="flex flex-col gap-1 text-xs">
                        <span className="text-[10px] text-muted-foreground">时间偏移（毫秒）</span>
                        <input
                          type="number"
                          min={-5000}
                          max={5000}
                          value={settings.music_lyrics_offset_ms}
                          onChange={(event) =>
                            onPatchSettings({
                              music_lyrics_offset_ms: Number(event.target.value || 0),
                            })
                          }
                          className="rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                        />
                      </label>

                      <label className="flex flex-col gap-1 text-xs">
                        <span className="text-[10px] text-muted-foreground">手动滚动锁定（毫秒）</span>
                        <input
                          type="number"
                          min={1000}
                          max={30000}
                          value={settings.music_lyrics_manual_lock_ms}
                          onChange={(event) =>
                            onPatchSettings({
                              music_lyrics_manual_lock_ms: Number(event.target.value || 0),
                            })
                          }
                          className="rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                        />
                      </label>

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-xs transition-colors md:col-span-1">
                        <span>开启网页抓取兜底（实验）</span>
                        <Switch
                          checked={settings.music_lyrics_scrape_enabled}
                          onCheckedChange={handleScrapeToggle}
                        />
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {activeTab === "hotkeys" && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <Card className="rounded-xl border border-white/5 bg-white/[0.015] space-y-2.5 p-4 shadow-sm">
                    <div>
                      <h3 className="text-sm font-semibold">快捷键</h3>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        点击输入框后按组合键，下一次鼠标点击会结束录制。
                      </p>
                    </div>

                    <div className="grid gap-2.5 md:grid-cols-2">
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 px-3 py-2 text-xs transition-colors">
                        <span>启用快捷键控制</span>
                        <Switch
                          checked={settings.music_hotkeys_enabled}
                          onCheckedChange={(checked) =>
                            onPatchSettings({
                              music_hotkeys_enabled: checked,
                            })
                          }
                        />
                      </div>

                      <label className="flex flex-col gap-1 text-xs">
                        <span className="text-[10px] text-muted-foreground">作用范围</span>
                        <select
                          value={settings.music_hotkeys_scope}
                          disabled={!settings.music_hotkeys_enabled}
                          onChange={(event) =>
                            onPatchSettings({
                              music_hotkeys_scope: event.target.value as MusicSettings["music_hotkeys_scope"],
                            })
                          }
                          className="rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 disabled:opacity-50 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                        >
                          <option value="focus">仅本软件窗口内生效</option>
                          <option value="global">后台全局生效</option>
                        </select>
                      </label>
                    </div>

                    <div className="grid gap-2.5 md:grid-cols-3">
                      <label className="flex flex-col gap-1 text-xs">
                        <span className="text-[10px] text-muted-foreground">上一首</span>
                        <input
                          ref={(node) => {
                            if (node && hotkeyInputRefs && typeof hotkeyInputRefs === 'object' && 'current' in hotkeyInputRefs && hotkeyInputRefs.current) {
                              Object.assign(hotkeyInputRefs.current, { previous: node });
                            }
                          }}
                          placeholder="点击后按键录制"
                          readOnly
                          disabled={!settings.music_hotkeys_enabled}
                          value={hotkeyFieldValue("previous")}
                          onClick={() => onStartHotkeyCapture("previous")}
                          onFocus={() => onStartHotkeyCapture("previous")}
                          className={cn(
                            "rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 disabled:opacity-50 outline-none transition-all cursor-pointer",
                            hotkeyCapture?.action === "previous" ? "border-primary/60 ring-1 ring-primary/50" : "hover:border-white/20",
                          )}
                        />
                      </label>

                      <label className="flex flex-col gap-1 text-xs">
                        <span className="text-[10px] text-muted-foreground">播放/暂停</span>
                        <input
                          ref={(node) => {
                            if (node && hotkeyInputRefs && typeof hotkeyInputRefs === 'object' && 'current' in hotkeyInputRefs && hotkeyInputRefs.current) {
                              Object.assign(hotkeyInputRefs.current, { play_pause: node });
                            }
                          }}
                          placeholder="点击后按键录制"
                          readOnly
                          disabled={!settings.music_hotkeys_enabled}
                          value={hotkeyFieldValue("play_pause")}
                          onClick={() => onStartHotkeyCapture("play_pause")}
                          onFocus={() => onStartHotkeyCapture("play_pause")}
                          className={cn(
                            "rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 disabled:opacity-50 outline-none transition-all cursor-pointer",
                            hotkeyCapture?.action === "play_pause" ? "border-primary/60 ring-1 ring-primary/50" : "hover:border-white/20",
                          )}
                        />
                      </label>

                      <label className="flex flex-col gap-1 text-xs">
                        <span className="text-[10px] text-muted-foreground">下一首</span>
                        <input
                          ref={(node) => {
                            if (node && hotkeyInputRefs && typeof hotkeyInputRefs === 'object' && 'current' in hotkeyInputRefs && hotkeyInputRefs.current) {
                              Object.assign(hotkeyInputRefs.current, { next: node });
                            }
                          }}
                          placeholder="点击后按键录制"
                          readOnly
                          disabled={!settings.music_hotkeys_enabled}
                          value={hotkeyFieldValue("next")}
                          onClick={() => onStartHotkeyCapture("next")}
                          onFocus={() => onStartHotkeyCapture("next")}
                          className={cn(
                            "rounded-lg border border-white/10 bg-black/10 dark:bg-white/5 px-2.5 py-1.5 disabled:opacity-50 outline-none transition-all cursor-pointer",
                            hotkeyCapture?.action === "next" ? "border-primary/60 ring-1 ring-primary/50" : "hover:border-white/20",
                          )}
                        />
                      </label>
                    </div>
                  </Card>

                  <Card className="rounded-xl border border-white/5 bg-white/[0.015] space-y-2.5 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold">可控应用白名单</h3>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          仅控制勾选的来源；如果不勾选任何来源，表示允许全部。
                        </p>
                      </div>
                      {settings.music_control_whitelist.length > 0 && (
                        <button
                          type="button"
                          onClick={onAllowAllSources}
                          className="rounded-md border border-white/10 bg-black/10 dark:bg-white/5 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-black/20 dark:hover:bg-white/10 hover:text-foreground"
                        >
                          清空白名单
                        </button>
                      )}
                    </div>

                    <div className="max-h-32 overflow-auto rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 p-1.5">
                      {controlSources.length === 0 ? (
                        <p className="px-1 py-1 text-[11px] text-muted-foreground">
                          暂无可识别应用。开始播放后会自动出现。
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {controlSources.map((source) => (
                            <label
                              key={source.source_id}
                              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer hover:bg-black/10 dark:hover:bg-white/10"
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="truncate">{source.source_name}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {normalizeSourceKind(source.source_kind)}
                                </span>
                              </div>
                              <Switch
                                checked={settings.music_control_whitelist.includes(source.source_id)}
                                onCheckedChange={(checked) => onToggleWhitelistSource(source.source_id, checked)}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              )}

              {settingsMessage && (
                <p className="rounded-lg border border-white/10 bg-black/5 dark:bg-white/5 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  {settingsMessage}
                </p>
              )}
            </div>
          )}
        </div>

        <AnimatePresence>
          {showUnsavedPrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onCloseUnsavedPrompt} />
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative w-full max-w-sm rounded-2xl border border-white/5 bg-background/95 p-4 shadow-xl backdrop-blur-3xl"
              >
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold">有未保存的更改</h4>
                  <p className="text-xs text-muted-foreground">
                    你已经修改了音乐设置，是否保存这些更改？
                  </p>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={onDiscardAndClose}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    不保存
                  </button>
                  <button
                    type="button"
                    onClick={onSaveAndClose}
                    disabled={settingsSaving}
                    className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {settingsSaving ? "保存中..." : "保存更改"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog >
  );
}
