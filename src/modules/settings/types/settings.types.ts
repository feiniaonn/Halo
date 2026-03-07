export type MiniRestoreMode = "button" | "double_click" | "both";
export type CloseBehavior = "exit" | "tray" | "tray_mini";

export interface AppSettingsResponse {
  storage_root: string | null;
  storage_display_path: string;
  legacy_roots: string[];
  launch_at_login: boolean;
  close_behavior: CloseBehavior;
  background_type?: string | null;
  background_path?: string | null;
  background_image_path?: string | null;
  background_video_path?: string | null;
  background_blur?: number;
  allow_component_download: boolean;
  mini_restore_mode: MiniRestoreMode;
}

export interface MigrationProgress {
  running: boolean;
  total: number;
  done: number;
  current_legacy_base: string | null;
  message: string | null;
}

export interface MigrationCompletePayload {
  success: boolean;
  canceled: boolean;
  error: string | null;
}
