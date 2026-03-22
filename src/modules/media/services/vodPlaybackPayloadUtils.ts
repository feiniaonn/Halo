export interface PlayerPayloadLike {
  url?: string;
  parse?: number;
  jx?: number;
  header?: unknown;
  headers?: unknown;
  [key: string]: unknown;
}

const PLAYABLE_URL_MATCHER = /https?:\/\/[^\s"'<>]+/gi;
const NESTED_MEDIA_PARAM_KEYS = ["url", "v", "vid", "play", "target", "source"];
const ENCODED_URL_TAIL_MARKERS = [
  "%22%20",
  "%22%3e",
  "%22>",
  "%27%20",
  "%3ciframe",
  "%3cscript",
  "%3c/html",
  "%3c/body",
  "%20width=",
  "%20height=",
  "%20frameborder=",
  "%20allowfullscreen",
  "%20sandbox=",
  "%20scrolling=",
  "%24%28%27",
  "%24%28%22",
  "%3bfunction%20",
];

function normalizePlayableText(value: string): string {
  return value
    .trim()
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&");
}

function trimPlayableUrlPunctuation(value: string): string {
  return value.trim().replace(/[\\'",;)\]]+$/g, "");
}

function extractFirstHttpUrl(text: string): string {
  const matches = text.match(PLAYABLE_URL_MATCHER) ?? [];
  for (const match of matches) {
    const candidate = trimPlayableUrlPunctuation(match);
    if (/^https?:\/\//i.test(candidate)) {
      return candidate;
    }
  }
  return "";
}

function decodePlayableCandidate(value: string): string {
  let current = normalizePlayableText(value);
  if (!/^https?:\/\//i.test(current)) {
    if (/^(?:url|v)=/i.test(current)) {
      current = current.replace(/^(?:url|v)=/i, "");
    }
    if (/^aHR0c/i.test(current)) {
      try {
        current = atob(current);
      } catch {
        // Ignore invalid base64 payloads.
      }
    }
    if (
      /^[0-9a-f]+$/i.test(current)
      && current.length >= 14
      && current.length % 2 === 0
    ) {
      try {
        const bytes = current.match(/.{2}/g)?.map((chunk) => Number.parseInt(chunk, 16)) ?? [];
        current = new TextDecoder().decode(new Uint8Array(bytes));
      } catch {
        // Ignore invalid hex payloads.
      }
    }
    if (/%[0-9a-f]{2}/i.test(current)) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const decoded = decodeURIComponent(current);
          if (decoded === current) {
            break;
          }
          current = decoded;
        } catch {
          break;
        }
      }
    }
  }
  return normalizePlayableText(current);
}

function stripEncodedUrlTail(value: string): string {
  const lower = value.toLowerCase();
  let cutIndex = -1;
  for (const marker of ENCODED_URL_TAIL_MARKERS) {
    const index = lower.indexOf(marker);
    if (index >= 0 && (cutIndex < 0 || index < cutIndex)) {
      cutIndex = index;
    }
  }
  return cutIndex >= 0 ? value.slice(0, cutIndex) : value;
}

export function sanitizeMediaUrlCandidate(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = normalizePlayableText(value);
  if (!normalized) {
    return "";
  }

  const decoded = decodePlayableCandidate(normalized);
  const directMatch = extractFirstHttpUrl(decoded) || extractFirstHttpUrl(normalized);
  const httpCandidate = directMatch
    || (/^https?:\/\//i.test(decoded) ? decoded : /^https?:\/\//i.test(normalized) ? normalized : "");
  if (!httpCandidate) {
    return "";
  }

  return trimPlayableUrlPunctuation(stripEncodedUrlTail(httpCandidate));
}

export function unwrapPlayerPayload(resp: string | unknown): PlayerPayloadLike {
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
    return data as PlayerPayloadLike;
  } catch {
    return {};
  }
}

