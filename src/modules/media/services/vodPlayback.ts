import { invoke } from '@tauri-apps/api/core';

import {
  buildBrowserParsePolicy,
  type BrowserClickAction,
} from '@/modules/media/services/browserParsePolicy';
import { invokeSpiderPlayerV2 } from '@/modules/media/services/spiderV2';
import { selectVodParses } from '@/modules/media/services/vodParseResolver';
import { resolveRequestPolicy } from '@/modules/media/services/tvboxNetworkPolicy';
import type {
  TvBoxHostMapping,
  TvBoxParse,
  TvBoxPlaybackRule,
  TvBoxRequestHeaderRule,
  VodEpisode,
  VodKernelMode,
  VodSourceKind,
} from '@/modules/media/types/vodWindow.types';

export interface PlayerPayload {
  url?: string;
  parse?: number;
  jx?: number;
  header?: unknown;
  headers?: unknown;
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

export type VodPlaybackDiagnosticStage =
  | 'spider_payload'
  | 'wrapped_url'
  | 'parse_chain'
  | 'webview_parse'
  | 'direct_fallback'
  | 'episode_direct'
  | 'final';

export type VodPlaybackDiagnosticStatus = 'success' | 'miss' | 'skip' | 'error';

export interface VodPlaybackDiagnosticStep {
  stage: VodPlaybackDiagnosticStage;
  status: VodPlaybackDiagnosticStatus;
  detail: string;
}

export interface VodPlaybackDiagnostics {
  steps: VodPlaybackDiagnosticStep[];
}

export interface VodResolvedStream {
  url: string;
  headers: Record<string, string> | null;
  resolvedBy: 'spider' | 'direct' | 'jiexi' | 'jiexi-webview';
  skipProbe?: boolean;
  diagnostics?: VodPlaybackDiagnostics;
}

const SPIDER_PLAYER_EMPTY_RETRY_DELAYS_MS = [300];
const SPIDER_PLAYER_PAYLOAD_CACHE_TTL_MS = 2 * 60 * 1000;
const WRAPPED_PARSE_FALLBACK_TIMEOUT_MS = 8000;

interface CachedSpiderPayloadEntry {
  payload: PlayerPayload;
  expiresAt: number;
}

type VodPlaybackDiagnosticCarrier = {
  diagnostics?: VodPlaybackDiagnostics;
  playbackDiagnostics?: VodPlaybackDiagnostics;
};

const spiderPayloadCache = new Map<string, CachedSpiderPayloadEntry>();

export function clearSpiderPlayerPayloadCache(): void {
  spiderPayloadCache.clear();
}

function createVodPlaybackDiagnostics(): VodPlaybackDiagnostics {
  return { steps: [] };
}

function cloneVodPlaybackDiagnostics(diagnostics: VodPlaybackDiagnostics): VodPlaybackDiagnostics {
  return {
    steps: diagnostics.steps.map((step) => ({ ...step })),
  };
}

function summarizeDiagnosticValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'empty';
  if (trimmed.length <= 96) {
    return trimmed;
  }
  return `${trimmed.slice(0, 64)}...${trimmed.slice(-24)}(len=${trimmed.length})`;
}

function appendPlaybackDiagnostic(
  diagnostics: VodPlaybackDiagnostics,
  stage: VodPlaybackDiagnosticStage,
  status: VodPlaybackDiagnosticStatus,
  detail: string,
): void {
  diagnostics.steps.push({
    stage,
    status,
    detail: summarizeDiagnosticValue(detail),
  });
}

