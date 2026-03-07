import { invoke } from "@tauri-apps/api/core";

import {
  buildBrowserParsePolicy,
  type BrowserClickAction,
} from "@/modules/media/services/browserParsePolicy";
import { selectVodParses } from "@/modules/media/services/vodParseResolver";
import { resolveRequestPolicy } from "@/modules/media/services/tvboxNetworkPolicy";
import type {
  TvBoxHostMapping,
  TvBoxParse,
  TvBoxPlaybackRule,
  TvBoxRequestHeaderRule,
  VodEpisode,
  VodKernelMode,
  VodSourceKind,
} from "@/modules/media/types/vodWindow.types";

export interface PlayerPayload {
  url?: string;
  parse?: number;
  jx?: number;
  header?: Record<string, string>;
  [key: string]: unknown;
}

export interface VodPlaybackContext {
  sourceKind: VodSourceKind;
  spiderUrl: string;
  siteKey: string;
  apiClass: string;
  ext: string;
  playUrl?: string;
  click?: string;
  playerType?: string;
  siteName?: string;
  parses?: TvBoxParse[];
  playbackRules?: TvBoxPlaybackRule[];
  requestHeaders?: TvBoxRequestHeaderRule[];
  hostMappings?: TvBoxHostMapping[];
}

export interface VodResolvedStream {
  url: string;
  headers: Record<string, string> | null;
  resolvedBy: "spider" | "direct" | "jiexi" | "jiexi-webview";
}

export function normalizeVodKernelMode(mode: unknown): VodKernelMode {
  if (mode === "mpv" || mode === "direct" || mode === "proxy" || mode === "native") {
    return mode;
  }
  return "mpv";
}

export function unwrapPlayerPayload(resp: string): PlayerPayload {
  try {
    let data: unknown = JSON.parse(resp);
    if (data && typeof data === "object" && "result" in data && ("ok" in data || "className" in data)) {
      data = (data as { result: unknown }).result;
    }
    if (typeof data === "string") {
      const trimmed = data.trim();
      if (!trimmed) return {};
      data = JSON.parse(trimmed);
    }
    if (Array.isArray(data)) data = data.length > 0 ? data[0] : {};
    if (!data || typeof data !== "object") return {};
    return data as PlayerPayload;
  } catch {
    return {};
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isImageLikeUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|ico)(\?.*)?$/i.test(url);
}

export function looksLikeDirectPlayableUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  if (!normalized.startsWith("http")) return false;
  if (isImageLikeUrl(normalized)) return false;
  return /(\.m3u8|\.mp4|\.flv|\.mpd|\.m4s|\.ts|\.webm|\.mkv|\.mov)(\?|$)/i.test(normalized)
    || normalized.includes("mime=video")
    || normalized.includes("contenttype=video")
    || normalized.includes("type=m3u8")
    || normalized.includes("type=mp4");
}

function buildSitePlayParse(context: VodPlaybackContext): TvBoxParse | null {
  if (!context.playUrl) return null;
  return {
    name: `${context.siteName || context.siteKey || "站点"} 站点解析`,
    type: 0,
    url: context.playUrl,
  };
}

function getEffectiveParses(context: VodPlaybackContext): TvBoxParse[] {
  const siteParse = buildSitePlayParse(context);
  return siteParse ? [siteParse, ...(context.parses ?? [])] : [...(context.parses ?? [])];
}

async function resolveByParse(
  context: VodPlaybackContext,
  routeName: string,
  pageUrl: string,
): Promise<VodResolvedStream | null> {
  const parseSelection = selectVodParses(getEffectiveParses(context), {
    jxIndex: 1,
    routeName,
    pageUrl,
  });
  if (parseSelection.ordered.length === 0) {
    return null;
  }

  let lastError = "";
  for (const parse of parseSelection.ordered) {
    const parseRequest = resolveRequestPolicy(
      parse.url,
      parse.ext?.header ?? null,
      context.requestHeaders,
      context.hostMappings,
    );
    try {
      const resolvedUrl = await invoke<string>("resolve_jiexi", {
        jiexiPrefix: parseRequest.url,
        videoUrl: pageUrl,
        extraHeaders: parseRequest.headers,
      });
      if (resolvedUrl && !isImageLikeUrl(resolvedUrl)) {
        const resolvedTarget = resolveRequestPolicy(
          resolvedUrl,
          parse.ext?.header ?? null,
          context.requestHeaders,
          context.hostMappings,
        );
        return {
          url: resolvedTarget.url,
          headers: resolvedTarget.headers,
          resolvedBy: "jiexi",
        };
      }
      lastError = "解析返回了非视频地址。";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      if (message.includes("jiexi_needs_browser")) {
        const browserPolicy = buildBrowserParsePolicy(
          context.click,
          context.playbackRules,
          pageUrl,
        );
        try {
          const browserResolved = await invoke<string>("resolve_jiexi_webview", {
            jiexiPrefix: parseRequest.url,
            videoUrl: pageUrl,
            timeoutMs: 25000,
            visible: false,
            clickActions: browserPolicy.actions as BrowserClickAction[],
          });
          if (browserResolved && !isImageLikeUrl(browserResolved)) {
            const resolvedTarget = resolveRequestPolicy(
              browserResolved,
              null,
              context.requestHeaders,
              context.hostMappings,
            );
            return {
              url: resolvedTarget.url,
              headers: resolvedTarget.headers,
              resolvedBy: "jiexi-webview",
            };
          }
          lastError = "浏览器解析返回了非视频地址。";
        } catch (browserError) {
          const browserMessage = browserError instanceof Error ? browserError.message : String(browserError);
          lastError = browserPolicy.ignoredEntries.length > 0
            ? `${browserMessage}（另有 ${browserPolicy.ignoredEntries.length} 条点击脚本因不在白名单内被跳过）`
            : browserMessage;
        }
      }
    }
  }

  throw new Error(lastError || "当前解析链路不可用。");
}

