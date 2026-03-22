import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTvBoxConfig, NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";

const {
  invokeMock,
  fetchVodDetailMock,
  loadPersistedVodDispatchCacheMock,
  savePersistedVodDispatchCacheMock,
  listVodSiteRankingsMock,
  listVodDispatchBackendStatsMock,
  recordVodDispatchBackendSuccessMock,
  recordVodDispatchBackendFailureMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  fetchVodDetailMock: vi.fn(),
  loadPersistedVodDispatchCacheMock: vi.fn(),
  savePersistedVodDispatchCacheMock: vi.fn(),
  listVodSiteRankingsMock: vi.fn(),
  listVodDispatchBackendStatsMock: vi.fn(),
  recordVodDispatchBackendSuccessMock: vi.fn(),
  recordVodDispatchBackendFailureMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@/modules/media/services/vodDetail", () => ({
  fetchVodDetail: fetchVodDetailMock,
}));

vi.mock("@/modules/media/services/vodBrowseRuntime", () => ({
  runWithConcurrencyLimit: async <T,>(
    items: T[],
    _limit: number,
    handler: (item: T, index: number) => Promise<void>,
  ) => {
    for (const [index, item] of items.entries()) {
      await handler(item, index);
    }
  },
  withVodInterfaceTimeout: <T,>(promise: Promise<T>) => promise,
}));

vi.mock("@/modules/media/services/vodPersistentCache", () => ({
  loadPersistedVodDispatchCache: loadPersistedVodDispatchCacheMock,
  savePersistedVodDispatchCache: savePersistedVodDispatchCacheMock,
}));

vi.mock("@/modules/media/services/vodSourceRanking", () => ({
  listVodSiteRankings: listVodSiteRankingsMock,
}));

vi.mock("@/modules/media/services/vodDispatchHealth", () => ({
  classifyVodDispatchFailure: vi.fn(() => "runtime"),
  isVodDispatchBackendQuarantined: vi.fn(() => false),
  isVodOriginMetadataSite: vi.fn((site: Pick<NormalizedTvBoxSite, "capability"> | null | undefined) => (
    site?.capability.dispatchRole === "origin-metadata"
  )),
  listVodDispatchBackendStats: listVodDispatchBackendStatsMock,
  recordVodDispatchBackendFailure: recordVodDispatchBackendFailureMock,
  recordVodDispatchBackendSuccess: recordVodDispatchBackendSuccessMock,
  sortVodDispatchBackendSites: vi.fn((sites: NormalizedTvBoxSite[]) => (
    sites.filter((site) => site.capability.canSearch && site.capability.dispatchRole !== "origin-metadata")
  )),
}));

vi.mock("@/modules/media/services/tvboxConfig", () => ({
  parseVodResponse: vi.fn((payload: string) => JSON.parse(payload)),
  resolveSiteSpiderUrl: vi.fn(() => ""),
}));

import { resolveVodDispatchMatches } from "@/modules/media/services/vodDispatchResolver";

function createSite(
  key: string,
  overrides: Partial<NormalizedTvBoxSite> = {},
  capabilityOverrides: Partial<NormalizedTvBoxSite["capability"]> = {},
): NormalizedTvBoxSite {
  return {
    key,
    name: key,
    type: 0,
    api: `https://example.com/${key}`,
    jar: "",
    ext: null,
    extKind: "value",
    extValue: "",
    searchable: true,
    quickSearch: false,
    filterable: false,
    playUrl: "",
    click: "",
    playerType: "",
    categories: [],
    capability: {
      sourceKind: "cms",
      dispatchRole: "resource-backend",
      canHome: true,
      canCategory: true,
      canSearch: true,
      searchOnly: false,
      displayOnly: false,
      requiresSpider: false,
      supportsDetail: true,
      supportsPlay: true,
      mayNeedParse: false,
      supportsBrowserParse: false,
      hasRemoteExt: false,
      hasPlayUrl: false,
      hasPresetCategories: false,
      ...capabilityOverrides,
    },
    ...overrides,
  };
}

function createConfig(sites: NormalizedTvBoxSite[]): NormalizedTvBoxConfig {
  return {
    spider: "",
    sites,
    urls: [],
    parses: [],
    headers: [],
    rules: [],
    doh: [],
    proxy: [],
    proxyRules: [],
    tlsMode: "system",
    caBundlePath: "",
    hostnameVerification: "default",
    hosts: [],
    ads: [],
    logo: "",
    wallpaper: "",
  };
}

