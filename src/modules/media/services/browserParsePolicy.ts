import { matchPlaybackRules } from "@/modules/media/services/tvboxNetworkPolicy";
import type { TvBoxPlaybackRule } from "@/modules/media/types/vodWindow.types";

export type BrowserClickActionKind = "selector" | "text";
export type BrowserClickActionSource = "site-click" | "rule-script";

export interface BrowserClickAction {
  kind: BrowserClickActionKind;
  target: string;
  frameSelector?: string;
  index?: number;
  source: BrowserClickActionSource;
  raw: string;
}

export interface BrowserParsePolicy {
  actions: BrowserClickAction[];
  ignoredEntries: string[];
}

const QUERY_SELECTOR_CLICK_RE =
  /^document\.querySelector\((['"`])(.+?)\1\)\.click\(\)\s*;?$/i;
const FRAME_QUERY_SELECTOR_CLICK_RE =
  /^document\.querySelector\((['"`])(.+?)\1\)\.contentWindow\.document\.querySelector\((['"`])(.+?)\3\)\.click\(\)\s*;?$/i;
const GET_ELEMENT_BY_ID_CLICK_RE =
  /^document\.getElementById\((['"`])(.+?)\1\)\.click\(\)\s*;?$/i;
const GET_ELEMENTS_BY_CLASS_NAME_CLICK_RE =
  /^document\.getElementsByClassName\((['"`])(.+?)\1\)\[(\d+)\]\.click\(\)\s*;?$/i;
const GET_ELEMENTS_BY_TAG_NAME_CLICK_RE =
  /^document\.getElementsByTagName\((['"`])(.+?)\1\)\[(\d+)\]\.click\(\)\s*;?$/i;
const GET_ELEMENTS_BY_NAME_CLICK_RE =
  /^document\.getElementsByName\((['"`])(.+?)\1\)\[(\d+)\]\.click\(\)\s*;?$/i;

function normalizeEntry(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function toClassSelector(value: string): string | null {
  const classes = value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (classes.length === 0) return null;
  return classes.map((item) => `.${item}`).join("");
}

function looksLikeSelector(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/[();={}]/.test(trimmed)) return false;
  return trimmed.startsWith(".")
    || trimmed.startsWith("#")
    || trimmed.startsWith("[")
    || trimmed.startsWith("/")
    || trimmed.includes(">")
    || /^(?:[a-z][a-z0-9:_-]*)(?:(?:[.#:]|\[).*)?$/i.test(trimmed);
}

function parseScriptAction(
  raw: string,
  source: BrowserClickActionSource,
): BrowserClickAction | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/^js:\s*/i, "");

  let match = FRAME_QUERY_SELECTOR_CLICK_RE.exec(normalized);
  if (match) {
    return {
      kind: "selector",
      target: match[4].trim(),
      frameSelector: match[2].trim(),
      source,
      raw: trimmed,
    };
  }

  match = QUERY_SELECTOR_CLICK_RE.exec(normalized);
  if (match) {
    return {
      kind: "selector",
      target: match[2].trim(),
      source,
      raw: trimmed,
    };
  }

  match = GET_ELEMENT_BY_ID_CLICK_RE.exec(normalized);
  if (match) {
    return {
      kind: "selector",
      target: `#${match[2].trim()}`,
      source,
      raw: trimmed,
    };
  }

  match = GET_ELEMENTS_BY_CLASS_NAME_CLICK_RE.exec(normalized);
  if (match) {
    const selector = toClassSelector(match[2]);
    if (!selector) return null;
    return {
      kind: "selector",
      target: selector,
      index: Number.parseInt(match[3], 10),
      source,
      raw: trimmed,
    };
  }

  match = GET_ELEMENTS_BY_TAG_NAME_CLICK_RE.exec(normalized);
  if (match) {
    return {
      kind: "selector",
      target: match[2].trim(),
      index: Number.parseInt(match[3], 10),
      source,
      raw: trimmed,
    };
  }

  match = GET_ELEMENTS_BY_NAME_CLICK_RE.exec(normalized);
  if (match) {
    return {
      kind: "selector",
      target: `[name="${match[2].trim()}"]`,
      index: Number.parseInt(match[3], 10),
      source,
      raw: trimmed,
    };
  }

  return null;
}

function parseClickEntries(
  rawClick: string | undefined,
  source: BrowserClickActionSource,
): BrowserParsePolicy {
  const normalized = normalizeEntry(rawClick ?? "");
  if (!normalized) {
    return { actions: [], ignoredEntries: [] };
  }

  const scriptAction = parseScriptAction(normalized, source);
  if (scriptAction) {
    return { actions: [scriptAction], ignoredEntries: [] };
  }

  const parts = normalized
    .split(/[|\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const tokens = parts.length > 0 ? parts : [normalized];
  const actions: BrowserClickAction[] = [];
  const ignoredEntries: string[] = [];

  for (const token of tokens) {
    const parsed = parseScriptAction(token, source);
    if (parsed) {
      actions.push(parsed);
      continue;
    }

    if (looksLikeSelector(token)) {
      actions.push({
        kind: "selector",
        target: token,
        source,
        raw: token,
      });
      continue;
    }

    if (!/[();={}]/.test(token)) {
      actions.push({
        kind: "text",
        target: token,
        source,
        raw: token,
      });
      continue;
    }

    ignoredEntries.push(token);
  }

  return { actions, ignoredEntries };
}

export function buildBrowserParsePolicy(
  click: string | undefined,
  playbackRules: TvBoxPlaybackRule[] | undefined,
  pageUrl: string,
): BrowserParsePolicy {
  const sitePolicy = parseClickEntries(click, "site-click");
  const actions = [...sitePolicy.actions];
  const ignoredEntries = [...sitePolicy.ignoredEntries];

  for (const rule of matchPlaybackRules(playbackRules, pageUrl)) {
    for (const script of rule.script) {
      const parsed = parseClickEntries(script, "rule-script");
      actions.push(...parsed.actions);
      ignoredEntries.push(
        ...parsed.ignoredEntries.map((entry) => `${rule.name}: ${entry}`),
      );
    }
  }

  return { actions, ignoredEntries };
}
