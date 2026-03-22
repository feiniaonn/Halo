import { describe, expect, it } from "vitest";

import {
  computeVodDispatchFailureUpdate,
  getVodDispatchHealthState,
  mergeVodDispatchBackendFailure,
  mergeVodDispatchBackendSuccess,
} from "@/modules/media/services/vodDispatchHealth";

describe("vodDispatchHealth", () => {
  it("does not quarantine on the first hard failure", () => {
    const update = computeVodDispatchFailureUpdate(null, "runtime", 1000);

    expect(update.hardFailure).toBe(true);
    expect(update.quarantineUntil).toBe(0);
    expect(getVodDispatchHealthState(update.nextStat, 1000)).toBe("cooldown");
  });

  it("quarantines after repeated hard failures", () => {
    const first = computeVodDispatchFailureUpdate({
      targetSiteKey: "hxq",
      successCount: 0,
      failureCount: 0,
      lastStatus: "",
      lastFailureKind: null,
      lastUsedAt: 0,
      consecutiveHardFailures: 0,
      consecutiveUpstreamFailures: 0,
      quarantineUntil: 0,
    }, "payload", 1000);
    const second = computeVodDispatchFailureUpdate(first.nextStat, "payload", 2000);

    expect(second.quarantineUntil).toBeGreaterThan(2000);
    expect(getVodDispatchHealthState(second.nextStat, 2000)).toBe("quarantined");
  });

  it("requires more upstream failures before quarantine", () => {
    const first = computeVodDispatchFailureUpdate(null, "upstream", 1000);
    const second = computeVodDispatchFailureUpdate(first.nextStat, "upstream", 2000);
    const third = computeVodDispatchFailureUpdate(second.nextStat, "upstream", 3000);

    expect(first.quarantineUntil).toBe(0);
    expect(second.quarantineUntil).toBe(0);
    expect(third.quarantineUntil).toBeGreaterThan(3000);
  });

  it("clears cooldown and quarantine on success", () => {
    const cooled = mergeVodDispatchBackendFailure([], "appqi", "runtime", 1000);
    const recovered = mergeVodDispatchBackendSuccess(cooled, "appqi", 2000);

    expect(recovered[0]?.consecutiveHardFailures).toBe(0);
    expect(recovered[0]?.quarantineUntil).toBe(0);
    expect(getVodDispatchHealthState(recovered[0], 2000)).toBe("healthy");
  });
});
