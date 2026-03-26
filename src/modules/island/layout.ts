export const MINI_WINDOW_HORIZONTAL_PADDING = 56;
export const MINI_WINDOW_TOP_PADDING = 30;
export const MINI_WINDOW_BOTTOM_PADDING = 34;
export const MINI_ISLAND_TOP_OFFSET = 20;

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
  minWidth = 0,
  minHeight = 0,
) {
  return {
    width: Math.max(minWidth, layout.expandedWidth + MINI_WINDOW_HORIZONTAL_PADDING),
    height: Math.max(minHeight, layout.expandedHeight + MINI_WINDOW_TOP_PADDING + MINI_WINDOW_BOTTOM_PADDING),
  };
}
