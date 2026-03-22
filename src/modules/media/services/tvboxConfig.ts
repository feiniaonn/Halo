import type { TvBoxParse } from "@/modules/media/types/vodWindow.types";
import type {
  NormalizedTvBoxConfig,
  NormalizedTvBoxSite,
  RawTvBoxConfig,
  RawTvBoxParse,
  RawTvBoxSite,
  TvBoxHostnameVerificationMode,
  TvBoxClass,
  TvBoxProxyRule,
  TvBoxRepoUrl,
  TvBoxTlsMode,
  TvBoxVodItem,
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

function normalizeProxyRules(value: unknown): TvBoxProxyRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        const proxyUrl = normalizeText(item);
        return proxyUrl && /^(https?|socks5):\/\//i.test(proxyUrl)
          ? { host: "*", proxyUrl }
          : null;
      }
      if (!item || typeof item !== "object") return null;
      const source = item as { host?: unknown; proxyUrl?: unknown; proxy?: unknown; url?: unknown };
      const host = normalizeText(source.host) || "*";
      const proxyUrl = normalizeText(source.proxyUrl ?? source.proxy ?? source.url);
      if (!proxyUrl) return null;
      return { host, proxyUrl };
    })
    .filter((item): item is TvBoxProxyRule => !!item);
}

function normalizeTlsMode(value: unknown): TvBoxTlsMode {
  return normalizeText(value).toLowerCase() === "allow_invalid" ? "allow_invalid" : "strict";
}

function normalizeHostnameVerificationMode(value: unknown): TvBoxHostnameVerificationMode {
  return normalizeText(value).toLowerCase() === "allow_invalid" ? "allow_invalid" : "strict";
}

function isSearchNameHint(name: string): boolean {
  return /(search|搜索|搜片|搜剧|检索|聚搜)/i.test(name);
}

function isMetadataNameHint(name: string): boolean {
  return /(douban|豆瓣|预告|片单|榜单|热播|热映|热剧|推荐)/i.test(name);
}

