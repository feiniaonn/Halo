import { useCallback, useEffect, useMemo, useState } from "react";

import { parseLiveTxt } from "@/modules/live/services/liveParser";
import type { LiveGroup } from "@/modules/live/types/live.types";
import {
  isSupportedSourceTarget,
  loadLiveSourceText,
  normalizeSourceTarget,
} from "@/modules/media/services/mediaSourceLoader";
import { parseSingleSource } from "@/modules/media/services/tvboxConfig";
import type { MediaNotice } from "@/modules/media/types/mediaPage.types";

const MEDIA_LIVE_SOURCE_KEY = "halo_media_live_source";

interface UseLiveSourceControllerOptions {
  notify: (notice: MediaNotice) => void;
}

export function useLiveSourceController({ notify }: UseLiveSourceControllerOptions) {
  const [source, setSource] = useState(() => localStorage.getItem(MEDIA_LIVE_SOURCE_KEY)?.trim() ?? "");
  const [draft, setDraft] = useState(source);
  const [groups, setGroups] = useState<LiveGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setGroups([]);
      setActiveGroup("");
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchLiveContent = async () => {
      setLoading(true);
      setError(null);

      try {
        const text = await loadLiveSourceText(source);
        if (cancelled) return;

        const parsedGroups = parseLiveTxt(text);
        setGroups(parsedGroups);
        setActiveGroup(parsedGroups[0]?.groupName ?? "");
        if (parsedGroups.length === 0) {
          setError("直播源已加载，但未解析出可用频道。");
        }
      } catch (reason) {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(`加载直播源失败: ${message}`);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchLiveContent();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const currentGroup = useMemo(
    () => groups.find((group) => group.groupName === activeGroup) ?? groups[0],
    [activeGroup, groups],
  );

  const syncDraft = useCallback(() => {
    setDraft(source);
  }, [source]);

  const saveSource = useCallback(() => {
    const parsed = parseSingleSource(draft);
    const normalizedSource = normalizeSourceTarget(parsed.source);
    if (!normalizedSource) {
      notify({ kind: "error", text: "直播源地址不能为空。" });
      return;
    }
    if (!isSupportedSourceTarget(normalizedSource)) {
      notify({ kind: "error", text: "直播源地址必须为 http(s) 地址或 file:// 本地文件路径。" });
      return;
    }

    localStorage.setItem(MEDIA_LIVE_SOURCE_KEY, normalizedSource);
    setSource(normalizedSource);
    setDraft(normalizedSource);
    notify({
      kind: parsed.warning ? "warning" : "success",
      text: parsed.warning ?? "直播源已保存。",
    });
  }, [draft, notify]);

  const clearSource = useCallback(() => {
    localStorage.removeItem(MEDIA_LIVE_SOURCE_KEY);
    setSource("");
    setDraft("");
    setGroups([]);
    setActiveGroup("");
    setError(null);
    notify({ kind: "success", text: "直播源已清空。" });
  }, [notify]);

  return {
    source,
    draft,
    setDraft,
    groups,
    activeGroup,
    currentGroup,
    loading,
    error,
    setActiveGroup,
    syncDraft,
    saveSource,
    clearSource,
  };
}
