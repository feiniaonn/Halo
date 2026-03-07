import { invoke } from "@tauri-apps/api/core";

import {
  normalizeRepoUrls,
  normalizeTvBoxConfig,
  parseTvboxJsonLoose,
} from "@/modules/media/services/tvboxConfig";
import type {
  NormalizedTvBoxConfig,
  RawTvBoxConfig,
  SpiderExecutionReport,
  TvBoxRepoUrl,
} from "@/modules/media/types/tvbox.types";

export interface LoadedVodSource {
  config: NormalizedTvBoxConfig;
  repoUrls: TvBoxRepoUrl[];
  activeRepoUrl: string;
}

function buildFileUrlFromPath(path: string): string {
  return `file:///${path.replace(/\\/g, "/")}`;
}

export function normalizeSourceTarget(raw: string): string {
  const trimmed = raw.trim().replace(/^"+|"+$/g, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed) || /^file:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return buildFileUrlFromPath(trimmed);
  }
  if (/^\\\\[^\\]+\\[^\\]+/.test(trimmed)) {
    return buildFileUrlFromPath(trimmed);
  }
  return trimmed;
}

export function isSupportedSourceTarget(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^file:\/\//i.test(value);
}

export async function fetchTvboxConfigText(url: string): Promise<string> {
  return invoke<string>("fetch_tvbox_config", { url });
}

export async function fetchTvboxPayload(url: string): Promise<unknown> {
  const response = await fetchTvboxConfigText(url);
  return parseTvboxJsonLoose(response);
}

export async function hydrateTvBoxConfig(raw: unknown): Promise<NormalizedTvBoxConfig> {
  if (!raw || typeof raw !== "object") {
    throw new Error("配置不是有效对象。");
  }

  const config = raw as RawTvBoxConfig;
  let spider = typeof config.spider === "string" ? config.spider.trim() : "";
  if (
    !spider
    || spider.startsWith("./")
    || spider.startsWith(";")
    || (!spider.startsWith("http") && !spider.startsWith("file://"))
  ) {
    try {
      spider = await invoke<string>("get_builtin_spider_jar_path");
    } catch (error) {
      console.warn("Failed to resolve built-in spider jar:", error);
    }
  }
  config.spider = spider;

  const normalized = normalizeTvBoxConfig(config);
  if (!normalized) {
    throw new Error("配置中未找到有效站点。");
  }
  return normalized;
}

export async function loadVodSource(url: string): Promise<LoadedVodSource> {
  const payload = await fetchTvboxPayload(url);
  const repoUrls = normalizeRepoUrls(payload);
  if (repoUrls.length > 0) {
    const activeRepoUrl = repoUrls[0].url;
    const subPayload = await fetchTvboxPayload(activeRepoUrl);
    return {
      config: await hydrateTvBoxConfig(subPayload),
      repoUrls,
      activeRepoUrl,
    };
  }

  return {
    config: await hydrateTvBoxConfig(payload),
    repoUrls: [],
    activeRepoUrl: "",
  };
}

export async function loadVodRepoSource(url: string): Promise<NormalizedTvBoxConfig> {
  return hydrateTvBoxConfig(await fetchTvboxPayload(url));
}

export async function loadLiveSourceText(url: string): Promise<string> {
  let text = await fetchTvboxConfigText(url);
  try {
    const payload = parseTvboxJsonLoose(text) as { urls?: Array<{ url?: string }> };
    const firstSubUrl = payload?.urls?.[0]?.url?.trim();
    if (firstSubUrl) {
      text = await fetchTvboxConfigText(firstSubUrl);
    }
  } catch {
    // Ignore repo-wrapper parsing failures and treat the payload as raw live text.
  }
  return text;
}

export async function readSpiderExecutionReport(siteKey: string): Promise<SpiderExecutionReport | null> {
  if (!siteKey) return null;
  try {
    return await invoke<SpiderExecutionReport | null>("get_spider_execution_report", { siteKey });
  } catch {
    return null;
  }
}