export function hasResolvablePlayerPayload(payload: PlayerPayloadLike): boolean {
  const url = sanitizeMediaUrlCandidate(payload.url);
  if (url) {
    return true;
  }
  return Number(payload.parse ?? 0) === 1 || Number(payload.jx ?? 0) === 1;
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

export function mergeHeaderRecords(
  ...records: Array<Record<string, string> | null | undefined>
): Record<string, string> | null {
  const merged = records.reduce<Record<string, string>>((current, record) => {
    if (!record) return current;
    Object.assign(current, record);
    return current;
  }, {});
  return Object.keys(merged).length > 0 ? merged : null;
}

export function extractPlayerHeaders(payload: PlayerPayloadLike): Record<string, string> | null {
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

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(sanitizeMediaUrlCandidate(value) || value.trim());
}

export function isImageLikeUrl(url: string): boolean {
  const normalized = sanitizeMediaUrlCandidate(url) || url.trim();
  return /\.(png|jpe?g|gif|webp|bmp|ico)(\?.*)?$/i.test(normalized);
}

export function looksLikeWrappedMediaUrl(url: string): boolean {
  const normalized = sanitizeMediaUrlCandidate(url) || url.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.toLowerCase();
    const hasNestedTarget = NESTED_MEDIA_PARAM_KEYS
      .some((key) => Boolean(parsed.searchParams.get(key)?.trim()));
    return hasNestedTarget && /(getm3u8|parse|parser|player|jx|analysis|playm3u8)/i.test(pathname);
  } catch {
    return /(getm3u8|parse|parser|player|jx|analysis|playm3u8).*?[?&](?:url|v|vid|play|target|source)=/i
      .test(normalized);
  }
}

export function extractWrappedMediaTargetUrl(url: string): string {
  const normalized = sanitizeMediaUrlCandidate(url) || url.trim();
  if (!looksLikeWrappedMediaUrl(normalized)) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    for (const key of NESTED_MEDIA_PARAM_KEYS) {
      const rawValue = parsed.searchParams.get(key)?.trim() ?? "";
      if (!rawValue) {
        continue;
      }
      const candidate = sanitizeMediaUrlCandidate(rawValue);
      if (!candidate || candidate === normalized) {
        continue;
      }
      if (looksLikeDirectPlayableUrl(candidate)) {
        return candidate;
      }
    }
  } catch {
    for (const key of NESTED_MEDIA_PARAM_KEYS) {
      const match = normalized.match(new RegExp(`[?&]${key}=([^#]+)`, "i"));
      const candidate = sanitizeMediaUrlCandidate(match?.[1] ?? "");
      if (!candidate || candidate === normalized) {
        continue;
      }
      if (looksLikeDirectPlayableUrl(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

export function looksLikeDirectPlayableUrl(url: string): boolean {
  const normalized = (sanitizeMediaUrlCandidate(url) || url.trim()).toLowerCase();
  if (!normalized.startsWith('http')) return false;
  if (isImageLikeUrl(normalized)) return false;
  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.toLowerCase();
    const nestedMediaParam = NESTED_MEDIA_PARAM_KEYS
      .map((key) => parsed.searchParams.get(key)?.trim() ?? '')
      .find((value) => /\.(m3u8|mp4|flv|mpd|m4s|ts|webm|mkv|mov)(?:$|[?#&])/i.test(value));
    if (
      nestedMediaParam
      && /(getm3u8|parse|parser|player|jx|analysis|playm3u8)/i.test(pathname)
    ) {
      return false;
    }
    if (/(\.m3u8|\.mp4|\.flv|\.mpd|\.m4s|\.ts|\.webm|\.mkv|\.mov)$/.test(pathname)) {
      return true;
    }
    if (/(^|\/)[^/?#]*\.(m3u8|mp4|flv|mpd|m4s|ts|webm|mkv|mov)(?:$|[?#])/.test(pathname)) {
      return true;
    }

    if (/\/m3u8\//i.test(pathname)) {
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

export function buildNoUrlMessage(
  payload: PlayerPayloadLike,
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

export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
