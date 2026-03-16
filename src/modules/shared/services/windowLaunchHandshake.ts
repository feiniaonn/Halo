import { emit, listen } from "@tauri-apps/api/event";

type WindowReadyPayload = {
  label: string;
};

type WindowReadyBarrier = {
  armed: Promise<void>;
  ready: Promise<void>;
};

const DEFAULT_READY_TIMEOUT_MS = 15000;

export async function emitWindowReady(eventName: string, label: string): Promise<void> {
  console.log(`[Handshake] Emitting ready signal: ${eventName} for ${label}`);
  await emit(eventName, { label } satisfies WindowReadyPayload);
}

export function createWindowReadyBarrier(
  eventName: string,
  label: string,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
): WindowReadyBarrier {
  let settleReady: (() => void) | undefined;
  let rejectReady: ((reason?: unknown) => void) | undefined;
  let off: (() => void) | undefined;
  let settled = false;
  let timer: number | undefined;

  const clear = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    off?.();
    off = undefined;
  };

  const ready = new Promise<void>((resolve, reject) => {
    settleReady = () => {
      if (settled) return;
      settled = true;
      clear();
      resolve();
    };
    rejectReady = (reason) => {
      if (settled) return;
      settled = true;
      clear();
      reject(reason);
    };
  });

  const armed = listen<WindowReadyPayload>(eventName, ({ payload }) => {
    console.log(`[Handshake] Received signal: ${eventName} payload:`, payload);
    if (payload?.label !== label) return;
    console.log(`[Handshake] Signal matched label: ${label}. Settling ready.`);
    settleReady?.();
  }).then((unlisten) => {
    console.log(`[Handshake] Barrier armed for ${label} (event: ${eventName})`);
    off = unlisten;
    timer = window.setTimeout(() => {
      console.error(`[Handshake] Barrier TIMEOUT for ${label} after ${timeoutMs}ms`);
      rejectReady?.(new Error(`Timed out while waiting for ${label} readiness.`));
    }, timeoutMs);
  }).catch((error) => {
    console.error(`[Handshake] Barrier arming FAILED for ${label}:`, error);
    rejectReady?.(error);
    throw error;
  });

  return { armed, ready };
}
