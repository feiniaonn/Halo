import { invoke } from '@tauri-apps/api/core';

import {
  buildBrowserParsePolicy,
  type BrowserClickAction,
} from '@/modules/media/services/browserParsePolicy';
import { invokeSpiderPlayerV2 } from '@/modules/media/services/spiderV2';
import {
  listCachedVodParseSignals,
  noteVodParseFailure,
  noteVodParseSuccess,
} from '@/modules/media/services/vodParseInsights';
import {
  appendPlaybackDiagnostic,
  attachVodPlaybackDiagnostics,
  buildVodPlaybackError,
  createVodPlaybackDiagnostics,
} from '@/modules/media/services/vodPlaybackDiagnostics';
import {
  classifyVodParseFailure,
} from '@/modules/media/services/vodParseHealth';
import {
  buildNoUrlMessage,
  delayMs,
  extractPlayerHeaders,
  hasResolvablePlayerPayload,
  isHttpUrl,
  isImageLikeUrl,
  looksLikeDirectPlayableUrl,
  looksLikeWrappedMediaUrl,
  mergeHeaderRecords,
  sanitizeMediaUrlCandidate,
  unwrapPlayerPayload,
} from '@/modules/media/services/vodPlaybackPayloadUtils';
import { selectVodParses } from '@/modules/media/services/vodParseResolver';
import { resolveWithStoredVodPlaybackResolution } from '@/modules/media/services/vodPlaybackResolutionStore';
import { probeVodStream } from '@/modules/media/services/vodStreamProbe';
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
import type {
  VodPlaybackDiagnostics,
} from '@/modules/media/services/vodPlaybackDiagnostics';

export {
  getVodPlaybackDiagnosticsElapsedMs,
  getVodPlaybackDiagnostics,
  type VodPlaybackDiagnosticStage,
  type VodPlaybackDiagnosticStatus,
  type VodPlaybackDiagnosticStep,
  type VodPlaybackDiagnostics,
} from '@/modules/media/services/vodPlaybackDiagnostics';
export {
  buildNoUrlMessage,
  extractPlayerHeaders,
  hasResolvablePlayerPayload,
  looksLikeDirectPlayableUrl,
} from '@/modules/media/services/vodPlaybackPayloadUtils';
export { clearVodParseRankingCache } from '@/modules/media/services/vodParseInsights';

export interface PlayerPayload {
  url?: string;
  parse?: number;
  jx?: number;
  header?: unknown;
  headers?: unknown;
  [key: string]: unknown;
}

export interface VodPlaybackContext {
  sourceKey?: string;
  repoUrl?: string;
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
  resolvedBy: 'spider' | 'direct' | 'jiexi' | 'jiexi-webview';
  skipProbe?: boolean;
  diagnostics?: VodPlaybackDiagnostics;
}

const SPIDER_PLAYER_EMPTY_RETRY_DELAYS_MS = [300];
const SPIDER_PLAYER_PAYLOAD_CACHE_TTL_MS = 2 * 60 * 1000;
const QUICK_PARSE_HTTP_TIMEOUT_MS = 2200;
const QUICK_PARSE_TOTAL_TIMEOUT_MS = 8500;
const QUICK_PARSE_MIN_TIMEOUT_MS = 800;
const QUICK_PARSE_BROWSER_ATTEMPT_TIMEOUT_MS = 3200;
const QUICK_PARSE_MAX_BROWSER_ATTEMPTS = 2;
const QUICK_PARSE_VALIDATION_TIMEOUT_MS = 1400;
const WRAPPED_PARSE_CHAIN_BUDGET_MS = 6500;

interface CachedSpiderPayloadEntry {
  payload: PlayerPayload;
  expiresAt: number;
}

const spiderPayloadCache = new Map<string, CachedSpiderPayloadEntry>();

