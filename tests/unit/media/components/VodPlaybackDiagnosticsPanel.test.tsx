// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VodPlaybackDiagnosticsPanel } from "@/modules/media/components/VodPlaybackDiagnosticsPanel";

describe("VodPlaybackDiagnosticsPanel", () => {
  it("renders the playback timeline with elapsed time, budget, and failure reason", () => {
    render(
      <VodPlaybackDiagnosticsPanel
        loading={false}
        report={{
          routeName: "线路二 (点击换线)",
          episodeName: "1",
          status: "error",
          reason: "episode playback resolve timeout (12000ms)",
          diagnostics: {
            startedAt: 1_710_000_000_000,
            steps: [
              {
                stage: "spider_payload",
                status: "success",
                detail: "cache=0 parse=1 jx=0 direct=1 url=http://wrapper.example.com/getM3u8",
                elapsedMs: 180,
              },
              {
                stage: "parse_attempt",
                status: "error",
                detail: "target=https://jiexi-a.example.com/?url= reason=wrapped parse fallback timed out after 6500ms",
                elapsedMs: 6_980,
                budgetMs: 6_500,
              },
              {
                stage: "final",
                status: "error",
                detail: "episode playback resolve timeout (12000ms)",
                elapsedMs: 12_000,
              },
            ],
          },
          updatedAt: 1_710_000_012_000,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /隐藏诊断/i }));
    fireEvent.click(screen.getByRole("button", { name: /播放诊断/i }));

    expect(screen.getByText("播放解析诊断")).toBeTruthy();
    expect(screen.getByText(/线路二 \(点击换线\)/)).toBeTruthy();
    expect(screen.getByText(/总耗时 12000 ms/)).toBeTruthy();
    expect(screen.getByText(/1\. Spider 返回/)).toBeTruthy();
    expect(screen.getByText(/2\. 解析尝试/)).toBeTruthy();
    expect(screen.getByText(/预算 6500 ms/)).toBeTruthy();
    expect(screen.getAllByText(/wrapped parse fallback timed out after 6500ms/).length).toBeGreaterThan(0);
  });
});