function attachVodPlaybackDiagnostics<T extends object>(
  target: T,
  diagnostics: VodPlaybackDiagnostics,
  field: keyof VodPlaybackDiagnosticCarrier,
): T {
  Object.defineProperty(target, field, {
    value: cloneVodPlaybackDiagnostics(diagnostics),
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return target;
}

function finalizeResolvedStream(
  stream: VodResolvedStream,
  diagnostics: VodPlaybackDiagnostics,
): VodResolvedStream {
  appendPlaybackDiagnostic(
    diagnostics,
    'final',
    'success',
    `resolved_by=${stream.resolvedBy} skip_probe=${stream.skipProbe ? '1' : '0'} url=${stream.url}`,
  );
  return attachVodPlaybackDiagnostics(stream, diagnostics, 'diagnostics');
}

function buildVodPlaybackError(message: string, diagnostics: VodPlaybackDiagnostics): Error {
  appendPlaybackDiagnostic(diagnostics, 'final', 'error', message);
  return attachVodPlaybackDiagnostics(new Error(message), diagnostics, 'playbackDiagnostics');
}

export function getVodPlaybackDiagnostics(value: unknown): VodPlaybackDiagnostics | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const carrier = value as VodPlaybackDiagnosticCarrier;
  const diagnostics = carrier.diagnostics ?? carrier.playbackDiagnostics;
  if (!diagnostics || !Array.isArray(diagnostics.steps)) {
    return null;
  }

  return diagnostics;
}

export function normalizeVodKernelMode(mode: unknown): VodKernelMode {
  if (mode === 'mpv' || mode === 'direct' || mode === 'proxy') {
    return mode;
  }
  return 'direct';
}

export function unwrapPlayerPayload(resp: string | unknown): PlayerPayload {
  try {
    let data: unknown = resp;
    if (typeof resp === 'string') {
      data = JSON.parse(resp);
    }
    if (
      data &&
      typeof data === 'object' &&
      'result' in data &&
      ('ok' in data || 'className' in data)
    ) {
      data = (data as { result: unknown }).result;
    }
    if (typeof data === 'string') {
      const trimmed = data.trim();
      if (!trimmed) return {};
      data = JSON.parse(trimmed);
    }
    if (Array.isArray(data)) data = data.length > 0 ? data[0] : {};
    if (!data || typeof data !== 'object') return {};
    return data as PlayerPayload;
  } catch {
    return {};
  }
}

export function hasResolvablePlayerPayload(payload: PlayerPayload): boolean {
  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  if (url) {
    return true;
  }
  return Number(payload.parse ?? 0) === 1 || Number(payload.jx ?? 0) === 1;
}

function buildSpiderPayloadCacheKey(
  context: VodPlaybackContext,
  routeName: string,
  episodeId: string,
): string {
  return JSON.stringify([
    context.siteKey,
    context.apiClass,
    context.ext,
    routeName,
    episodeId,
  ]);
}

function readCachedSpiderPayload(cacheKey: string): PlayerPayload | null {
  const entry = spiderPayloadCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    spiderPayloadCache.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function writeCachedSpiderPayload(cacheKey: string, payload: PlayerPayload): void {
  spiderPayloadCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + SPIDER_PLAYER_PAYLOAD_CACHE_TTL_MS,
  });
}

function normalizeHeaderRecord(value: unknown): Record<string, string> | null {
  let data = value;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) return null;
    try {
      data = JSON.parse(trimmed);
    } catch {
      const entries = trimmed
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const splitAt = line.indexOf(':');
          if (splitAt <= 0) return null;
          return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()] as const;
        })
        .filter((entry): entry is readonly [string, string] => !!entry && !!entry[0] && !!entry[1]);
      if (entries.length === 0) {
        return null;
      }
      return Object.fromEntries(entries);
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const normalized = Object.entries(data as Record<string, unknown>).reduce<Record<string, string>>(
    (current, [key, rawValue]) => {
      const nextKey = String(key ?? '').trim();
      if (!nextKey) {
        return current;
      }
      if (typeof rawValue === 'string' && rawValue.trim()) {
        current[nextKey] = rawValue.trim();
        return current;
      }
      if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
        current[nextKey] = String(rawValue);
      }
      return current;
    },
    {},
  );

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function mergeHeaderRecords(
  ...records: Array<Record<string, string> | null | undefined>
): Record<string, string> | null {
  const merged = records.reduce<Record<string, string>>((current, record) => {
    if (!record) return current;
    Object.assign(current, record);
    return current;
  }, {});
  return Object.keys(merged).length > 0 ? merged : null;
}

