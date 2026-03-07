import type { LiveChannel, LiveGroup, LiveLine } from "@/modules/live/types/live.types";

const DEFAULT_GROUP_NAME = "默认分组";
const LOGO_RE = /\.(png|jpg|jpeg|webp|gif|svg)(\?.*)?$|(?:^|[?&])logo=/i;

type HeaderMap = Record<string, string>;
type ParsedLineToken = { line?: LiveLine; logo?: string };
type PendingM3uChannel = {
    groupName: string;
    channelName: string;
    logo?: string;
    tvgId?: string;
    headers?: HeaderMap;
};

function isHttpLike(url: string): boolean {
    const lower = url.trim().toLowerCase();
    return lower.includes("://") || lower.startsWith("p2p:") || lower.startsWith("rtmp:") || lower.startsWith("rtsp:");
}

function decodeValue(value: string): string {
    const trimmed = value.trim().replace(/^"(.*)"$/s, "$1");
    if (!trimmed) return "";
    try {
        return decodeURIComponent(trimmed);
    } catch {
        return trimmed;
    }
}

function normalizeHeaderKey(input: string): string {
    const key = input.trim().replace(/^"(.*)"$/s, "$1");
    const lower = key.toLowerCase();
    if (lower === "ua" || lower === "user-agent" || lower === "http-user-agent") return "User-Agent";
    if (lower === "referer" || lower === "referrer" || lower === "http-referrer") return "Referer";
    if (lower === "origin" || lower === "http-origin") return "Origin";
    return key;
}

function splitHeaderParts(raw: string): string[] {
    return raw
        .split("|")
        .flatMap((part) => part.split("&"))
        .map((part) => part.trim())
        .filter(Boolean);
}

function parseHeaderPairs(raw: string): HeaderMap {
    const text = raw.trim();
    if (!text) return {};

    if (text.startsWith("{") && text.endsWith("}")) {
        try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            const out: HeaderMap = {};
            Object.entries(parsed).forEach(([key, value]) => {
                if (value == null) return;
                out[normalizeHeaderKey(key)] = String(value);
            });
            return out;
        } catch {
            // fall through to key/value parsing
        }
    }

    const out: HeaderMap = {};
    splitHeaderParts(text).forEach((part) => {
        const separator = part.includes("=") ? "=" : part.includes(":") ? ":" : "";
        if (!separator) return;
        const [rawKey, ...rest] = part.split(separator);
        const key = normalizeHeaderKey(rawKey);
        const value = decodeValue(rest.join(separator));
        if (!key || !value) return;
        out[key] = value;
    });
    return out;
}

function mergeHeaders(base?: HeaderMap, extra?: HeaderMap): HeaderMap | undefined {
    const merged = { ...(base ?? {}), ...(extra ?? {}) };
    return Object.keys(merged).length > 0 ? merged : undefined;
}

function lineIdentity(line: LiveLine): string {
    const headerEntries = Object.entries(line.headers ?? {}).sort(([a], [b]) => a.localeCompare(b));
    return `${line.url}::${JSON.stringify(headerEntries)}`;
}

function extractAttr(line: string, attrName: string): string {
    const pattern = new RegExp(`${attrName}="(.+?)"`, "i");
    const match = line.match(pattern);
    return match?.[1]?.trim() ?? "";
}

function parseDirectiveHeaders(line: string, currentHeaders: HeaderMap): HeaderMap | null {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    let patch: HeaderMap = {};

    if (lower.startsWith("ua=") || lower.startsWith("user-agent=")) {
        const value = decodeValue(trimmed.split("=", 2)[1] ?? "");
        if (value) patch["User-Agent"] = value;
    } else if (lower.startsWith("referer=") || lower.startsWith("referrer=")) {
        const value = decodeValue(trimmed.split("=", 2)[1] ?? "");
        if (value) patch.Referer = value;
    } else if (lower.startsWith("origin=")) {
        const value = decodeValue(trimmed.split("=", 2)[1] ?? "");
        if (value) patch.Origin = value;
    } else if (lower.startsWith("header=")) {
        patch = { ...patch, ...parseHeaderPairs(trimmed.slice("header=".length)) };
    } else if (lower.startsWith("#exthttp:")) {
        patch = { ...patch, ...parseHeaderPairs(trimmed.slice("#EXTHTTP:".length)) };
    } else if (lower.startsWith("#extvlcopt:http-user-agent=")) {
        const value = decodeValue(trimmed.slice("#EXTVLCOPT:http-user-agent=".length));
        if (value) patch["User-Agent"] = value;
    } else if (lower.startsWith("#extvlcopt:http-referrer=") || lower.startsWith("#extvlcopt:http-referer=")) {
        const value = decodeValue(trimmed.split("=", 2)[1] ?? "");
        if (value) patch.Referer = value;
    } else if (lower.startsWith("#extvlcopt:http-origin=")) {
        const value = decodeValue(trimmed.slice("#EXTVLCOPT:http-origin=".length));
        if (value) patch.Origin = value;
    } else if (lower.startsWith("#kodiprop:inputstream.adaptive.stream_headers=") || lower.startsWith("#kodiprop:inputstream.adaptive.common_headers=")) {
        patch = { ...patch, ...parseHeaderPairs(trimmed.split("=", 2)[1] ?? "") };
    }

    if (Object.keys(patch).length === 0) return null;
    return { ...currentHeaders, ...patch };
}