export function clearSpiderPlayerPayloadCache(): void {
  spiderPayloadCache.clear();
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

export function normalizeVodKernelMode(mode: unknown): VodKernelMode {
  if (mode === 'mpv' || mode === 'direct' || mode === 'proxy') {
    return mode;
  }
  return 'direct';
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

function buildPlaybackResolutionCacheKey(
  context: VodPlaybackContext,
  episode: VodEpisode,
  routeName: string,
): string {
  return JSON.stringify([
    context.sourceKey?.trim() ?? '',
    context.repoUrl?.trim() ?? '',
    context.sourceKind,
    context.siteKey,
    context.apiClass,
    context.ext,
    routeName,
    episode.url,
    context.playUrl?.trim() ?? '',
    context.click?.trim() ?? '',
    context.requestHeaders ?? [],
    context.hostMappings ?? [],
    context.playbackRules ?? [],
    getEffectiveParses(context).map((parse) => `${parse.type}:${parse.url.trim()}`),
  ]);
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

function getRemainingParseBudgetMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

function clampParseAttemptTimeout(remainingMs: number, preferredMs: number): number {
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.max(
    QUICK_PARSE_MIN_TIMEOUT_MS,
    Math.min(preferredMs, remainingMs),
  );
}

function getValidationProbeTimeoutMs(remainingMs: number): number | undefined {
  const timeoutMs = clampParseAttemptTimeout(remainingMs, QUICK_PARSE_VALIDATION_TIMEOUT_MS);
  return timeoutMs >= QUICK_PARSE_MIN_TIMEOUT_MS ? timeoutMs : undefined;
}

function shouldRejectProbeResult(reason: string | null): boolean {
  if (!reason) {
    return false;
  }
  return (
    reason === 'stream_probe_hls_image_manifest'
    || reason === 'stream_probe_hls_html_manifest'
    || reason === 'stream_probe_hls_manifest_unreadable'
    || reason === 'stream_probe_audio_only'
  );
}

async function validateResolvedStreamCandidate(
  stream: VodResolvedStream,
  options?: { timeoutMs?: number },
): Promise<{ stream: VodResolvedStream | null; reason: string | null }> {
  const sanitizedUrl = sanitizeMediaUrlCandidate(stream.url) || stream.url.trim();
  if (sanitizedUrl !== stream.url) {
    stream = {
      ...stream,
      url: sanitizedUrl,
    };
  }
  if (!looksLikeDirectPlayableUrl(stream.url)) {
    if (looksLikeWrappedMediaUrl(stream.url)) {
      return {
        stream: null,
        reason: 'parse result is not directly playable',
      };
    }
    return { stream, reason: null };
  }

  const inferredHlsLike = /(\.m3u8|[?&]type=m3u8|\/m3u8\/)/i.test(stream.url);
  if (!inferredHlsLike) {
    return { stream, reason: null };
  }

  try {
    const probe = await probeVodStream(stream.url, stream.headers, {
      timeoutMs: options?.timeoutMs,
    });
    if (probe.finalUrl && probe.finalUrl !== stream.url) {
      stream = {
        ...stream,
        url: probe.finalUrl,
      };
    }
    if (probe.kind === 'unknown' && shouldRejectProbeResult(probe.reason)) {
      return {
        stream: null,
        reason: probe.reason ?? 'stream_probe_unknown',
      };
    }
  } catch {
    // Probe failures should not discard a potentially valid stream.
  }

  return { stream, reason: null };
}

async function resolveWrappedPayloadUrl(
  targetUrl: string,
  headers?: Record<string, string> | null,
  timeoutMs?: number,
): Promise<string | null> {
  if (!isHttpUrl(targetUrl)) {
    return null;
  }
  try {
    const resolved = await invoke<string>('resolve_wrapped_media_url', {
      targetUrl,
      extraHeaders: headers ?? null,
      timeoutMs: timeoutMs ?? null,
    });
    const normalizedResolved = sanitizeMediaUrlCandidate(resolved);
    return normalizedResolved || (typeof resolved === 'string' && resolved.trim() ? resolved.trim() : null);
  } catch {
    return null;
  }
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
  if (Number(payload.parse ?? 0) === 1) {
    return true;
  }
  if (Number(payload.jx ?? 0) === 1) {
    return true;
  }
  if (!hasDirectPayloadUrl) {
    return true;
  }
  return false;
}

async function resolveByParse(
  context: VodPlaybackContext,
  routeName: string,
  pageUrl: string,
  upstreamHeaders?: Record<string, string> | null,
  options?: {
    timeBudgetMs?: number;
    allowBrowser?: boolean;
    diagnostics?: VodPlaybackDiagnostics;
  },
): Promise<VodResolvedStream | null> {
  const { rankingRecords, healthRecords } = await listCachedVodParseSignals(context, routeName);
  const parseSelection = selectVodParses(getEffectiveParses(context), {
    jxIndex: 1,
    routeName,
    pageUrl,
    rankingRecords,
    healthRecords,
  });
  if (parseSelection.ordered.length === 0) {
    return null;
  }

  const diagnostics = options?.diagnostics;
  let lastError = '';
  const deadlineAt = Date.now() + (options?.timeBudgetMs ?? QUICK_PARSE_TOTAL_TIMEOUT_MS);
  const browserCandidates: Array<{
    parseUrl: string;
    parseHeaders: Record<string, string> | null;
    parseRequest: ReturnType<typeof resolveRequestPolicy>;
  }> = [];

  for (const parse of parseSelection.ordered) {
    const remainingMs = getRemainingParseBudgetMs(deadlineAt);
    if (remainingMs < QUICK_PARSE_MIN_TIMEOUT_MS) {
      if (diagnostics) {
        appendPlaybackDiagnostic(
          diagnostics,
          'parse_attempt',
          'skip',
          `parser=${parse.url} reason=budget_exhausted`,
          { budgetMs: remainingMs },
        );
      }
      break;
    }
    const parseHeaders = mergeHeaderRecords(parse.ext?.header ?? null, upstreamHeaders);
    const parseRequest = resolveRequestPolicy(
      parse.url,
      parseHeaders,
      context.requestHeaders,
      context.hostMappings,
    );
    const attemptTimeoutMs = clampParseAttemptTimeout(remainingMs, QUICK_PARSE_HTTP_TIMEOUT_MS);
    const attemptStartedAt = Date.now();
    try {
      const rawResolvedUrl = await invoke<string>('resolve_jiexi', {
        jiexiPrefix: parseRequest.url,
        videoUrl: pageUrl,
        extraHeaders: parseRequest.headers,
        timeoutMs: attemptTimeoutMs,
      });
      const resolvedUrl = sanitizeMediaUrlCandidate(rawResolvedUrl);
      const attemptDurationMs = Date.now() - attemptStartedAt;
      if (resolvedUrl && !isImageLikeUrl(resolvedUrl)) {
        const resolvedTarget = resolveRequestPolicy(
          resolvedUrl,
          parseHeaders,
          context.requestHeaders,
          context.hostMappings,
        );
        const validationTimeoutMs = getValidationProbeTimeoutMs(
          getRemainingParseBudgetMs(deadlineAt),
        );
        const validated = await validateResolvedStreamCandidate({
          url: resolvedTarget.url,
          headers: resolvedTarget.headers,
          resolvedBy: 'jiexi',
        }, {
          timeoutMs: validationTimeoutMs,
        });
        if (validated.stream) {
          if (diagnostics) {
            appendPlaybackDiagnostic(
              diagnostics,
              'parse_attempt',
              'success',
              `parser=${parse.url} mode=http resolved=${validated.stream.url}`,
              { budgetMs: attemptTimeoutMs },
            );
          }
          await noteVodParseSuccess(context, routeName, parse.url, attemptDurationMs);
          return validated.stream;
        }
        lastError = validated.reason ?? '解析返回了不可播放地址。';
        if (diagnostics) {
          appendPlaybackDiagnostic(
            diagnostics,
            'parse_attempt',
            'miss',
            `parser=${parse.url} mode=http reason=${validated.reason ?? 'stream_probe_unknown'}`,
            { budgetMs: attemptTimeoutMs },
          );
        }
        await noteVodParseFailure(
          context,
          routeName,
          parse.url,
          classifyVodParseFailure(
            validated.reason ?? 'stream_probe_unknown',
            { validationReason: validated.reason },
          ),
          attemptDurationMs,
        );
        continue;
      }
      lastError = '解析返回了非视频地址。';
      if (diagnostics) {
        appendPlaybackDiagnostic(
          diagnostics,
          'parse_attempt',
          'miss',
          `parser=${parse.url} mode=http reason=${lastError || 'non_media_payload'}`,
          { budgetMs: attemptTimeoutMs },
        );
      }
      await noteVodParseFailure(
        context,
        routeName,
        parse.url,
        classifyVodParseFailure(lastError || 'non_media_payload'),
        attemptDurationMs,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attemptDurationMs = Date.now() - attemptStartedAt;
      lastError = message;
      if (message.includes('jiexi_needs_browser')) {
        browserCandidates.push({ parseUrl: parse.url, parseHeaders, parseRequest });
        if (diagnostics) {
          appendPlaybackDiagnostic(
            diagnostics,
            'parse_attempt',
            'skip',
            `parser=${parse.url} reason=browser_required`,
            { budgetMs: attemptTimeoutMs },
          );
        }
        continue;
      }
      if (diagnostics) {
        appendPlaybackDiagnostic(
          diagnostics,
          'parse_attempt',
          'error',
          `parser=${parse.url} mode=http reason=${message}`,
          { budgetMs: attemptTimeoutMs },
        );
      }
      await noteVodParseFailure(
        context,
        routeName,
        parse.url,
        classifyVodParseFailure(message),
        attemptDurationMs,
      );
    }
  }

  if (options?.allowBrowser !== false && browserCandidates.length > 0) {
    const browserPolicy = buildBrowserParsePolicy(
      context.click,
      context.playbackRules,
      pageUrl,
    );
    for (const candidate of browserCandidates.slice(0, QUICK_PARSE_MAX_BROWSER_ATTEMPTS)) {
      const remainingMs = getRemainingParseBudgetMs(deadlineAt);
      if (remainingMs < QUICK_PARSE_MIN_TIMEOUT_MS) {
        break;
      }
      const browserTimeoutMs = clampParseAttemptTimeout(
        remainingMs,
        QUICK_PARSE_BROWSER_ATTEMPT_TIMEOUT_MS,
      );
      const attemptStartedAt = Date.now();
      try {
        const rawBrowserResolved = await invoke<string>('resolve_jiexi_webview', {
          jiexiPrefix: candidate.parseRequest.url,
          videoUrl: pageUrl,
          timeoutMs: browserTimeoutMs,
          visible: false,
          clickActions: browserPolicy.actions as BrowserClickAction[],
        });
        const browserResolved = sanitizeMediaUrlCandidate(rawBrowserResolved);
        const attemptDurationMs = Date.now() - attemptStartedAt;
        if (browserResolved && !isImageLikeUrl(browserResolved)) {
          const resolvedTarget = resolveRequestPolicy(
            browserResolved,
            candidate.parseHeaders,
            context.requestHeaders,
            context.hostMappings,
          );
          const validationTimeoutMs = getValidationProbeTimeoutMs(
            getRemainingParseBudgetMs(deadlineAt),
          );
          const validated = await validateResolvedStreamCandidate({
            url: resolvedTarget.url,
            headers: resolvedTarget.headers,
            resolvedBy: 'jiexi-webview',
          }, {
            timeoutMs: validationTimeoutMs,
          });
          if (validated.stream) {
            if (diagnostics) {
              appendPlaybackDiagnostic(
                diagnostics,
                'webview_parse',
                'success',
                `parser=${candidate.parseUrl} resolved=${validated.stream.url}`,
                { budgetMs: browserTimeoutMs },
              );
            }
            await noteVodParseSuccess(context, routeName, candidate.parseUrl, attemptDurationMs);
            return validated.stream;
          }
          lastError = validated.reason ?? '浏览器解析返回了不可播放地址。';
          if (diagnostics) {
            appendPlaybackDiagnostic(
              diagnostics,
              'webview_parse',
              'miss',
              `parser=${candidate.parseUrl} reason=${validated.reason ?? 'stream_probe_unknown'}`,
              { budgetMs: browserTimeoutMs },
            );
          }
          await noteVodParseFailure(
            context,
            routeName,
            candidate.parseUrl,
            classifyVodParseFailure(
              validated.reason ?? 'stream_probe_unknown',
              { validationReason: validated.reason },
            ),
            attemptDurationMs,
          );
          continue;
        }
        lastError = '浏览器解析返回了非视频地址。';
        if (diagnostics) {
          appendPlaybackDiagnostic(
            diagnostics,
            'webview_parse',
            'miss',
            `parser=${candidate.parseUrl} reason=${lastError || 'non_media_payload'}`,
            { budgetMs: browserTimeoutMs },
          );
        }
        await noteVodParseFailure(
          context,
          routeName,
          candidate.parseUrl,
          classifyVodParseFailure(lastError || 'non_media_payload'),
          attemptDurationMs,
        );
      } catch (browserError) {
        const browserMessage =
          browserError instanceof Error ? browserError.message : String(browserError);
        const attemptDurationMs = Date.now() - attemptStartedAt;
        lastError =
          browserPolicy.ignoredEntries.length > 0
            ? `${browserMessage}（另有 ${browserPolicy.ignoredEntries.length} 条点击脚本因不在白名单内被跳过）`
            : browserMessage;
        if (diagnostics) {
          appendPlaybackDiagnostic(
            diagnostics,
            'webview_parse',
            'error',
            `parser=${candidate.parseUrl} reason=${lastError}`,
            { budgetMs: browserTimeoutMs },
          );
        }
        await noteVodParseFailure(
          context,
          routeName,
          candidate.parseUrl,
          classifyVodParseFailure(browserMessage),
          attemptDurationMs,
        );
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
  options?: {
    timeBudgetMs?: number;
    diagnostics?: VodPlaybackDiagnostics;
  },
): Promise<VodResolvedStream | null> {
  const deadlineAt = Date.now() + (options?.timeBudgetMs ?? QUICK_PARSE_TOTAL_TIMEOUT_MS);
  const diagnostics = options?.diagnostics;
  let parsed: VodResolvedStream | null = null;
  try {
    parsed = await resolveByParse(context, routeName, targetUrl, extraHeaders, {
      timeBudgetMs: getRemainingParseBudgetMs(deadlineAt),
      diagnostics,
    });
  } catch (e) {
    // Fall back below
  }

  if (parsed) {
    return parsed;
  }

  if (!looksLikeDirectPlayableUrl(targetUrl)) {
    try {
      const remainingMs = getRemainingParseBudgetMs(deadlineAt);
      const browserTimeoutMs = clampParseAttemptTimeout(
        remainingMs,
        QUICK_PARSE_BROWSER_ATTEMPT_TIMEOUT_MS,
      );
      if (browserTimeoutMs < QUICK_PARSE_MIN_TIMEOUT_MS) {
        if (diagnostics) {
          appendPlaybackDiagnostic(
            diagnostics,
            'webview_parse',
            'skip',
            `target=${targetUrl} reason=budget_exhausted`,
            { budgetMs: remainingMs },
          );
        }
        return null;
      }
      const browserPolicy = buildBrowserParsePolicy(context.click, context.playbackRules, targetUrl);
      const rawBrowserResolved = await invoke<string>('resolve_jiexi_webview', {
        jiexiPrefix: targetUrl,
        videoUrl: '',
        timeoutMs: browserTimeoutMs,
        visible: false,
        clickActions: browserPolicy.actions as BrowserClickAction[],
      });
      const browserResolved = sanitizeMediaUrlCandidate(rawBrowserResolved);
      if (browserResolved && !isImageLikeUrl(browserResolved)) {
        const resolvedTarget = resolveRequestPolicy(
          browserResolved,
          extraHeaders,
          context.requestHeaders,
          context.hostMappings,
        );
        const validationTimeoutMs = getValidationProbeTimeoutMs(
          getRemainingParseBudgetMs(deadlineAt),
        );
        const validated = await validateResolvedStreamCandidate({
          url: resolvedTarget.url,
          headers: resolvedTarget.headers,
          resolvedBy: 'jiexi-webview',
        }, {
          timeoutMs: validationTimeoutMs,
        });
        if (diagnostics) {
          appendPlaybackDiagnostic(
            diagnostics,
            'webview_parse',
            validated.stream ? 'success' : 'miss',
            `target=${targetUrl} reason=${validated.reason ?? 'resolved'}`,
            { budgetMs: browserTimeoutMs },
          );
        }
        return validated.stream;
      }
    } catch (e) {
      if (diagnostics) {
        appendPlaybackDiagnostic(
          diagnostics,
          'webview_parse',
          'error',
          `target=${targetUrl} reason=${e instanceof Error ? e.message : String(e)}`,
          { budgetMs: getRemainingParseBudgetMs(deadlineAt) },
        );
      }
      // Ignored
    }
  }

  return null;
}

async function resolveEpisodePlaybackUncached(
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
    const payloadUrl = sanitizeMediaUrlCandidate(payload.url);
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

    if (payloadLooksDirectPlayable && !parseRequired) {
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

    if (hasDirectPayloadUrl) {
      appendPlaybackDiagnostic(
        diagnostics,
        'wrapped_url',
        'skip',
        `target=${payloadUrl} reason=payload_not_parse_required`,
      );

      const wrappedPlayableUrl = await resolveWrappedPayloadUrl(
        payloadUrl,
        payloadHeaders,
        QUICK_PARSE_HTTP_TIMEOUT_MS,
      );
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
              {
                timeBudgetMs: WRAPPED_PARSE_CHAIN_BUDGET_MS,
                diagnostics,
              },
            ),
            WRAPPED_PARSE_CHAIN_BUDGET_MS,
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
        const sameParseTarget =
          Number(payload.parse ?? 0) === 1 && wrappedPlayableUrl === payloadUrl;
        if (sameParseTarget && !looksLikeDirectPlayableUrl(resolvedWrapped.url)) {
          appendPlaybackDiagnostic(
            diagnostics,
            'wrapped_url',
            'miss',
            `target=${wrappedPlayableUrl} reason=parse_target_still_not_direct`,
          );
        } else {
          const validatedWrapped = await validateResolvedStreamCandidate({
            url: resolvedWrapped.url,
            headers: resolvedWrapped.headers,
            resolvedBy: 'spider',
          }, {
            timeoutMs: QUICK_PARSE_VALIDATION_TIMEOUT_MS,
          });
          if (!validatedWrapped.stream) {
            appendPlaybackDiagnostic(
              diagnostics,
              'wrapped_url',
              'miss',
              `target=${wrappedPlayableUrl} reason=${validatedWrapped.reason ?? 'stream_probe_unknown'}`,
            );
          } else {
            return finalizeResolvedStream(
              validatedWrapped.stream,
              diagnostics,
            );
          }
        }
      }

      appendPlaybackDiagnostic(
        diagnostics,
        'wrapped_url',
        'miss',
        `target=${payloadUrl} reason=not_resolved`,
      );

      if (Number(payload.parse ?? 0) === 1 || !payloadLooksDirectPlayable) {
        const parsedWrappedPayload = await resolveUrlWithParseAndWebviewFallback(
          context,
          routeName,
          payloadUrl,
          payloadHeaders,
          {
            timeBudgetMs: WRAPPED_PARSE_CHAIN_BUDGET_MS,
            diagnostics,
          },
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
      const validatedPayload = await validateResolvedStreamCandidate({
        url: resolvedPayload.url,
        headers: resolvedPayload.headers,
        resolvedBy: 'spider',
      }, {
        timeoutMs: QUICK_PARSE_VALIDATION_TIMEOUT_MS,
      });
      if (Number(payload.parse ?? 0) === 1 && !looksLikeDirectPlayableUrl(resolvedPayload.url)) {
        appendPlaybackDiagnostic(
          diagnostics,
          'direct_fallback',
          'error',
          `source=payload target=${payloadUrl} reason=parse_target_still_not_direct`,
        );
        throw buildVodPlaybackError(
          '当前线路仍然停留在解析页，没有拿到真正的视频地址。',
          diagnostics,
        );
      }
      if (!validatedPayload.stream) {
        appendPlaybackDiagnostic(
          diagnostics,
          'direct_fallback',
          'error',
          `source=payload target=${payloadUrl} reason=${validatedPayload.reason ?? 'stream_probe_unknown'}`,
        );
        throw buildVodPlaybackError(
          '当前直链经过检测不是真正的视频流，已跳过错误线路。',
          diagnostics,
        );
      }
      return finalizeResolvedStream(
        validatedPayload.stream,
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
        { diagnostics },
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
    { diagnostics },
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

export async function resolveEpisodePlayback(
  context: VodPlaybackContext,
  episode: VodEpisode,
  routeName: string,
): Promise<VodResolvedStream> {
  const cacheKey = buildPlaybackResolutionCacheKey(context, episode, routeName);
  return resolveWithStoredVodPlaybackResolution(
    {
      sourceKey: context.sourceKey,
      repoUrl: context.repoUrl,
    },
    cacheKey,
    () => resolveEpisodePlaybackUncached(context, episode, routeName),
  ) as Promise<VodResolvedStream>;
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
