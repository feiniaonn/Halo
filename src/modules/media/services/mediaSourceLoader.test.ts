import { describe, expect, it } from "vitest";

import {
  isSupportedSourceTarget,
  normalizeSourceTarget,
} from "@/modules/media/services/mediaSourceLoader";

describe("mediaSourceLoader", () => {
  it("normalizes local windows paths to file urls", () => {
    expect(normalizeSourceTarget("D:\\TVBox\\demo.json")).toBe("file:///D:/TVBox/demo.json");
  });

  it("accepts remote and file targets", () => {
    expect(isSupportedSourceTarget("https://example.com/demo.json")).toBe(true);
    expect(isSupportedSourceTarget("file:///D:/TVBox/demo.json")).toBe(true);
    expect(isSupportedSourceTarget("D:\\TVBox\\demo.json")).toBe(false);
  });
});
