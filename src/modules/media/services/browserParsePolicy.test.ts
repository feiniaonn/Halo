import { describe, expect, it } from "vitest";

import { buildBrowserParsePolicy } from "@/modules/media/services/browserParsePolicy";

describe("browserParsePolicy", () => {
  it("treats plain site click as selector action", () => {
    const policy = buildBrowserParsePolicy(".btn-play", undefined, "https://example.com/play");
    expect(policy.ignoredEntries).toEqual([]);
    expect(policy.actions).toEqual([
      {
        kind: "selector",
        target: ".btn-play",
        source: "site-click",
        raw: ".btn-play",
      },
    ]);
  });

  it("parses iframe querySelector scripts into safe click actions", () => {
    const policy = buildBrowserParsePolicy(
      undefined,
      [
        {
          name: "饭团点击",
          hosts: ["freeok"],
          regex: [],
          script: [
            "document.querySelector(\"#playleft iframe\").contentWindow.document.querySelector(\"#start\").click();",
          ],
        },
      ],
      "https://freeok.example.com/watch/1",
    );

    expect(policy.ignoredEntries).toEqual([]);
    expect(policy.actions).toEqual([
      {
        kind: "selector",
        target: "#start",
        frameSelector: "#playleft iframe",
        source: "rule-script",
        raw: "document.querySelector(\"#playleft iframe\").contentWindow.document.querySelector(\"#start\").click();",
      },
    ]);
  });

  it("parses getElementsByClassName scripts with index", () => {
    const policy = buildBrowserParsePolicy(
      undefined,
      [
        {
          name: "毛驴点击",
          hosts: ["maolvys"],
          regex: [],
          script: [
            "document.getElementsByClassName('swal-button swal-button--confirm')[0].click()",
          ],
        },
      ],
      "https://www.maolvys.com/vod/1",
    );

    expect(policy.actions).toEqual([
      {
        kind: "selector",
        target: ".swal-button.swal-button--confirm",
        index: 0,
        source: "rule-script",
        raw: "document.getElementsByClassName('swal-button swal-button--confirm')[0].click()",
      },
    ]);
  });

  it("records unsupported scripts without trying to execute them", () => {
    const policy = buildBrowserParsePolicy(
      undefined,
      [
        {
          name: "复杂脚本",
          hosts: ["example.com"],
          regex: [],
          script: ["console.log(window.location.href)"],
        },
      ],
      "https://example.com/play",
    );

    expect(policy.actions).toEqual([]);
    expect(policy.ignoredEntries).toEqual(["复杂脚本: console.log(window.location.href)"]);
  });
});
