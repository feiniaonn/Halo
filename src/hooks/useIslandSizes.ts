import { useState, useEffect } from "react";

export interface IslandSizes {
  capsuleWidth: number;
  capsuleHeight: number;
  expandedWidth: number;
  expandedHeight: number;
}

export function getDefaultIslandSizes(): IslandSizes {
  const sw = window.screen.width;
  if (sw < 1366) {
    return { capsuleWidth: 160, capsuleHeight: 34, expandedWidth: 320, expandedHeight: 140 };
  } else if (sw <= 1920) {
    return { capsuleWidth: 200, capsuleHeight: 36, expandedWidth: 340, expandedHeight: 154 };
  } else if (sw <= 2560) {
    return { capsuleWidth: 240, capsuleHeight: 40, expandedWidth: 380, expandedHeight: 164 };
  } else {
    // 4K and above
    return { capsuleWidth: 280, capsuleHeight: 44, expandedWidth: 420, expandedHeight: 180 };
  }
}

export function useIslandSizes() {
  const getStoredSizes = () => {
    try {
      const stored = localStorage.getItem("halo_island_sizes");
      if (stored) {
        return { ...getDefaultIslandSizes(), ...JSON.parse(stored) };
      }
    } catch {
      // ignore
    }
    return getDefaultIslandSizes();
  };

  const [sizes, setSizes] = useState<IslandSizes>(getStoredSizes);

  // Sync state between hook usages across the app
  useEffect(() => {
    const handler = () => {
      setSizes(getStoredSizes());
    };
    window.addEventListener("halo_island_sizes_changed", handler);
    return () => window.removeEventListener("halo_island_sizes_changed", handler);
  }, []);

  const updateSizes = (newSizes: Partial<IslandSizes>) => {
    const updated = { ...sizes, ...newSizes };
    setSizes(updated);
    localStorage.setItem("halo_island_sizes", JSON.stringify(updated));
    window.dispatchEvent(new Event("halo_island_sizes_changed"));
  };

  return { sizes, updateSizes };
}
