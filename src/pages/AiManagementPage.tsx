import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useMusicAiRecommendation } from "@/modules/ai/hooks/useMusicAiRecommendation";
import {
  getAiConnectionSettings,
  getMusicAiModuleSettings,
  probeAiConnection,
  saveAiConnectionSettings,
  saveMusicAiModuleSettings,
} from "@/modules/ai/services/aiService";
import type {
  AiConnectionProbeResult,
  AiConnectionSettings,
  MusicAiModuleSettings,
} from "@/modules/ai/types/ai.types";
import {
  createDefaultAiConnectionSettings,
  createDefaultMusicAiModuleSettings,
} from "@/modules/ai/types/ai.types";

type Notice = {
  kind: "success" | "error";
  text: string;
};

function formatUpdatedAt(updatedAt: number | null): string {
  if (!updatedAt) return "未保存";
  try {
    return new Date(updatedAt).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "未保存";
  }
}

function formatLatency(latency: number | null | undefined): string {
  if (!latency || !Number.isFinite(latency) || latency <= 0) return "--";
  return `${Math.round(latency)} ms`;
}

function buildPreviewUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.trim().replace(/^\/+/, "");
  if (!normalizedBase || !normalizedPath) return "--";
  return `${normalizedBase}/${normalizedPath}`;
}

