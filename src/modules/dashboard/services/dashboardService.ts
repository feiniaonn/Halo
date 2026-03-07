import { invoke } from "@tauri-apps/api/core";
import type { DashboardSystemOverview } from "../types/dashboard.types";

export async function getDashboardSystemOverview(): Promise<DashboardSystemOverview> {
  return invoke<DashboardSystemOverview>("dashboard_system_overview");
}
