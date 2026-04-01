import { invoke } from "@tauri-apps/api/core";

import type {
  AiConnectionProbeResult,
  AiChatTestResult,
  AiConnectionSettings,
  AiLatencyResult,
  AiModelDetectionResponse,
  MusicAiModuleSettings,
  MusicAiRecommendation,
} from "@/modules/ai/types/ai.types";

export async function getAiConnectionSettings(): Promise<AiConnectionSettings> {
  return invoke<AiConnectionSettings>("ai_get_connection_settings");
}

export async function saveAiConnectionSettings(
  settings: AiConnectionSettings,
): Promise<AiConnectionSettings> {
  return invoke<AiConnectionSettings>("ai_save_connection_settings", { settings });
}

export async function detectAiModels(
  settings: AiConnectionSettings,
): Promise<AiModelDetectionResponse> {
  return invoke<AiModelDetectionResponse>("ai_detect_models", { settings });
}

export async function testAiLatency(
  settings: AiConnectionSettings,
): Promise<AiLatencyResult> {
  return invoke<AiLatencyResult>("ai_test_latency", { settings });
}

export async function testAiChat(
  settings: AiConnectionSettings,
  prompt?: string,
): Promise<AiChatTestResult> {
  return invoke<AiChatTestResult>("ai_test_chat", { settings, prompt });
}

export async function probeAiConnection(
  settings: AiConnectionSettings,
): Promise<AiConnectionProbeResult> {
  return invoke<AiConnectionProbeResult>("ai_probe_connection", { settings });
}

export async function getMusicAiModuleSettings(): Promise<MusicAiModuleSettings> {
  return invoke<MusicAiModuleSettings>("ai_music_get_settings");
}

export async function saveMusicAiModuleSettings(
  settings: MusicAiModuleSettings,
): Promise<MusicAiModuleSettings> {
  return invoke<MusicAiModuleSettings>("ai_music_save_settings", { settings });
}

export async function getMusicAiRecommendation(
  forceRefresh = false,
): Promise<MusicAiRecommendation> {
  return invoke<MusicAiRecommendation>("ai_music_get_recommendation", {
    request: { force_refresh: forceRefresh },
  });
}