export function AiManagementPage() {
  const [connectionForm, setConnectionForm] = useState<AiConnectionSettings>(
    createDefaultAiConnectionSettings(),
  );
  const [musicModuleForm, setMusicModuleForm] = useState<MusicAiModuleSettings>(
    createDefaultMusicAiModuleSettings(),
  );
  const [loading, setLoading] = useState(true);
  const [savingConnection, setSavingConnection] = useState(false);
  const [savingMusicModule, setSavingMusicModule] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<AiConnectionProbeResult | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const recommendation = useMusicAiRecommendation();

  useEffect(() => {
    const load = async () => {
      try {
        const [connectionSettings, musicModuleSettings] = await Promise.all([
          getAiConnectionSettings(),
          getMusicAiModuleSettings(),
        ]);
        setConnectionForm({
          ...createDefaultAiConnectionSettings(),
          ...connectionSettings,
        });
        setMusicModuleForm({
          ...createDefaultMusicAiModuleSettings(),
          ...musicModuleSettings,
        });
      } catch (error) {
        console.error(error);
        setNotice({ kind: "error", text: "AI 配置加载失败，请稍后再试。" });
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const updateConnectionField = useCallback(
    (key: "base_url" | "api_key" | "model_name", value: string) => {
      setConnectionForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const saveConnection = useCallback(async () => {
    setSavingConnection(true);
    try {
      const saved = await saveAiConnectionSettings(connectionForm);
      setConnectionForm(saved);
      setNotice({ kind: "success", text: "AI 接入设置已保存。" });
    } catch (error) {
      console.error(error);
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "AI 接入设置保存失败。",
      });
    } finally {
      setSavingConnection(false);
    }
  }, [connectionForm]);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      const result = await probeAiConnection(connectionForm);
      setProbeResult(result);
      if (result.ok && result.resolved_model && result.resolved_model !== connectionForm.model_name) {
        setConnectionForm((prev) => ({ ...prev, model_name: result.resolved_model }));
      }
      setNotice({
        kind: result.ok ? "success" : "error",
        text: result.ok
          ? `已确认可用模型：${result.resolved_model || connectionForm.model_name}。`
          : result.error ?? "探测失败，请检查地址、密钥和模型名称。",
      });
    } catch (error) {
      console.error(error);
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "探测失败，请稍后再试。",
      });
    } finally {
      setProbing(false);
    }
  }, [connectionForm]);

  const saveMusicModule = useCallback(async () => {
    setSavingMusicModule(true);
    try {
      const saved = await saveMusicAiModuleSettings(musicModuleForm);
      setMusicModuleForm(saved);
      setNotice({ kind: "success", text: "音乐 AI 设置已保存。" });
      await recommendation.refresh(true);
    } catch (error) {
      console.error(error);
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "音乐 AI 设置保存失败。",
      });
    } finally {
      setSavingMusicModule(false);
    }
  }, [musicModuleForm, recommendation]);

  const modelsEndpoint = useMemo(
    () => buildPreviewUrl(connectionForm.base_url, connectionForm.models_path),
    [connectionForm.base_url, connectionForm.models_path],
  );
  const chatEndpoint = useMemo(
    () => buildPreviewUrl(connectionForm.base_url, connectionForm.chat_path),
    [connectionForm.base_url, connectionForm.chat_path],
  );

  const probeSummary = useMemo(() => {
    if (!probeResult) return null;
    if (!probeResult.ok) {
      return {
        status: "探测失败",
        detail: probeResult.error ?? "没有探测到可用模型。",
      };
    }
    return {
      status: "可用模型",
      detail: probeResult.resolved_model || connectionForm.model_name || "--",
    };
  }, [connectionForm.model_name, probeResult]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.015] px-5 py-4 text-sm text-muted-foreground shadow-lg backdrop-blur-2xl">
          <Loader2 className="size-4 animate-spin" />
          正在加载 AI 配置...
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5 pb-4">
      <div className="flex items-start justify-between gap-5">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              <Bot className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">AI 管理</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                开启各类 AI 辅助功能。配置成功后即使入口隐藏，能力也不会失效。
              </p>
            </div>
          </div>

          {notice && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm shadow-sm backdrop-blur-xl",
                notice.kind === "success" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
                notice.kind === "error" && "border-red-500/20 bg-red-500/10 text-red-100",
              )}
            >
              {notice.kind === "success" ? (
                <CheckCircle2 className="size-4 shrink-0" />
              ) : (
                <Sparkles className="size-4 shrink-0" />
              )}
              <span>{notice.text}</span>
            </div>
          )}
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 shrink-0">
              <Settings className="size-4" />
              接入设置
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] md:max-w-[600px] max-h-[85vh] overflow-y-auto no-scrollbar">
            <DialogHeader>
              <DialogTitle>AI 接入设置</DialogTitle>
              <DialogDescription>
                当前兼容 OpenAI Compatible 协议。配置后所有 AI 模块将共用此配置。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 pt-4">
              <div className="rounded-3xl border border-border/40 bg-background/25 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  当前接入摘要
                </div>
                <div className="mt-2 text-sm font-medium text-foreground break-all">
                  {connectionForm.base_url.trim() || "未填写请求地址"}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full border border-border/50 bg-background/40 px-2.5 py-1">
                    OpenAI Compatible
                  </span>
                  <span className="rounded-full border border-border/50 bg-background/40 px-2.5 py-1">
                    GET /v1/models
                  </span>
                  <span className="rounded-full border border-border/50 bg-background/40 px-2.5 py-1">
                    POST /v1/chat/completions
                  </span>
                </div>
              </div>

              <div className="grid gap-4 rounded-3xl border border-border/40 bg-background/20 p-4">
                <div className="space-y-2">
                  <Label htmlFor="ai-base-url">请求地址</Label>
                  <Input
                    id="ai-base-url"
                    value={connectionForm.base_url}
                    onChange={(event) => updateConnectionField("base_url", event.target.value)}
                    placeholder="例如 https://crs.thinkingflux.com/api"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-api-key">密钥</Label>
                  <Input
                    id="ai-api-key"
                    type="password"
                    value={connectionForm.api_key}
                    onChange={(event) => updateConnectionField("api_key", event.target.value)}
                    placeholder="输入服务密钥"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-model-name">指定模型名称</Label>
                  <Input
                    id="ai-model-name"
                    value={connectionForm.model_name}
                    onChange={(event) => updateConnectionField("model_name", event.target.value)}
                    placeholder="例如 gpt-5.3-codex"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border/40 bg-background/40 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">模型接口</div>
                    <div className="mt-1 break-all font-mono text-xs text-foreground/90">
                      {modelsEndpoint}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/40 bg-background/40 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">对话接口</div>
                    <div className="mt-1 break-all font-mono text-xs text-foreground/90">
                      {chatEndpoint}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => void saveConnection()} disabled={savingConnection}>
                    {savingConnection ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                    保存设置
                  </Button>
                  <Button variant="outline" onClick={() => void runProbe()} disabled={probing}>
                    {probing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    探测并测活
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    上次保存：{formatUpdatedAt(connectionForm.updated_at)}
                  </span>
                </div>
              </div>

              <div className="rounded-2xl border border-border/50 bg-background/20 p-4">
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1",
                      probeResult?.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {probeResult?.ok ? "连接可用" : "等待探测"}
                  </span>
                  <span>当前模型 {probeResult?.resolved_model || connectionForm.model_name || "--"}</span>
                  <span>耗时 {formatLatency(probeResult?.latency_ms)}</span>
                  <span>状态 {probeResult?.ok ? "活着" : "未通过"}</span>
                </div>
                <div className="mt-3 whitespace-pre-wrap break-words text-sm text-foreground">
                  {probeSummary?.detail || "点击“探测并测活”后，这里只会显示最终可用的模型结果。"}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-5 sm:grid-cols-1 xl:grid-cols-2 mt-4">

        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>音乐 AI 模块</CardTitle>
                <CardDescription>
                  每天固定保留一条推荐内容，0 点自动换天。开发中可以手动刷新强制重算。
                </CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">启用</span>
                <Switch
                  checked={musicModuleForm.enabled}
                  onCheckedChange={(checked) =>
                    setMusicModuleForm((prev) => ({ ...prev, enabled: checked }))
                  }
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="music-ai-system-prompt">系统提示词</Label>
              <textarea
                id="music-ai-system-prompt"
                value={musicModuleForm.system_prompt}
                onChange={(event) =>
                  setMusicModuleForm((prev) => ({ ...prev, system_prompt: event.target.value }))
                }
                rows={6}
                className="w-full resize-y rounded-2xl border border-input bg-background/40 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                placeholder="此处为系统隐式设定的提示口径。AI 将接收今日频繁播放的 Top 10 榜单，并返回推荐歌曲及心情关键词结构（请务必遵循 JSON 输出规范避免解析失败）。"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void saveMusicModule()} disabled={savingMusicModule}>
                {savingMusicModule ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                保存模块设置
              </Button>
              <Button
                variant="outline"
                onClick={() => void recommendation.refresh(true)}
                disabled={recommendation.refreshing}
              >
                {recommendation.refreshing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {recommendation.refreshing ? "正在刷新推荐..." : "手动刷新推荐"}
              </Button>
              <span className="text-xs text-muted-foreground">
                上次保存：{formatUpdatedAt(musicModuleForm.updated_at)}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/50 bg-background/25 p-4">
                <div className="text-xs text-muted-foreground">当前推荐</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {recommendation.data?.song_name ?? "开启今日的音乐之旅吧"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {recommendation.data?.mood ? `当前氛围：${recommendation.data.mood}` : "积累足够记录后将为你推荐惊喜内容"}
                </div>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/25 p-4">
                <div className="text-xs text-muted-foreground">同步状态</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {recommendation.refreshing
                    ? "刷新中"
                    : recommendation.loading
                      ? "加载中"
                      : recommendation.data?.source ?? "未初始化"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  日期：{recommendation.data?.date_key ?? "未生成"}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-background/25 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <Wand2 className="size-4 text-primary" />
                返回内容预览
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-foreground">
                {recommendation.data?.raw_reply ??
                  recommendation.data?.error ??
                  "这里会显示 AI 返回的原始内容，方便调试解析结果。"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
