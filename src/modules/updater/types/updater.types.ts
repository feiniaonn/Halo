export type UpdaterConfig = {
  endpoint: string;
};

export type UpdaterCheckResult = {
  available: boolean;
  current_version?: string | null;
  version?: string | null;
  date?: string | null;
  body?: string | null;
};

export type UpdaterEndpointProbeResult = {
  reachable: boolean;
  status?: number | null;
  elapsed_ms?: number | null;
  message?: string | null;
};

export type UpdaterEndpointHealth =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; result: UpdaterEndpointProbeResult }
  | { state: "error"; message?: string; result?: UpdaterEndpointProbeResult };

export type UpdaterStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; result: UpdaterCheckResult }
  | { state: "up_to_date" }
  | { state: "downloading"; downloaded: number; total: number | null }
  | { state: "downloaded" }
  | { state: "installed" }
  | { state: "error"; message: string };
