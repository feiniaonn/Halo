import type { TvBoxParse } from "@/modules/media/types/vodWindow.types";
import type {
  NormalizedTvBoxConfig,
  NormalizedTvBoxSite,
  RawTvBoxConfig,
  RawTvBoxParse,
  RawTvBoxSite,
  TvBoxClass,
  TvBoxRepoUrl,
  VodDetailItem,
  VodDetailResponse,
  VodResponse,
} from "@/modules/media/types/tvbox.types";
import type {
  TvBoxDoH,
  TvBoxHostMapping,
  TvBoxPlaybackRule,
  TvBoxRequestHeaderRule,
} from "@/modules/media/types/vodWindow.types";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBooleanFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const next = value.trim().toLowerCase();
    if (!next) return fallback;
    if (next === "0" || next === "false" || next === "off" || next === "no") return false;
    if (next === "1" || next === "true" || next === "on" || next === "yes") return true;
  }
  return fallback;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeSiteExt(ext: unknown): {
  extKind: NormalizedTvBoxSite["extKind"];
  extValue: string;
} {
  if (typeof ext === "string") {
    const value = ext.trim();
    if (!value) {
      return { extKind: "empty", extValue: "" };
    }
    if (/^https?:\/\/[^\s]+$/i.test(value)) {
      return { extKind: "url", extValue: value };
    }
    return { extKind: "text", extValue: value };
  }
  if (Array.isArray(ext)) {
    return { extKind: "array", extValue: JSON.stringify(ext) };
  }
  if (ext && typeof ext === "object") {
    return { extKind: "object", extValue: JSON.stringify(ext) };
  }
  return { extKind: "empty", extValue: "" };
}

function normalizeParseExt(ext: unknown): TvBoxParse["ext"] | undefined {
  let current = ext;
  if (typeof current === "string") {
    const trimmed = current.trim();
    if (!trimmed) return undefined;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  if (!current || typeof current !== "object" || Array.isArray(current)) {
    return undefined;
  }

  const source = current as { header?: unknown; flag?: unknown };
  const header = source.header && typeof source.header === "object" && !Array.isArray(source.header)
    ? Object.fromEntries(
      Object.entries(source.header as Record<string, unknown>)
        .map(([key, value]) => [key, normalizeText(value)])
        .filter(([, value]) => !!value),
    )
    : undefined;
  const flag = Array.isArray(source.flag)
    ? source.flag.map((item) => normalizeText(item)).filter(Boolean)
    : undefined;

  if (!header && !flag?.length) return undefined;
  return {
    ...(header ? { header } : {}),
    ...(flag?.length ? { flag } : {}),
  };
}

function normalizeParse(parse: RawTvBoxParse): TvBoxParse | null {
  const name = normalizeText(parse.name);
  const url = normalizeText(parse.url);
  if (!name || !url) return null;

  return {
    name,
    type: normalizeNumber(parse.type, 0),
    url,
    ext: normalizeParseExt(parse.ext),
  };
}

function normalizeParses(value: unknown): TvBoxParse[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeParse((item ?? {}) as RawTvBoxParse))
    .filter((item): item is TvBoxParse => !!item);
}

function normalizeRootHeaders(value: unknown): TvBoxRequestHeaderRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const source = item as { host?: unknown; header?: unknown };
      const host = normalizeText(source.host);
      if (!host || !source.header || typeof source.header !== "object" || Array.isArray(source.header)) {
        return null;
      }

      const header = Object.fromEntries(
        Object.entries(source.header as Record<string, unknown>)
          .map(([key, current]) => [key, normalizeText(current)])
          .filter(([, current]) => !!current),
      );

      if (Object.keys(header).length === 0) return null;
      return { host, header };
    })
    .filter((item): item is TvBoxRequestHeaderRule => !!item);
}

