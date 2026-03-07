import type { LiveChannel, LiveGroup } from "@/modules/live/types/live.types";

export type LivePlayerKernelMode = "auto" | "proxy" | "direct" | "native" | "mpv";

export type LivePlayerLaunchPayload = {
  groups: LiveGroup[];
  initialGroup: string;
  initialChannel: LiveChannel;
  initialLineIndex?: number;
  initialKernelMode?: LivePlayerKernelMode;
};
