export const MINI_WINDOW_HORIZONTAL_PADDING = 0;
export const MINI_WINDOW_TOP_PADDING = 0;
export const MINI_WINDOW_BOTTOM_PADDING = 0;
export const MINI_ISLAND_TOP_OFFSET = 0;

export type MiniIslandLayout = {
  capsuleWidth: number;
  capsuleHeight: number;
  expandedWidth: number;
  expandedHeight: number;
};

export function resolveMiniIslandLayout(capsuleWidth: number, capsuleHeight: number): MiniIslandLayout {
  return {
    capsuleWidth,
    capsuleHeight,
    expandedWidth: Math.round(capsuleWidth * 3),
    expandedHeight: Math.round(capsuleHeight * 1.3),
  };
}

export function resolveMiniWindowLogicalSize(
  layout: MiniIslandLayout,
  mode: "capsule" | "expanded" = "capsule",
) {
  const baseWidth = mode === "expanded" ? layout.expandedWidth : layout.capsuleWidth;
  const baseHeight = mode === "expanded" ? layout.expandedHeight : layout.capsuleHeight;
  return {
    width: baseWidth + MINI_WINDOW_HORIZONTAL_PADDING,
    height: baseHeight + MINI_WINDOW_TOP_PADDING + MINI_WINDOW_BOTTOM_PADDING,
  };
}
