import { clockIslandModule } from "@/modules/island/components/IslandClockModule";
import { musicIslandModule } from "@/modules/island/components/IslandMusicModule";
import type { IslandModuleDefinition, IslandModuleRenderContext } from "@/modules/island/types";

export const islandModules: IslandModuleDefinition[] = [musicIslandModule, clockIslandModule].sort(
  (left, right) => right.priority - left.priority,
);

export function resolveIslandModule(context: IslandModuleRenderContext) {
  return islandModules.find((module) => module.isActive(context)) ?? clockIslandModule;
}