describe("vodDispatchResolver", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    fetchVodDetailMock.mockReset();
    loadPersistedVodDispatchCacheMock.mockReset();
    savePersistedVodDispatchCacheMock.mockReset();
    listVodSiteRankingsMock.mockReset();
    listVodDispatchBackendStatsMock.mockReset();
    recordVodDispatchBackendSuccessMock.mockReset();
    recordVodDispatchBackendFailureMock.mockReset();

    loadPersistedVodDispatchCacheMock.mockResolvedValue(null);
    savePersistedVodDispatchCacheMock.mockResolvedValue(undefined);
    listVodSiteRankingsMock.mockResolvedValue([]);
    listVodDispatchBackendStatsMock.mockResolvedValue([]);
    recordVodDispatchBackendSuccessMock.mockResolvedValue(undefined);
    recordVodDispatchBackendFailureMock.mockResolvedValue(undefined);
  });

  it("keeps metadata-origin dispatch in search-only mode until the user selects a candidate", async () => {
    const metadataSite = createSite(
      "douban",
      {},
      {
        canSearch: false,
        displayOnly: true,
        supportsPlay: false,
        dispatchRole: "origin-metadata",
      },
    );
    const backendSite = createSite("hanquan");

    invokeMock.mockResolvedValue(JSON.stringify({
      list: [
        { vod_id: "vod-1", vod_name: "Movie One", vod_pic: "", vod_remarks: "HD" },
      ],
    }));

    const resolution = await resolveVodDispatchMatches({
      keyword: "Movie One",
      fallbackTitle: "",
      maxMatches: 2,
      config: createConfig([metadataSite, backendSite]),
      activeSiteKey: backendSite.key,
      originSiteKey: metadataSite.key,
      sourceKey: "source-a",
      repoUrl: "repo-a",
      runtimeSessionKey: "runtime-a",
      policyGeneration: 1,
      concurrency: 2,
      isStale: () => false,
      resolveSiteExt: async () => "",
      getSpiderRuntimeWarmupPromise: () => null,
      syncSpiderExecutionState: async () => null,
    });

    expect(fetchVodDetailMock).not.toHaveBeenCalled();
    expect(recordVodDispatchBackendSuccessMock).not.toHaveBeenCalled();
    expect(resolution.matches).toHaveLength(1);
    expect(resolution.matches[0]).toMatchObject({
      siteKey: backendSite.key,
      vodId: "vod-1",
      matchTitle: "Movie One",
      requiresDetailResolve: true,
      originSiteKey: metadataSite.key,
    });
    expect(resolution.matches[0].detail).toBeUndefined();
    expect(resolution.matches[0].routes).toBeUndefined();
  });

  it("still resolves detail eagerly for normal backend-origin dispatch", async () => {
    const backendSite = createSite("backend-a");
    const siblingBackend = createSite("backend-b");

    invokeMock.mockResolvedValue(JSON.stringify({
      list: [
        { vod_id: "vod-2", vod_name: "Playable Title", vod_pic: "", vod_remarks: "" },
      ],
    }));
    fetchVodDetailMock.mockResolvedValue({
      detail: {
        vod_id: "vod-2",
        vod_name: "Playable Title",
        vod_pic: "",
      },
      routes: [
        {
          sourceName: "线路一",
          episodes: [{ name: "正片", url: "https://example.com/video.m3u8", searchOnly: false }],
        },
      ],
      extInput: "ext-a",
    });

    const resolution = await resolveVodDispatchMatches({
      keyword: "Playable Title",
      fallbackTitle: "",
      maxMatches: 1,
      config: createConfig([backendSite, siblingBackend]),
      activeSiteKey: backendSite.key,
      originSiteKey: backendSite.key,
      sourceKey: "source-b",
      repoUrl: "repo-b",
      runtimeSessionKey: "runtime-b",
      policyGeneration: 2,
      concurrency: 2,
      isStale: () => false,
      resolveSiteExt: async () => "",
      getSpiderRuntimeWarmupPromise: () => null,
      syncSpiderExecutionState: async () => null,
    });

    expect(fetchVodDetailMock).toHaveBeenCalledTimes(1);
    expect(recordVodDispatchBackendSuccessMock).toHaveBeenCalledWith(
      "source-b",
      "repo-b",
      backendSite.key,
      backendSite.key,
    );
    expect(resolution.matches[0]?.detail?.vod_id).toBe("vod-2");
    expect(resolution.matches[0]?.routes?.length).toBe(1);
    expect(resolution.matches[0]?.requiresDetailResolve).not.toBe(true);
  });
});