function normalizePlaybackRules(value: unknown): TvBoxPlaybackRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const source = item as {
        name?: unknown;
        hosts?: unknown;
        regex?: unknown;
        script?: unknown;
      };
      const name = normalizeText(source.name) || "未命名规则";
      const hosts = normalizeStringArray(source.hosts);
      const regex = normalizeStringArray(source.regex);
      const script = normalizeStringArray(source.script);
      if (hosts.length === 0 && regex.length === 0 && script.length === 0) {
        return null;
      }
      return { name, hosts, regex, script };
    })
    .filter((item): item is TvBoxPlaybackRule => !!item);
}

function normalizeDoH(value: unknown): TvBoxDoH[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const source = item as { name?: unknown; url?: unknown; ips?: unknown };
      const name = normalizeText(source.name);
      const url = normalizeText(source.url);
      const ips = normalizeStringArray(source.ips);
      if (!name || !url) return null;
      return { name, url, ips };
    })
    .filter((item): item is TvBoxDoH => !!item);
}

function normalizeHosts(value: unknown): TvBoxHostMapping[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const text = normalizeText(item);
      if (!text) return null;
      const splitAt = text.indexOf("=");
      if (splitAt <= 0) return null;
      const host = text.slice(0, splitAt).trim();
      const target = text.slice(splitAt + 1).trim();
      if (!host || !target) return null;
      return { host, target };
    })
    .filter((item): item is TvBoxHostMapping => !!item);
}

function isSearchNameHint(name: string): boolean {
  return /(search|搜索|搜片|搜剧|检索|聚搜)/i.test(name);
}

function inferSiteCapability(site: {
  type: number;
  api: string;
  jar: string;
  searchable: boolean;
  quickSearch: boolean;
  filterable: boolean;
  playUrl: string;
  categories: string[];
  extKind: NormalizedTvBoxSite["extKind"];
  name: string;
}): NormalizedTvBoxSite["capability"] {
  const requiresSpider = site.type === 3 || site.type === 4 || !!site.jar || /^csp_/i.test(site.api);
  const sourceKind = requiresSpider ? "spider" : "cms";
  const canSearch = site.searchable || site.quickSearch;
  const hasPresetCategories = site.categories.length > 0;
  const canCategory = hasPresetCategories || site.filterable || sourceKind === "cms" || requiresSpider;
  const searchOnly = canSearch && !canCategory && isSearchNameHint(site.name);
  const canHome = !searchOnly && (sourceKind === "cms" || requiresSpider || hasPresetCategories);
  const displayOnly = canHome && !canSearch;

  return {
    sourceKind,
    canHome,
    canCategory: !searchOnly && canCategory,
    canSearch,
    searchOnly,
    displayOnly,
    requiresSpider,
    supportsDetail: sourceKind === "cms" || requiresSpider,
    supportsPlay: sourceKind === "cms" || requiresSpider,
    mayNeedParse: sourceKind === "cms" || !!site.playUrl,
    supportsBrowserParse: sourceKind === "cms" || !!site.playUrl,
    hasRemoteExt: site.extKind === "url",
    hasPlayUrl: !!site.playUrl,
    hasPresetCategories,
  };
}

function normalizeSite(site: RawTvBoxSite): NormalizedTvBoxSite | null {
  const key = normalizeText(site.key);
  const api = normalizeText(site.api);
  if (!key || !api) return null;

  const name = normalizeText(site.name) || key;
  const type = normalizeNumber(site.type, 0);
  const jar = normalizeText(site.jar);
  const categories = normalizeCategories(site.categories);
  const searchable = normalizeBooleanFlag(site.searchable, true);
  const quickSearch = normalizeBooleanFlag(site.quickSearch, searchable);
  const filterable = normalizeBooleanFlag(site.filterable, false);
  const playUrl = normalizeText(site.playUrl);
  const click = normalizeText(site.click);
  const playerType = normalizeText(site.playerType);
  const { extKind, extValue } = normalizeSiteExt(site.ext);

  const capability = inferSiteCapability({
    type,
    api,
    jar,
    searchable,
    quickSearch,
    filterable,
    playUrl,
    categories,
    extKind,
    name,
  });

  return {
    key,
    name,
    type,
    api,
    jar,
    ext: site.ext,
    extKind,
    extValue,
    searchable,
    quickSearch,
    filterable,
    playUrl,
    click,
    playerType,
    categories,
    capability,
  };
}