function inferDispatchRole(site: {
  api: string;
  name: string;
  canSearch: boolean;
  searchOnly: boolean;
  canHome: boolean;
  canCategory: boolean;
  displayOnly: boolean;
  hasPlayUrl: boolean;
  requiresSpider: boolean;
}): NormalizedTvBoxSite["capability"]["dispatchRole"] {
  if (site.searchOnly) {
    return "search-only-backend";
  }

  const metadataHint = isMetadataNameHint(site.name) || /(?:douban|trailer|preview)/i.test(site.api);
  if (!site.canSearch && (site.displayOnly || metadataHint || (site.requiresSpider && (site.canHome || site.canCategory) && !site.hasPlayUrl))) {
    return "origin-metadata";
  }

  return "resource-backend";
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
  const searchOnlyHint = isSearchNameHint(site.name) || /(?:^|[_./-])(m?search)(?:$|[_./-])/i.test(site.api);
  const searchOnly = canSearch && !hasPresetCategories && !site.filterable && searchOnlyHint;
  const canCategory = !searchOnly && (hasPresetCategories || site.filterable || sourceKind === "cms" || requiresSpider);
  const canHome = !searchOnly && (sourceKind === "cms" || requiresSpider || hasPresetCategories);
  const displayOnly = canHome && !canSearch;
  const dispatchRole = inferDispatchRole({
    api: site.api,
    name: site.name,
    canSearch,
    searchOnly,
    canHome,
    canCategory,
    displayOnly,
    hasPlayUrl: !!site.playUrl,
    requiresSpider,
  });

  return {
    sourceKind,
    dispatchRole,
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
    proxyRules: normalizeProxyRules(raw.proxyRules),
    tlsMode: normalizeTlsMode(raw.tlsMode),
    caBundlePath: normalizeText(raw.caBundlePath),
    hostnameVerification: normalizeHostnameVerificationMode(raw.hostnameVerification),
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pickStringField(
  source: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function pickNestedStringField(
  source: Record<string, unknown>,
  parentKeys: string[],
  childKeys: string[],
): string {
  for (const parentKey of parentKeys) {
    const parent = asRecord(source[parentKey]);
    if (!parent) continue;
    const nested = pickStringField(parent, childKeys);
    if (nested) return nested;
  }
  return "";
}

function pickDeepStringField(
  source: Record<string, unknown>,
  paths: string[][],
): string {
  for (const path of paths) {
    if (path.length === 0) continue;

    let current: Record<string, unknown> | null = source;
    for (let index = 0; index < path.length - 1; index += 1) {
      current = current ? asRecord(current[path[index]]) : null;
      if (!current) break;
    }

    if (!current) continue;
    const value = pickStringField(current, [path[path.length - 1]]);
    if (value) return value;
  }

  return "";
}

function pickNumberField(
  source: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function normalizeScalarText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function looksLikeCompactIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,40}$/.test(value);
}

function normalizeArrayTexts(items: unknown[]): string[] {
  return items
    .map((item) => normalizeScalarText(item))
    .filter(Boolean);
}

function normalizeVodClassArrayValue(item: unknown[]): TvBoxClass | null {
  const values = normalizeArrayTexts(item);
  if (values.length === 0) return null;
  if (values.length === 1) {
    return {
      type_id: values[0],
      type_name: values[0],
    };
  }

  const [first, second] = values;
  if (looksLikeCompactIdentifier(first) && !looksLikeCompactIdentifier(second)) {
    return { type_id: first, type_name: second };
  }
  if (!looksLikeCompactIdentifier(first) && looksLikeCompactIdentifier(second)) {
    return { type_id: second, type_name: first };
  }
  return { type_id: first, type_name: second };
}

function normalizeVodItemArrayValue(item: unknown[]): TvBoxVodItem | null {
  const values = normalizeArrayTexts(item);
  if (values.length < 2) return null;

  const imageCandidate = values.find((value) => /^(https?:)?\/\//i.test(value)) ?? "";
  const nonImageValues = values.filter((value) => value !== imageCandidate);
  const [first = "", second = "", third = ""] = nonImageValues;
  if (!first && !second) return null;

  const id = looksLikeCompactIdentifier(first) && second ? first : second || first;
  const name = looksLikeCompactIdentifier(first) && second ? second : first || second;
  const remarks = third && third !== id && third !== name ? third : "";

  return {
    vod_id: id || name,
    vod_name: name || id,
    vod_pic: imageCandidate,
    vod_remarks: remarks,
  };
}

function normalizeVodDetailArrayValue(item: unknown[]): VodDetailItem | null {
  const values = normalizeArrayTexts(item);
  if (values.length < 2) return null;

  const imageCandidate = values.find((value) => /^(https?:)?\/\//i.test(value)) ?? "";
  const id = values[0] ?? "";
  const name = values[1] ?? id;
  const playUrl = values.find((value) => value.includes("$")) ?? "";

  if (!id && !name && !playUrl) return null;

  return {
    vod_id: id || undefined,
    vod_name: name || undefined,
    vod_pic: imageCandidate || undefined,
    vod_play_url: playUrl || undefined,
  };
}

function normalizeVodClassValue(item: unknown): TvBoxClass | null {
  if (typeof item === "string") {
    const text = item.trim();
    return text ? { type_id: text, type_name: text } : null;
  }
  if (Array.isArray(item)) {
    return normalizeVodClassArrayValue(item);
  }

  const source = asRecord(item);
  if (!source) return null;

  const typeId = pickStringField(source, [
    "type_id",
    "typeId",
    "tid",
    "id",
    "type",
    "tag",
    "cate_id",
    "cateId",
    "category_id",
    "categoryId",
    "name",
    "type_name",
    "typeName",
    "title",
    "a",
    "b",
  ]);
  const typeName = pickStringField(source, [
    "type_name",
    "typeName",
    "name",
    "title",
    "label",
    "text",
    "value",
    "type_id",
    "typeId",
    "tid",
    "b",
    "a",
  ]);

  if (!typeId && !typeName) return null;
  return {
    type_id: typeId || typeName,
    type_name: typeName || typeId,
  };
}

function looksLikeClassOnlyItem(item: unknown): boolean {
  const source = asRecord(item);
  if (!source) return false;

  const typeId = pickStringField(source, ["type_id", "typeId", "tid"]);
  const typeName = pickStringField(source, ["type_name", "typeName", "name", "title"]);
  const vodId = pickStringField(source, ["vod_id", "vodId", "id", "ids"]);
  const vodName = pickStringField(source, ["vod_name", "vodName"]);

  return !!typeId && !!typeName && !vodId && !vodName;
}

function normalizeVodItemValue(item: unknown): TvBoxVodItem | null {
  if (Array.isArray(item)) {
    return normalizeVodItemArrayValue(item);
  }

  const source = asRecord(item);
  if (!source) return null;

  const vodId = pickStringField(source, [
    "vod_id",
    "vodId",
    "id",
    "ids",
    "nextlink",
    "nextLink",
    "url",
    "sid",
    "b",
    "a",
  ]) || pickDeepStringField(source, [
    ["target", "id"],
    ["target", "sid"],
    ["subject", "id"],
    ["subject", "sid"],
    ["item", "id"],
    ["item", "sid"],
    ["data", "id"],
  ]);
  const vodName = pickStringField(source, [
    "vod_name",
    "vodName",
    "name",
    "title",
    "vod_title",
    "vodTitle",
    "c",
    "b",
  ]) || pickDeepStringField(source, [
    ["target", "vod_name"],
    ["target", "title"],
    ["target", "name"],
    ["subject", "vod_name"],
    ["subject", "title"],
    ["subject", "name"],
    ["item", "title"],
    ["item", "name"],
    ["data", "title"],
    ["data", "name"],
  ]);

  if (!vodId && !vodName) return null;

  const vodPic = pickStringField(source, [
    "vod_pic",
    "vodPic",
    "pic",
    "img",
    "image",
    "cover",
    "thumb",
    "poster",
    "vod_pic_thumb",
    "vodPicThumb",
    "pic_url",
    "picUrl",
    "img_url",
    "imgUrl",
    "cover_url",
    "coverUrl",
    "poster_url",
    "posterUrl",
    "thumbnail",
    "d",
  ]) || pickNestedStringField(source, ["image", "cover", "poster"], ["url", "thumb", "src", "image", "poster"])
    || pickDeepStringField(source, [
      ["target", "pic", "normal"],
      ["target", "pic", "large"],
      ["target", "pic", "url"],
      ["target", "cover", "url"],
      ["target", "cover", "src"],
      ["subject", "pic", "normal"],
      ["subject", "pic", "large"],
      ["subject", "pic", "url"],
      ["subject", "cover", "url"],
      ["subject", "cover", "src"],
      ["item", "pic", "normal"],
      ["item", "pic", "large"],
      ["item", "cover", "url"],
    ]);
  const vodRemarks = pickStringField(source, [
    "vod_remarks",
    "vodRemarks",
    "remarks",
    "remark",
    "note",
    "vod_note",
    "vodNote",
    "conerMemo",
    "detailMemo",
    "card_subtitle",
    "subtitle",
    "sub_title",
    "shorthand",
    "e",
  ]) || pickDeepStringField(source, [
    ["target", "card_subtitle"],
    ["target", "subtitle"],
    ["target", "sub_title"],
    ["subject", "card_subtitle"],
    ["subject", "subtitle"],
    ["subject", "sub_title"],
    ["item", "subtitle"],
    ["item", "sub_title"],
  ]);

  return {
    vod_id: vodId || vodName,
    vod_name: vodName || vodId,
    vod_pic: vodPic,
    vod_remarks: vodRemarks,
  };
}

function normalizeClassesFromFilters(filters: unknown): TvBoxClass[] {
  const source = asRecord(filters);
  if (!source) return [];
  return Object.entries(source)
    .map(([key, value]) => {
      const typeId = key.trim();
      if (!typeId) return null;
      const values = Array.isArray(value) ? value : [];
      const firstOption = values.find((item) => !!asRecord(item)) ?? null;
      const optionName = firstOption
        ? pickStringField(asRecord(firstOption)!, ["name", "label", "text", "n", "value", "v"])
        : "";

      return {
        type_id: typeId,
        type_name: optionName || typeId,
      };
    })
    .filter((item): item is TvBoxClass => !!item);
}

function normalizeVodDetailItemValue(item: unknown): VodDetailItem | null {
  if (Array.isArray(item)) {
    return normalizeVodDetailArrayValue(item);
  }

  const source = asRecord(item);
  if (!source) return null;

  const vodId = pickStringField(source, ["vod_id", "vodId", "id", "ids", "sid", "b", "a"]);
  const vodName = pickStringField(source, ["vod_name", "vodName", "name", "title", "vod_title", "vodTitle", "c", "b"]);
  const vodPic = pickStringField(source, [
    "vod_pic",
    "vodPic",
    "pic",
    "img",
    "image",
    "cover",
    "thumb",
    "poster",
    "vod_pic_thumb",
    "vodPicThumb",
    "d",
  ]) || pickNestedStringField(source, ["image", "cover", "poster"], ["url", "thumb", "src", "image", "poster"]);
  const vodContent = pickStringField(source, ["vod_content", "vodContent", "content", "desc", "description", "vod_blurb", "vodBlurb"]);
  const vodPlayFrom = pickStringField(source, ["vod_play_from", "vodPlayFrom", "playFrom"]);
  const vodPlayUrl = pickStringField(source, ["vod_play_url", "vodPlayUrl", "playUrl"]);

  if (!vodId && !vodName && !vodPlayUrl) return null;

  return {
    vod_id: vodId || undefined,
    vod_name: vodName || undefined,
    vod_pic: vodPic || undefined,
    vod_year: pickStringField(source, ["vod_year", "vodYear", "year"]) || undefined,
    vod_area: pickStringField(source, ["vod_area", "vodArea", "area"]) || undefined,
    vod_actor: pickStringField(source, ["vod_actor", "vodActor", "actor"]) || undefined,
    vod_director: pickStringField(source, ["vod_director", "vodDirector", "director"]) || undefined,
    vod_content: vodContent || undefined,
    vod_play_from: vodPlayFrom || undefined,
    vod_play_url: vodPlayUrl || undefined,
  };
}

function unwrapVodPayload(input: unknown): Record<string, unknown> {
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
  if (current && typeof current === "object" && "data" in current) {
    const source = current as { data?: unknown; class?: unknown; list?: unknown; filters?: unknown };
    if ((source.class == null && source.list == null && source.filters == null) && source.data) {
      const nested = unwrapVodPayload(source.data);
      if (Object.keys(nested).length > 0) return nested;
    }
  }
  return current && typeof current === "object" ? current as Record<string, unknown> : {};
}

export function parseVodResponse(resp: string | unknown): VodResponse {
  let data: unknown = resp;
  if (typeof resp === "string") {
    try {
      data = JSON.parse(resp);
    } catch {
      return {};
    }
  }
  const root = unwrapVodPayload(data);
  const classItems = Array.isArray(root.class)
    ? root.class
    : Array.isArray(root.a)
      ? root.a
      : [];
  const filterItems = root.filters ?? root.c;
  const listItems = Array.isArray(root.list)
    ? root.list
    : Array.isArray(root.b)
      ? root.b
      : [];
  const parsedClasses = classItems.length > 0
    ? classItems
      .map((item) => normalizeVodClassValue(item))
      .filter((item): item is TvBoxClass => !!item)
    : [];
  const parsedList = listItems.length > 0
    ? listItems
      .map((item) => normalizeVodItemValue(item))
      .filter((item): item is TvBoxVodItem => !!item)
    : [];
  const classLikeList = parsedClasses.length === 0 && parsedList.length === 0 && listItems.every(looksLikeClassOnlyItem)
    ? listItems
      .map((item) => normalizeVodClassValue(item))
      .filter((item): item is TvBoxClass => !!item)
    : [];
  const fallbackClasses = parsedClasses.length > 0
    ? parsedClasses
    : classLikeList.length > 0
      ? classLikeList
      : normalizeClassesFromFilters(filterItems);

  return {
    class: fallbackClasses,
    list: classLikeList.length > 0 ? [] : parsedList,
    pagecount: pickNumberField(root, ["pagecount", "pageCount", "totalpage", "page_total", "l", "m"]),
    total: pickNumberField(root, ["total", "totalCount", "recordcount", "recordCount", "n", "m"]),
  };
}

export function parseVodDetailResponse(resp: string | unknown): VodDetailResponse {
  let data: unknown = resp;
  if (typeof resp === "string") {
    try {
      data = JSON.parse(resp);
    } catch {
      return {};
    }
  }
  const root = unwrapVodPayload(data);
  if (!root) return {};
  return {
    list: (Array.isArray(root.list) ? root.list : Array.isArray(root.b) ? root.b : [])
      .map((item) => normalizeVodDetailItemValue(item))
      .filter((item): item is VodDetailItem => !!item),
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