function parseLineToken(token: string, inheritedHeaders: HeaderMap): ParsedLineToken | null {
    const raw = token.trim();
    if (!raw) return null;

    if (LOGO_RE.test(raw)) {
        return { logo: raw };
    }

    const parts = raw.split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    let urlCandidate = parts[0];
    if (urlCandidate.includes("$")) {
        const [left, right] = urlCandidate.split("$", 2).map((v) => v.trim());
        if (isHttpLike(right)) {
            urlCandidate = right;
        } else if (isHttpLike(left)) {
            urlCandidate = left;
        }
    }
    if (!isHttpLike(urlCandidate)) return null;

    const inlineHeaders = parts
        .slice(1)
        .reduce<HeaderMap>((acc, piece) => {
            const normalizedPiece = piece.toLowerCase().startsWith("headers=") ? piece.slice("headers=".length) : piece;
            return { ...acc, ...parseHeaderPairs(normalizedPiece) };
        }, {});

    return {
        line: {
            url: urlCandidate,
            headers: mergeHeaders(inheritedHeaders, inlineHeaders),
        },
    };
}

function getOrCreateGroup(groups: LiveGroup[], groupName: string): LiveGroup {
    let group = groups.find((g) => g.groupName === groupName);
    if (!group) {
        group = { groupName, channels: [] };
        groups.push(group);
    }
    return group;
}

function getOrCreateChannel(group: LiveGroup, channelName: string): LiveChannel {
    let channel = group.channels.find((c) => c.name === channelName);
    if (!channel) {
        channel = { name: channelName, urls: [], lines: [] };
        group.channels.push(channel);
    } else if (!channel.lines) {
        channel.lines = channel.urls.map((url) => ({ url }));
    }
    return channel;
}

function appendChannelLine(channel: LiveChannel, line: LiveLine): void {
    if (!channel.lines) channel.lines = [];
    const identity = lineIdentity(line);
    const exists = channel.lines.some((item) => lineIdentity(item) === identity);
    if (exists) return;
    channel.lines.push(line);
    channel.urls.push(line.url);
}

function parseM3u(lines: string[]): LiveGroup[] {
    const groups: LiveGroup[] = [];
    let currentHeaders: HeaderMap = {};
    let pending: PendingM3uChannel | null = null;

    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) return;

        const nextHeaders = parseDirectiveHeaders(line, currentHeaders);
        if (nextHeaders) {
            currentHeaders = nextHeaders;
            return;
        }

        if (line.startsWith("#EXTINF:")) {
            const groupName = extractAttr(line, "group-title") || DEFAULT_GROUP_NAME;
            const channelName = line.split(",").pop()?.trim() ?? "";
            if (!channelName) {
                pending = null;
                return;
            }
            const extinfUa = extractAttr(line, "http-user-agent");
            const extinfHeaders = extinfUa ? { "User-Agent": extinfUa } : undefined;

            pending = {
                groupName,
                channelName,
                logo: extractAttr(line, "tvg-logo") || undefined,
                tvgId: extractAttr(line, "tvg-id") || undefined,
                headers: mergeHeaders(currentHeaders, extinfHeaders),
            };
            return;
        }

        if (line.startsWith("#")) return;
        if (!pending) return;

        const parsed = parseLineToken(line, pending.headers ?? {});
        if (!parsed?.line) return;

        const group = getOrCreateGroup(groups, pending.groupName);
        const channel = getOrCreateChannel(group, pending.channelName);
        appendChannelLine(channel, parsed.line);
        if (pending.logo && !channel.logo) channel.logo = pending.logo;
        if (pending.tvgId && !channel.tvgId) channel.tvgId = pending.tvgId;
        pending = null;
    });

    return groups.filter((g) => g.channels.length > 0);
}

function parseTvBoxTxt(lines: string[]): LiveGroup[] {
    const groups: LiveGroup[] = [];
    let currentGroupName = DEFAULT_GROUP_NAME;
    let currentHeaders: HeaderMap = {};

    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line) return;

        const nextHeaders = parseDirectiveHeaders(line, currentHeaders);
        if (nextHeaders) {
            currentHeaders = nextHeaders;
            return;
        }

        if (line.endsWith(",#genre#")) {
            const name = line.slice(0, -",#genre#".length).trim();
            currentGroupName = name || DEFAULT_GROUP_NAME;
            getOrCreateGroup(groups, currentGroupName);
            currentHeaders = {};
            return;
        }

        const commaIndex = line.indexOf(",");
        if (commaIndex < 0) return;

        const channelName = line.slice(0, commaIndex).trim();
        const urlsPart = line.slice(commaIndex + 1).trim();
        if (!channelName || !urlsPart) return;

        const group = getOrCreateGroup(groups, currentGroupName);
        const channel = getOrCreateChannel(group, channelName);
        let pendingLogo = channel.logo;

        urlsPart
            .split("#")
            .map((token) => token.trim())
            .filter(Boolean)
            .forEach((token) => {
                const parsed = parseLineToken(token, currentHeaders);
                if (!parsed) return;
                if (parsed.logo) {
                    pendingLogo = pendingLogo ?? parsed.logo;
                    return;
                }
                if (parsed.line) appendChannelLine(channel, parsed.line);
            });

        if (pendingLogo && !channel.logo) {
            channel.logo = pendingLogo;
        }
    });

    return groups.filter((g) => g.channels.length > 0);
}

/**
 * Parses TVBox Live TXT and M3U playlists.
 * Also supports per-line request headers like `|User-Agent=...&Referer=...`.
 */
export function parseLiveTxt(txt: string): LiveGroup[] {
    const lines = txt.split(/\r?\n/);
    const isM3u = lines.some((line) => /^#EXTM3U/i.test(line.trim()));
    return isM3u ? parseM3u(lines) : parseTvBoxTxt(lines);
}
