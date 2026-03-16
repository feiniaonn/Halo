import { emitTo } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { EVENT_VOD_PLAYER_LAUNCH, EVENT_VOD_PLAYER_READY } from "@/modules/shared/services/events";
import { createWindowReadyBarrier } from "@/modules/shared/services/windowLaunchHandshake";
import type { VodPlayerLaunchPayload } from "@/modules/media/types/vodWindow.types";

export const VOD_PLAYER_WINDOW_LABEL = "vod_player";

const VOD_PLAYER_BOOTSTRAP_KEY = "halo_vod_player_bootstrap_payload_v1";
let isCreating = false;

function buildVodPlayerUrl(): string {
    const next = new URL(window.location.href);
    next.searchParams.set("window", VOD_PLAYER_WINDOW_LABEL);
    next.hash = "";
    return next.toString();
}

function rememberLaunchPayload(payload: VodPlayerLaunchPayload): void {
    try {
        console.log("[VOD] Saving bootstrap payload to localStorage...");
        localStorage.setItem(VOD_PLAYER_BOOTSTRAP_KEY, JSON.stringify(payload));
    } catch (err) {
        console.warn("[VOD] Failed to save bootstrap payload:", err);
    }
}

async function emitLaunchPayload(payload: VodPlayerLaunchPayload): Promise<void> {
    console.log(`[VOD] Emitting launch payload to ${VOD_PLAYER_WINDOW_LABEL}...`);
    await emitTo(VOD_PLAYER_WINDOW_LABEL, EVENT_VOD_PLAYER_LAUNCH, payload);
}

async function ensureFocused(win: WebviewWindow): Promise<void> {
    await win.unminimize().catch(() => void 0);
    await win.show();
    await win.setFocus();
}

export function readBootstrappedVodLaunchPayload(): VodPlayerLaunchPayload | null {
    try {
        const raw = localStorage.getItem(VOD_PLAYER_BOOTSTRAP_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as VodPlayerLaunchPayload;
    } catch {
        return null;
    }
}

export function clearBootstrappedVodLaunchPayload(): void {
    try {
        console.log("[VOD] Clearing bootstrap payload from localStorage.");
        localStorage.removeItem(VOD_PLAYER_BOOTSTRAP_KEY);
    } catch {
        // Ignore
    }
}

export async function openVodPlayerWindow(payload: VodPlayerLaunchPayload): Promise<void> {
    if (!isTauri()) return;

    if (isCreating) {
        console.warn("[VOD] A window creation is already in progress, skipping duplicate call.");
        return;
    }

    const existing = await WebviewWindow.getByLabel(VOD_PLAYER_WINDOW_LABEL);
    if (existing) {
        console.log("[VOD] Existing window found, updating payload and focusing...");
        rememberLaunchPayload(payload);
        await ensureFocused(existing);
        await emitLaunchPayload(payload);
        return;
    }

    isCreating = true;
    try {
        console.log("[VOD] Starting fresh window creation process...");
        rememberLaunchPayload(payload);

        const mainWindow = getCurrentWindow();
        const size = await mainWindow.innerSize();
        const scaleFactor = await mainWindow.scaleFactor();
        const width = size.width / scaleFactor;
        const height = size.height / scaleFactor;
        
        const readyBarrier = createWindowReadyBarrier(EVENT_VOD_PLAYER_READY, VOD_PLAYER_WINDOW_LABEL);
        console.log("[VOD] Handshake barrier armed.");
        await readyBarrier.armed;

        const win = new WebviewWindow(VOD_PLAYER_WINDOW_LABEL, {
            url: buildVodPlayerUrl(),
            title: "VOD Player",
            width: width,
            height: height,
            minWidth: 960,
            minHeight: 620,
            transparent: true,
            decorations: false,
            shadow: true,
            center: true,
            focus: true,
            visible: true,
            resizable: true,
        });

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            void win.once("tauri://created", () => {
                if (settled) return;
                settled = true;
                console.log("[VOD] WebviewWindow 'tauri://created' event received.");
                resolve();
            });
            void win.once("tauri://error", (event) => {
                if (settled) return;
                settled = true;
                console.error("[VOD] WebviewWindow 'tauri://error' event received:", event.payload);
                reject(new Error(String(event.payload)));
            });
        });

        await ensureFocused(win);
        console.log("[VOD] Waiting for ready signal from player window components...");
        await readyBarrier.ready;
        console.log("[VOD] Handshake complete. Pushing final launch payload...");
        await emitLaunchPayload(payload);
    } catch (err) {
        console.error("[VOD] Window creation failed:", err);
        throw err;
    } finally {
        isCreating = false;
    }
}
