import { invoke } from '@tauri-apps/api/core';

export type NativePlayerEngine = 'mpv';
export type NativeTransportMode = 'direct' | 'proxy';

export interface NativeHostBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  dpiScale: number;
}

export interface NativeMediaRequest {
  url: string;
  headers: Record<string, string> | null;
  title?: string;
  transportMode: NativeTransportMode;
}

export interface NativePlayerLoadResult {
  engine: NativePlayerEngine;
  acknowledged: boolean;
  ignoredHeaders: string[];
  pid?: number | null;
  runtimePath?: string | null;
}

export interface NativePlayerStatus {
  engine: NativePlayerEngine | null;
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
  firstFrameRendered: boolean;
  positionMs: number | null;
  durationMs: number | null;
  hostAttached: boolean;
  hostVisible: boolean;
  hostWidth: number | null;
  hostHeight: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  fullscreen: boolean | null;
}

export async function initOrAttachNativePlayer(
  windowLabel: string,
  engine: NativePlayerEngine,
  hostBounds: NativeHostBounds,
): Promise<void> {
  await invoke('native_player_init_or_attach', {
    windowLabel,
    engine,
    hostBounds,
  });
}

export async function loadNativePlayer(
  windowLabel: string,
  request: NativeMediaRequest,
): Promise<NativePlayerLoadResult> {
  return invoke<NativePlayerLoadResult>('native_player_load', {
    windowLabel,
    request,
  });
}

export async function resizeNativePlayer(
  windowLabel: string,
  hostBounds: NativeHostBounds,
): Promise<void> {
  await invoke('native_player_resize', {
    windowLabel,
    hostBounds,
  });
}

export async function getNativePlayerStatus(windowLabel: string): Promise<NativePlayerStatus> {
  return invoke<NativePlayerStatus>('native_player_status', {
    windowLabel,
  });
}

export async function commandNativePlayer(
  windowLabel: string,
  command: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await invoke('native_player_command', {
    windowLabel,
    request: {
      command,
      payload: payload ?? null,
    },
  });
}

export async function destroyNativePlayer(windowLabel: string): Promise<void> {
  await invoke('native_player_destroy', {
    windowLabel,
  });
}
