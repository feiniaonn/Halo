import type { NormalizedTvBoxSite, TvBoxClass } from "@/modules/media/types/tvbox.types";

export interface VodMetadataHomeFallbackTarget {
  classId: string;
  classes: TvBoxClass[];
}

export function getVodMetadataHomeFallbackTarget(
  site: Pick<NormalizedTvBoxSite, "capability">,
  presetClasses: TvBoxClass[],
): VodMetadataHomeFallbackTarget | null {
  if (
    site.capability.dispatchRole !== "origin-metadata"
    || !site.capability.canCategory
    || presetClasses.length === 0
  ) {
    return null;
  }

  const classId = presetClasses[0]?.type_id ?? "";
  if (!classId) {
    return null;
  }

  return {
    classId,
    classes: presetClasses,
  };
}