export function buildNoUrlMessage(payload: PlayerPayload, id: string, hasParseCandidates: boolean): string {
  if (id.startsWith("msearch:")) return "该线路仅返回搜索入口，不提供可播放直链。";
  if (Number(payload.parse ?? 0) === 1 || Number(payload.jx ?? 0) === 1) {
    return hasParseCandidates
      ? "该线路需要外部解析，但当前解析链路未返回可播地址。"
      : "该线路需要外部解析，但当前没有可用解析器。";
  }
  if (payload.url && typeof payload.url === "string" && isImageLikeUrl(payload.url)) {
    return "源站返回了图片流，无法作为视频播放。请切换线路。";
  }
  return "源站未返回可播放通道，请切换线路或站点。";
}

export async function resolveEpisodePlayback(
  context: VodPlaybackContext,
  episode: VodEpisode,
  routeName: string,
): Promise<VodResolvedStream> {
  if (context.sourceKind === "spider") {
    const res = await invoke<string>("spider_player", {
      spiderUrl: context.spiderUrl,
      siteKey: context.siteKey,
      apiClass: context.apiClass,
      ext: context.ext,
      flag: routeName,
      id: episode.url,
      vipFlags: [],
    });

    const payload = unwrapPlayerPayload(res);
    const payloadUrl = typeof payload.url === "string" ? payload.url.trim() : "";
    const hasDirectPayloadUrl = isHttpUrl(payloadUrl) && !isImageLikeUrl(payloadUrl);
    if (hasDirectPayloadUrl && Number(payload.parse ?? 0) !== 1 && Number(payload.jx ?? 0) !== 1) {
      const resolvedPayload = resolveRequestPolicy(
        payloadUrl,
        payload.header ?? null,
        context.requestHeaders,
        context.hostMappings,
      );
      return {
        url: resolvedPayload.url,
        headers: resolvedPayload.headers,
        resolvedBy: "spider",
      };
    }

    const parseTarget = hasDirectPayloadUrl ? payloadUrl : isHttpUrl(episode.url) ? episode.url : "";
    if (parseTarget) {
      const parsed = await resolveByParse(context, routeName, parseTarget);
      if (parsed) {
        return parsed;
      }
    }

    if (isHttpUrl(episode.url) && looksLikeDirectPlayableUrl(episode.url)) {
      const resolvedEpisode = resolveRequestPolicy(
        episode.url,
        payload.header ?? null,
        context.requestHeaders,
        context.hostMappings,
      );
      return {
        url: resolvedEpisode.url,
        headers: resolvedEpisode.headers,
        resolvedBy: "direct",
      };
    }

    throw new Error(buildNoUrlMessage(payload, episode.url, getEffectiveParses(context).length > 0));
  }

  if (!isHttpUrl(episode.url)) {
    throw new Error("当前剧集未提供可解析地址。");
  }

  if (looksLikeDirectPlayableUrl(episode.url)) {
    const resolvedEpisode = resolveRequestPolicy(
      episode.url,
      null,
      context.requestHeaders,
      context.hostMappings,
    );
    return {
      url: resolvedEpisode.url,
      headers: resolvedEpisode.headers,
      resolvedBy: "direct",
    };
  }

  const parsed = await resolveByParse(context, routeName, episode.url);
  if (parsed) {
    return parsed;
  }

  if (context.playUrl || (context.parses?.length ?? 0) > 0) {
    throw new Error("当前解析链路未返回可播地址。请切换线路或解析器。");
  }

  throw new Error("当前剧集需要解析，但没有可用解析器。请补充 playUrl 或全局 parses。");
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${stage} timeout (${timeoutMs}ms)`));
    }, timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}