export function extractPlayerHeaders(payload: PlayerPayload): Record<string, string> | null {
  const normalized =
    mergeHeaderRecords(
      normalizeHeaderRecord(payload.headers),
      normalizeHeaderRecord(payload.header),
    ) ?? {};

  const referer =
    typeof payload.referer === 'string'
      ? payload.referer.trim()
      : typeof payload.referrer === 'string'
        ? payload.referrer.trim()
        : typeof payload.Referer === 'string'
          ? payload.Referer.trim()
          : '';
  const userAgent =
    typeof payload['user-agent'] === 'string'
      ? payload['user-agent'].trim()
      : typeof payload['User-Agent'] === 'string'
        ? payload['User-Agent'].trim()
        : typeof payload.ua === 'string'
          ? payload.ua.trim()
          : '';

  if (referer) {
    normalized.Referer = referer;
  }
  if (userAgent) {
    normalized['User-Agent'] = userAgent;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isImageLikeUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|ico)(\?.*)?$/i.test(url);
}

export function looksLikeDirectPlayableUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  if (!normalized.startsWith('http')) return false;
  if (isImageLikeUrl(normalized)) return false;
  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.toLowerCase();
    if (/(\.m3u8|\.mp4|\.flv|\.mpd|\.m4s|\.ts|\.webm|\.mkv|\.mov)$/.test(pathname)) {
      return true;
    }
    if (/(^|\/)[^/?#]*\.(m3u8|mp4|flv|mpd|m4s|ts|webm|mkv|mov)(?:$|[?#])/.test(pathname)) {
      return true;
    }

    const typeHint = parsed.searchParams.get('type')?.toLowerCase() ?? '';
    const mimeHint = parsed.searchParams.get('mime')?.toLowerCase() ?? '';
    const contentTypeHint = parsed.searchParams.get('contenttype')?.toLowerCase() ?? '';
    if (typeHint === 'm3u8' || typeHint === 'mp4') {
      return true;
    }
    if (mimeHint.includes('video') || contentTypeHint.includes('video')) {
      return true;
    }
    return false;
  } catch {
    // Fall through to the legacy string heuristics for malformed-but-usable URLs.
  }
  return (
    /^https?:\/\/[^?#]+\.(m3u8|mp4|flv|mpd|m4s|ts|webm|mkv|mov)(?:[?#].*)?$/i.test(normalized) ||
    /[?&]mime=video/i.test(normalized) ||
    /[?&]contenttype=video/i.test(normalized) ||
    /[?&]type=(m3u8|mp4)/i.test(normalized)
  );
}

function buildSitePlayParse(context: VodPlaybackContext): TvBoxParse | null {
  if (!context.playUrl) return null;
  return {
    name: `${context.siteName || context.siteKey || '站点'} 站点解析`,
    type: 0,
    url: context.playUrl,
  };
}

function getEffectiveParses(context: VodPlaybackContext): TvBoxParse[] {
  const siteParse = buildSitePlayParse(context);
  return siteParse ? [siteParse, ...(context.parses ?? [])] : [...(context.parses ?? [])];
}

