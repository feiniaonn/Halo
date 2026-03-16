import { describe, expect, it } from "vitest";

import {
  acquireVodPlaybackLock,
  buildVodPlaybackLockKey,
  releaseVodPlaybackLock,
} from "@/modules/media/services/vodPlaybackSingleflight";

describe("vodPlaybackSingleflight", () => {
  it("blocks duplicate playback for the same route episode and kernel", () => {
    const key = buildVodPlaybackLockKey(
      "线路一",
      { name: "第1集", url: "https://example.com/play/1" },
      "mpv",
    );

    const first = acquireVodPlaybackLock(key);
    expect(first.acquired).toBe(true);
    if (!first.acquired) {
      throw new Error("expected first lock acquisition to succeed");
    }

    const second = acquireVodPlaybackLock(key);
    expect(second.acquired).toBe(false);

    releaseVodPlaybackLock(key, first.token);

    const third = acquireVodPlaybackLock(key);
    expect(third.acquired).toBe(true);
    if (third.acquired) {
      releaseVodPlaybackLock(key, third.token);
    }
  });
});