export function parseSingleSource(raw: string): { source: string; warning: string | null } {
  const lines = raw.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { source: "", warning: null };
  const warning = lines.length > 1 ? "当前仅支持单个地址，已保留第一条。" : null;
  return { source: lines[0], warning };
}

export function parseTvboxJsonLoose(raw: string): unknown {
  let text = raw.replace(/^\uFEFF/, "");
  while (true) {
    const trimmedStart = text.trimStart();
    if (!trimmedStart) {
      text = "";
      break;
    }
    if (trimmedStart.startsWith("//") || trimmedStart.startsWith("#") || trimmedStart.startsWith(";")) {
      const nextLine = trimmedStart.indexOf("\n");
      if (nextLine < 0) {
        text = "";
        break;
      }
      text = trimmedStart.slice(nextLine + 1);
      continue;
    }
    text = trimmedStart;
    break;
  }

  text = text.trim();
  if (!text) throw new Error("empty response");

  try {
    return JSON.parse(text);
  } catch {
    const firstObj = text.indexOf("{");
    const firstArr = text.indexOf("[");
    const start = firstObj < 0 ? firstArr : firstArr < 0 ? firstObj : Math.min(firstObj, firstArr);
    if (start < 0) {
      throw new Error("JSON parse failed");
    }
    const endObj = text.lastIndexOf("}");
    const endArr = text.lastIndexOf("]");
    const end = Math.max(endObj, endArr);
    if (end <= start) {
      throw new Error("JSON parse failed");
    }
    return JSON.parse(text.slice(start, end + 1).trim());
  }
}

export function normalizeRepoUrls(input: unknown): TvBoxRepoUrl[] {
  if (!input || typeof input !== "object" || !("urls" in input) || !Array.isArray((input as RawTvBoxConfig).urls)) {
    return [];
  }
  return ((input as RawTvBoxConfig).urls ?? [])
    .map((repo) => ({
      url: normalizeText(repo.url),
      name: normalizeText(repo.name) || normalizeText(repo.url),
    }))
    .filter((repo) => !!repo.url);
}

export function normalizeTvBoxConfig(input: unknown): NormalizedTvBoxConfig | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as RawTvBoxConfig;
  if (!Array.isArray(raw.sites)) return null;

  const sites = raw.sites
    .map((site) => normalizeSite(site))
    .filter((site): site is NormalizedTvBoxSite => !!site);

  if (!sites.length) return null;

  return {
    spider: normalizeText(raw.spider),
    sites,
    urls: normalizeRepoUrls(raw),
    parses: normalizeParses(raw.parses),
    headers: normalizeRootHeaders(raw.headers),
    rules: normalizePlaybackRules(raw.rules),
    doh: normalizeDoH(raw.doh),
    proxy: normalizeStringArray(raw.proxy),
    hosts: normalizeHosts(raw.hosts),
    ads: normalizeStringArray(raw.ads),
    logo: normalizeText(raw.logo),
    wallpaper: normalizeText(raw.wallpaper),
  };
}

export function isValidSourceUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function truncateMiddle(value: string, left = 26, right = 16): string {
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}

export function serializeSiteExt(ext: unknown): string {
  return normalizeSiteExt(ext).extValue;
}

export function buildPresetClasses(site: NormalizedTvBoxSite): TvBoxClass[] {
  return site.categories.map((category) => ({
    type_id: category,
    type_name: category,
  }));
}