async function resolveWrappedPayloadUrl(
  targetUrl: string,
  headers?: Record<string, string> | null,
): Promise<string | null> {
  if (!isHttpUrl(targetUrl)) {
    return null;
  }
  try {
    const resolved = await invoke<string>('resolve_wrapped_media_url', {
      targetUrl,
      extraHeaders: headers ?? null,
    });
    return typeof resolved === 'string' && resolved.trim() ? resolved.trim() : null;
  } catch {
    return null;
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function invokeSpiderPlayerWithRetry(
  context: VodPlaybackContext,
  routeName: string,
  episodeId: string,
): Promise<{
  payload: PlayerPayload;
  response: Awaited<ReturnType<typeof invokeSpiderPlayerV2<PlayerPayload>>> | null;
  fromCache: boolean;
}> {
  const cacheKey = buildSpiderPayloadCacheKey(context, routeName, episodeId);
  const cachedPayload = readCachedSpiderPayload(cacheKey);
  if (cachedPayload && hasResolvablePlayerPayload(cachedPayload)) {
    return {
      payload: cachedPayload,
      response: null,
      fromCache: true,
    };
  }
  let lastPayload: PlayerPayload = {};
  let lastResponse: Awaited<ReturnType<typeof invokeSpiderPlayerV2<PlayerPayload>>> | null = null;

  for (let attempt = 0; attempt <= SPIDER_PLAYER_EMPTY_RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await invokeSpiderPlayerV2<PlayerPayload>({
      spiderUrl: context.spiderUrl,
      siteKey: context.siteKey,
      apiClass: context.apiClass,
      ext: context.ext,
      flag: routeName,
      id: episodeId,
      vipFlags: [],
    });
    const payload = unwrapPlayerPayload(response.normalizedPayload);
    lastPayload = payload;
    lastResponse = response;
    if (hasResolvablePlayerPayload(payload)) {
      break;
    }
    if (attempt === 0 && cachedPayload) {
      return {
        payload: cachedPayload,
        response: lastResponse,
        fromCache: true,
      };
    }
    if (attempt >= SPIDER_PLAYER_EMPTY_RETRY_DELAYS_MS.length) {
      break;
    }
    await delayMs(SPIDER_PLAYER_EMPTY_RETRY_DELAYS_MS[attempt] ?? 0);
  }

  if (hasResolvablePlayerPayload(lastPayload)) {
    writeCachedSpiderPayload(cacheKey, lastPayload);
    return {
      payload: lastPayload,
      response: lastResponse,
      fromCache: false,
    };
  }

  if (cachedPayload) {
    return {
      payload: cachedPayload,
      response: lastResponse,
      fromCache: true,
    };
  }

  return {
    payload: lastPayload,
    response: lastResponse,
    fromCache: false,
  };
}

export function shouldUseSpiderParseChain(
  payload: PlayerPayload,
  hasDirectPayloadUrl: boolean,
): boolean {
  const requiresJiexi = Number(payload.jx ?? 0) === 1;
  if (requiresJiexi) {
    return true;
  }
  if (!hasDirectPayloadUrl) {
    return Number(payload.parse ?? 0) === 1;
  }
  return false;
}

async function resolveByParse(
  context: VodPlaybackContext,
  routeName: string,
  pageUrl: string,
  upstreamHeaders?: Record<string, string> | null,
): Promise<VodResolvedStream | null> {
  const parseSelection = selectVodParses(getEffectiveParses(context), {
    jxIndex: 1,
    routeName,
    pageUrl,
  });
  if (parseSelection.ordered.length === 0) {
    return null;
  }

  let lastError = '';
  for (const parse of parseSelection.ordered) {
    const parseHeaders = mergeHeaderRecords(parse.ext?.header ?? null, upstreamHeaders);
    const parseRequest = resolveRequestPolicy(
      parse.url,
      parseHeaders,
      context.requestHeaders,
      context.hostMappings,
    );
    try {
      const resolvedUrl = await invoke<string>('resolve_jiexi', {
        jiexiPrefix: parseRequest.url,
        videoUrl: pageUrl,
        extraHeaders: parseRequest.headers,
      });
      if (resolvedUrl && !isImageLikeUrl(resolvedUrl)) {
        const resolvedTarget = resolveRequestPolicy(
          resolvedUrl,
          parseHeaders,
          context.requestHeaders,
          context.hostMappings,
        );
        return {
          url: resolvedTarget.url,
          headers: resolvedTarget.headers,
          resolvedBy: 'jiexi',
        };
      }
      lastError = '解析返回了非视频地址。';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      if (message.includes('jiexi_needs_browser')) {
        const browserPolicy = buildBrowserParsePolicy(
          context.click,
          context.playbackRules,
          pageUrl,
        );
        try {
          const browserResolved = await invoke<string>('resolve_jiexi_webview', {
            jiexiPrefix: parseRequest.url,
            videoUrl: pageUrl,
            timeoutMs: 25000,
            visible: false,
            clickActions: browserPolicy.actions as BrowserClickAction[],
          });
          if (browserResolved && !isImageLikeUrl(browserResolved)) {
            const resolvedTarget = resolveRequestPolicy(
              browserResolved,
              parseHeaders,
              context.requestHeaders,
              context.hostMappings,
            );
            return {
              url: resolvedTarget.url,
              headers: resolvedTarget.headers,
              resolvedBy: 'jiexi-webview',
            };
          }
          lastError = '浏览器解析返回了非视频地址。';
        } catch (browserError) {
          const browserMessage =
            browserError instanceof Error ? browserError.message : String(browserError);
          lastError =
            browserPolicy.ignoredEntries.length > 0
              ? `${browserMessage}（另有 ${browserPolicy.ignoredEntries.length} 条点击脚本因不在白名单内被跳过）`
              : browserMessage;
        }
      }
    }
  }

  throw new Error(lastError || '当前解析链路不可用。');
}

async function resolveUrlWithParseAndWebviewFallback(
  context: VodPlaybackContext,
  routeName: string,
  targetUrl: string,
  extraHeaders: Record<string, string> | null,
): Promise<VodResolvedStream | null> {
  let parsed: VodResolvedStream | null = null;
  try {
    parsed = await resolveByParse(context, routeName, targetUrl, extraHeaders);
  } catch (e) {
    // Fall back below
  }

  if (parsed) {
    return parsed;
  }

  if (!looksLikeDirectPlayableUrl(targetUrl)) {
    try {
      const browserPolicy = buildBrowserParsePolicy(context.click, context.playbackRules, targetUrl);
      const browserResolved = await invoke<string>('resolve_jiexi_webview', {
        jiexiPrefix: targetUrl,
        videoUrl: '',
        timeoutMs: 25000,
        visible: false,
        clickActions: browserPolicy.actions as BrowserClickAction[],
      });
      if (browserResolved && !isImageLikeUrl(browserResolved)) {
        const resolvedTarget = resolveRequestPolicy(
          browserResolved,
          extraHeaders,
          context.requestHeaders,
          context.hostMappings,
        );
        return {
          url: resolvedTarget.url,
          headers: resolvedTarget.headers,
          resolvedBy: 'jiexi-webview',
        };
      }
    } catch (e) {
      // Ignored
    }
  }

  return null;
}

export function buildNoUrlMessage(
  payload: PlayerPayload,
  id: string,
  hasParseCandidates: boolean,
): string {
  if (id.startsWith('msearch:')) return '当前搜索结果没有可播放地址。';
  if (Number(payload.parse ?? 0) === 1 || Number(payload.jx ?? 0) === 1) {
    return hasParseCandidates
      ? '当前站点要求解析，但解析服务没有返回可播放地址。'
      : '当前站点要求解析，但当前没有可用解析服务。';
  }
  if (payload.url && typeof payload.url === 'string' && isImageLikeUrl(payload.url)) {
    return '当前返回的是图片地址，不是可播放视频。';
  }
  return '当前接口没有返回可播放地址。';
}

async function resolveEpisodePlaybackLegacy(
  context: VodPlaybackContext,
  episode: VodEpisode,
  routeName: string,
): Promise<VodResolvedStream> {
  if (context.sourceKind === 'spider') {
    const { payload } = await invokeSpiderPlayerWithRetry(context, routeName, episode.url);
    const payloadHeaders = extractPlayerHeaders(payload);
    const payloadUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
    const hasDirectPayloadUrl = isHttpUrl(payloadUrl) && !isImageLikeUrl(payloadUrl);
    const parseRequired = shouldUseSpiderParseChain(payload, hasDirectPayloadUrl);
    const payloadLooksDirectPlayable =
      hasDirectPayloadUrl && looksLikeDirectPlayableUrl(payloadUrl);
    if (payloadLooksDirectPlayable) {
      const resolvedPayload = resolveRequestPolicy(
        payloadUrl,
        payloadHeaders,
        context.requestHeaders,
        context.hostMappings,
      );
      return {
        url: resolvedPayload.url,
        headers: resolvedPayload.headers,
        resolvedBy: 'spider',
      };
    }

    if (hasDirectPayloadUrl && !parseRequired) {
      const wrappedPlayableUrl = await resolveWrappedPayloadUrl(payloadUrl, payloadHeaders);
      if (wrappedPlayableUrl) {
        if (Number(payload.parse ?? 0) === 1 && wrappedPlayableUrl === payloadUrl) {
          const parsedWrappedPayload = await withTimeout(
            resolveByParse(
              context,
              routeName,
              payloadUrl,
              payloadHeaders,
            ),
            WRAPPED_PARSE_FALLBACK_TIMEOUT_MS,
            'wrapped parse fallback',
          ).catch(() => null);
          if (parsedWrappedPayload) {
            return parsedWrappedPayload;
          }
        }
        const resolvedWrapped = resolveRequestPolicy(
          wrappedPlayableUrl,
          payloadHeaders,
          context.requestHeaders,
          context.hostMappings,
        );
        return {
          url: resolvedWrapped.url,
          headers: resolvedWrapped.headers,
          resolvedBy: 'spider',
          skipProbe: wrappedPlayableUrl === payloadUrl,
        };
      }

      if (Number(payload.parse ?? 0) === 1 || !payloadLooksDirectPlayable) {
        const parsedWrappedPayload = await withTimeout(
          resolveUrlWithParseAndWebviewFallback(
            context,
            routeName,
            payloadUrl,
            payloadHeaders,
          ),
          25000, // WebView requires more time
          'wrapped parse fallback',
        ).catch(() => null);

        if (parsedWrappedPayload) {
          return parsedWrappedPayload;
        }
      }

      const resolvedPayload = resolveRequestPolicy(
        payloadUrl,
        payloadHeaders,
        context.requestHeaders,
        context.hostMappings,
      );
      return {
        url: resolvedPayload.url,
        headers: resolvedPayload.headers,
        resolvedBy: 'spider',
        skipProbe: true,
      };
    }

    const parseTarget = hasDirectPayloadUrl
      ? payloadUrl
      : isHttpUrl(episode.url)
        ? episode.url
        : '';
    if (parseTarget) {
      const parsed = await resolveUrlWithParseAndWebviewFallback(context, routeName, parseTarget, payloadHeaders);
      if (parsed) {
        return parsed;
      }
    }

    if (isHttpUrl(episode.url) && looksLikeDirectPlayableUrl(episode.url)) {
      const resolvedEpisode = resolveRequestPolicy(
        episode.url,
        payloadHeaders,
        context.requestHeaders,
        context.hostMappings,
      );
      return {
        url: resolvedEpisode.url,
        headers: resolvedEpisode.headers,
        resolvedBy: 'direct',
      };
    }

    throw new Error(
      buildNoUrlMessage(payload, episode.url, getEffectiveParses(context).length > 0),
    );
  }

  if (!isHttpUrl(episode.url)) {
    throw new Error('当前剧集未提供可解析地址。');
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
      resolvedBy: 'direct',
    };
  }

  const parsed = await resolveUrlWithParseAndWebviewFallback(context, routeName, episode.url, null);
  if (parsed) {
    return parsed;
  }

  if (context.playUrl || (context.parses?.length ?? 0) > 0) {
    throw new Error('当前解析链路未返回可播地址。请切换线路或解析器。');
  }

  throw new Error('当前剧集需要解析，但没有可用解析器。请补充 playUrl 或全局 parses。');
}

void resolveEpisodePlaybackLegacy;

export async function resolveEpisodePlayback(
  context: VodPlaybackContext,
  episode: VodEpisode,
  routeName: string,
): Promise<VodResolvedStream> {
  const diagnostics = createVodPlaybackDiagnostics();

  if (context.sourceKind === 'spider') {
    let spiderPayloadResult: Awaited<ReturnType<typeof invokeSpiderPlayerWithRetry>>;
    try {
      spiderPayloadResult = await invokeSpiderPlayerWithRetry(context, routeName, episode.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendPlaybackDiagnostic(diagnostics, 'spider_payload', 'error', message);
      throw buildVodPlaybackError(message, diagnostics);
    }

    const { payload, fromCache } = spiderPayloadResult;
    const payloadHeaders = extractPlayerHeaders(payload);
    const payloadUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
    const hasDirectPayloadUrl = isHttpUrl(payloadUrl) && !isImageLikeUrl(payloadUrl);
    const parseRequired = shouldUseSpiderParseChain(payload, hasDirectPayloadUrl);
    const payloadLooksDirectPlayable =
      hasDirectPayloadUrl && looksLikeDirectPlayableUrl(payloadUrl);

    appendPlaybackDiagnostic(
      diagnostics,
      'spider_payload',
      hasResolvablePlayerPayload(payload) ? 'success' : 'miss',
      `cache=${fromCache ? '1' : '0'} parse=${Number(payload.parse ?? 0)} jx=${Number(payload.jx ?? 0)} direct=${hasDirectPayloadUrl ? '1' : '0'} url=${payloadUrl || 'empty'}`,
    );

    if (payloadLooksDirectPlayable) {
      const resolvedPayload = resolveRequestPolicy(
        payloadUrl,
        payloadHeaders,
        context.requestHeaders,
        context.hostMappings,
      );
      return finalizeResolvedStream(
        {
          url: resolvedPayload.url,
          headers: resolvedPayload.headers,
          resolvedBy: 'spider',
        },
        diagnostics,
      );
    }

    if (hasDirectPayloadUrl && !parseRequired) {
      appendPlaybackDiagnostic(
        diagnostics,
        'wrapped_url',
        'skip',
        `target=${payloadUrl} reason=payload_not_parse_required`,
      );

      const wrappedPlayableUrl = await resolveWrappedPayloadUrl(payloadUrl, payloadHeaders);
      if (wrappedPlayableUrl) {
        appendPlaybackDiagnostic(
          diagnostics,
          'wrapped_url',
          'success',
          `target=${payloadUrl} resolved=${wrappedPlayableUrl}`,
        );

        if (Number(payload.parse ?? 0) === 1 && wrappedPlayableUrl === payloadUrl) {
          const parsedWrappedPayload = await withTimeout(
            resolveByParse(
              context,
              routeName,
              payloadUrl,
              payloadHeaders,
            ),
            WRAPPED_PARSE_FALLBACK_TIMEOUT_MS,
            'wrapped parse fallback',
          ).catch((error) => {
            appendPlaybackDiagnostic(
              diagnostics,
              'parse_chain',
              'error',
              `target=${payloadUrl} reason=${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
          });
          if (parsedWrappedPayload) {
            appendPlaybackDiagnostic(
              diagnostics,
              'parse_chain',
              'success',
              `target=${payloadUrl} resolved_by=${parsedWrappedPayload.resolvedBy}`,
            );
            return finalizeResolvedStream(parsedWrappedPayload, diagnostics);
          }
        }

        const resolvedWrapped = resolveRequestPolicy(
          wrappedPlayableUrl,
          payloadHeaders,
          context.requestHeaders,
          context.hostMappings,
        );
        return finalizeResolvedStream(
          {
            url: resolvedWrapped.url,
            headers: resolvedWrapped.headers,
            resolvedBy: 'spider',
            skipProbe: wrappedPlayableUrl === payloadUrl,
          },
          diagnostics,
        );
      }

      appendPlaybackDiagnostic(
        diagnostics,
        'wrapped_url',
        'miss',
        `target=${payloadUrl} reason=not_resolved`,
      );

      if (Number(payload.parse ?? 0) === 1 || !payloadLooksDirectPlayable) {
        const parsedWrappedPayload = await withTimeout(
          resolveUrlWithParseAndWebviewFallback(
            context,
            routeName,
            payloadUrl,
            payloadHeaders,
          ),
          25000,
          'wrapped parse fallback',
        ).catch((error) => {
          appendPlaybackDiagnostic(
            diagnostics,
            'parse_chain',
            'error',
            `target=${payloadUrl} reason=${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        });

        if (parsedWrappedPayload) {
          appendPlaybackDiagnostic(
            diagnostics,
            'parse_chain',
            'success',
            `target=${payloadUrl} resolved_by=${parsedWrappedPayload.resolvedBy}`,
          );
          return finalizeResolvedStream(parsedWrappedPayload, diagnostics);
        }
      }

      appendPlaybackDiagnostic(
        diagnostics,
        'direct_fallback',
        'success',
        `source=payload target=${payloadUrl}`,
      );
      const resolvedPayload = resolveRequestPolicy(
        payloadUrl,
        payloadHeaders,
        context.requestHeaders,
        context.hostMappings,
      );
      return finalizeResolvedStream(
        {
          url: resolvedPayload.url,
          headers: resolvedPayload.headers,
          resolvedBy: 'spider',
          skipProbe: true,
        },
        diagnostics,
      );
    }

    const parseTarget = hasDirectPayloadUrl
      ? payloadUrl
      : isHttpUrl(episode.url)
        ? episode.url
        : '';
    if (parseTarget) {
      const parsed = await resolveUrlWithParseAndWebviewFallback(
        context,
        routeName,
        parseTarget,
        payloadHeaders,
      ).catch((error) => {
        appendPlaybackDiagnostic(
          diagnostics,
          'parse_chain',
          'error',
          `target=${parseTarget} reason=${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      });
      if (parsed) {
        appendPlaybackDiagnostic(
          diagnostics,
          'parse_chain',
          'success',
          `target=${parseTarget} resolved_by=${parsed.resolvedBy}`,
        );
        return finalizeResolvedStream(parsed, diagnostics);
      }
      appendPlaybackDiagnostic(
        diagnostics,
        'parse_chain',
        'miss',
        `target=${parseTarget} reason=no_result`,
      );
    }

    if (isHttpUrl(episode.url) && looksLikeDirectPlayableUrl(episode.url)) {
      appendPlaybackDiagnostic(
        diagnostics,
        'episode_direct',
        'success',
        `target=${episode.url}`,
      );
      const resolvedEpisode = resolveRequestPolicy(
        episode.url,
        payloadHeaders,
        context.requestHeaders,
        context.hostMappings,
      );
      return finalizeResolvedStream(
        {
          url: resolvedEpisode.url,
          headers: resolvedEpisode.headers,
          resolvedBy: 'direct',
        },
        diagnostics,
      );
    }

    throw buildVodPlaybackError(
      buildNoUrlMessage(payload, episode.url, getEffectiveParses(context).length > 0),
      diagnostics,
    );
  }

  if (!isHttpUrl(episode.url)) {
    appendPlaybackDiagnostic(
      diagnostics,
      'episode_direct',
      'error',
      `target=${episode.url || 'empty'} reason=not_http_url`,
    );
    throw buildVodPlaybackError('episode does not provide a resolvable url', diagnostics);
  }

  if (looksLikeDirectPlayableUrl(episode.url)) {
    appendPlaybackDiagnostic(diagnostics, 'episode_direct', 'success', `target=${episode.url}`);
    const resolvedEpisode = resolveRequestPolicy(
      episode.url,
      null,
      context.requestHeaders,
      context.hostMappings,
    );
    return finalizeResolvedStream(
      {
        url: resolvedEpisode.url,
        headers: resolvedEpisode.headers,
        resolvedBy: 'direct',
      },
      diagnostics,
    );
  }

  const parsed = await resolveUrlWithParseAndWebviewFallback(
    context,
    routeName,
    episode.url,
    null,
  ).catch((error) => {
    appendPlaybackDiagnostic(
      diagnostics,
      'parse_chain',
      'error',
      `target=${episode.url} reason=${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  });
  if (parsed) {
    appendPlaybackDiagnostic(
      diagnostics,
      'parse_chain',
      'success',
      `target=${episode.url} resolved_by=${parsed.resolvedBy}`,
    );
    return finalizeResolvedStream(parsed, diagnostics);
  }

  appendPlaybackDiagnostic(diagnostics, 'parse_chain', 'miss', `target=${episode.url} reason=no_result`);

  if (context.playUrl || (context.parses?.length ?? 0) > 0) {
    throw buildVodPlaybackError(
      'parse chain did not return a playable url. Please switch route or parser.',
      diagnostics,
    );
  }

  throw buildVodPlaybackError(
    'episode requires parsing but no playUrl or global parses are configured.',
    diagnostics,
  );
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
