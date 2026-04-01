export type AiAuthType = "bearer" | "header" | "query";

export interface AiConnectionSettings {
  provider_name: string;
  base_url: string;
  api_key: string;
  auth_type: AiAuthType;
  api_key_header_name: string;
  api_key_prefix: string;
  api_key_query_name: string;
  models_path: string;
  chat_path: string;
  model_name: string;
  request_timeout_ms: number;
  temperature: number;
  max_tokens: number;
  latency_prompt: string;
  latency_rounds: number;
  extra_headers: string;
  updated_at: number | null;
}

export interface AiModelOption {
  id: string;
  label: string;
  owned_by: string | null;
  created: number | null;
}

export interface AiModelDetectionResponse {
  models: AiModelOption[];
  total: number;
  source_status: number;
}

export interface AiLatencyRound {
  round: number;
  latency_ms: number;
  ok: boolean;
  status: number | null;
  error: string | null;
}

export interface AiLatencyResult {
  average_latency_ms: number;
  min_latency_ms: number;
  max_latency_ms: number;
  successful_rounds: number;
  failed_rounds: number;
  rounds: AiLatencyRound[];
  response_sample: string | null;
}

export interface AiChatTestResult {
  ok: boolean;
  latency_ms: number;
  status: number;
  reply: string;
  error: string | null;
  model_name: string;
  usage_json: string | null;
}

export interface AiConnectionProbeResult {
  ok: boolean;
  resolved_model: string;
  models: AiModelOption[];
  total_models: number;
  models_status: number | null;
  chat_status: number | null;
  latency_ms: number | null;
  reply: string;
  error: string | null;
  usage_json: string | null;
  cache_hit: boolean;
}

export interface MusicAiModuleSettings {
  enabled: boolean;
  system_prompt: string;
  updated_at: number | null;
}

export interface MusicAiRecommendation {
  enabled: boolean;
  configured: boolean;
  source: "live" | "cache" | "disabled" | "unconfigured" | "no-data" | "error";
  date_key: string | null;
  song_name: string | null;
  mood: string | null;
  raw_reply: string | null;
  error: string | null;
  updated_at: number | null;
  model_name: string | null;
}

export function createDefaultAiConnectionSettings(): AiConnectionSettings {
  return {
    provider_name: "Halo AI",
    base_url: "https://api.openai.com",
    api_key: "",
    auth_type: "bearer",
    api_key_header_name: "Authorization",
    api_key_prefix: "Bearer ",
    api_key_query_name: "api_key",
    models_path: "v1/models",
    chat_path: "v1/chat/completions",
    model_name: "",
    request_timeout_ms: 120000,
    temperature: 0.2,
    max_tokens: 256,
    latency_prompt: "请只回复“连接成功”四个字。",
    latency_rounds: 3,
    extra_headers: "{}",
    updated_at: null,
  };
}

export function createDefaultMusicAiModuleSettings(): MusicAiModuleSettings {
  return {
    enabled: false,
    system_prompt:
      "你是 Halo 的音乐偏好分析助手。请根据用户最近播放次数 Top 10 只推荐一首最适合继续听的歌，并给出一个 2 到 5 个字的心情描述。不要解释原因。",
    updated_at: null,
  };
}