export function parseVodResponse(resp: string): VodResponse {
  let data: unknown;
  try {
    data = JSON.parse(resp);
  } catch {
    return {};
  }

  const unwrap = (input: unknown): Record<string, unknown> => {
    let current = input;
    if (current && typeof current === "object" && "result" in current && ("ok" in current || "className" in current)) {
      current = (current as { result: unknown }).result;
    }
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return {};
      try {
        current = JSON.parse(trimmed);
      } catch {
        return {};
      }
    }
    if (Array.isArray(current)) {
      current = current[0] ?? {};
    }
    return current && typeof current === "object" ? current as Record<string, unknown> : {};
  };

  return unwrap(data) as VodResponse;
}

export function parseVodDetailResponse(resp: string): VodDetailResponse {
  let data: unknown;
  try {
    data = JSON.parse(resp);
  } catch {
    return {};
  }

  const unwrap = (input: unknown): Record<string, unknown> | null => {
    let current: unknown = input;
    if (current && typeof current === "object" && "result" in current && ("ok" in current || "className" in current)) {
      current = (current as { result: unknown }).result;
    }
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!trimmed) return null;
      try {
        current = JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    if (Array.isArray(current)) {
      current = current[0] ?? {};
    }
    return current && typeof current === "object" ? current as Record<string, unknown> : null;
  };

  const root = unwrap(data);
  if (!root) return {};
  return {
    list: Array.isArray(root.list) ? root.list as VodDetailItem[] : undefined,
  };
}

export function extractFirstPlayableEpisode(
  playFrom?: string,
  playUrl?: string,
): { flag: string; id: string; title: string } | null {
  if (!playUrl) return null;
  const flags = (playFrom ?? "默认线路").split("$$$");
  const groups = playUrl.split("$$$");

  for (let i = 0; i < groups.length; i += 1) {
    const flag = (flags[i] ?? "默认线路").trim() || "默认线路";
    const episodes = groups[i]?.split("#") ?? [];
    for (const episode of episodes) {
      if (!episode) continue;
      const splitAt = episode.indexOf("$");
      if (splitAt < 0) continue;
      const title = episode.slice(0, splitAt).trim() || "播放";
      const id = episode.slice(splitAt + 1).trim();
      if (!id || id.startsWith("msearch:")) continue;
      return { flag, id, title };
    }
  }

  return null;
}

export function resolveSiteSpiderUrl(
  site: Pick<NormalizedTvBoxSite, "jar"> | null | undefined,
  fallbackSpider: string | undefined,
): string {
  const siteJar = normalizeText(site?.jar);
  if (siteJar) return siteJar;
  return normalizeText(fallbackSpider);
}

export function buildSitePlayUrlParse(site: Pick<NormalizedTvBoxSite, "name" | "playUrl">): TvBoxParse | null {
  if (!site.playUrl) return null;
  return {
    name: `${site.name} 站点解析`,
    type: 0,
    url: site.playUrl,
  };
}

export function buildEffectiveSiteParses(
  site: Pick<NormalizedTvBoxSite, "name" | "playUrl">,
  globalParses: TvBoxParse[] | undefined,
): TvBoxParse[] {
  const siteParse = buildSitePlayUrlParse(site);
  return siteParse ? [siteParse, ...(globalParses ?? [])] : [...(globalParses ?? [])];
}

export function getSiteCapabilityTags(site: NormalizedTvBoxSite): string[] {
  const tags: string[] = [];
  tags.push(site.capability.sourceKind === "spider" ? "Spider" : "CMS");
  if (site.capability.searchOnly) tags.push("仅搜索");
  if (site.capability.displayOnly) tags.push("仅展示");
  if (site.capability.canHome) tags.push("首页");
  if (site.capability.canCategory) tags.push("分类");
  if (site.capability.canSearch) tags.push("搜索");
  if (site.capability.supportsDetail) tags.push("详情");
  if (site.capability.mayNeedParse) tags.push("解析");
  if (site.capability.hasRemoteExt) tags.push("远程EXT");
  if (site.capability.hasPlayUrl) tags.push("PlayUrl");
  if (site.capability.hasPresetCategories) tags.push("预设分类");
  return tags;
}
