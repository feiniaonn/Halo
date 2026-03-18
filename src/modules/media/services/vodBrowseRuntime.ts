import { humanizeVodError } from "@/modules/media/services/mediaError";
import type { VodBrowseItem } from "@/modules/media/types/tvbox.types";

export const VOD_INTERFACE_TIMEOUT_MS = 3000;
export const VOD_INTERFACE_TIMEOUT_CODE = `vod_interface_timeout_${VOD_INTERFACE_TIMEOUT_MS}ms`;

export function withVodInterfaceTimeout<T>(promise: Promise<T>, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${VOD_INTERFACE_TIMEOUT_CODE}:${stage}`));
    }, VOD_INTERFACE_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function normalizeVodRequestErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes(VOD_INTERFACE_TIMEOUT_CODE) || /execution timeout exceeded after\s+\d+s/i.test(message)) {
    return "接口解析超时（5秒）";
  }
  return humanizeVodError(message);
}

export async function runWithConcurrencyLimit<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!items.length) {
    return;
  }
  const cappedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runner = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: cappedConcurrency }, () => runner()));
}

function buildVodBrowseItemKey(item: VodBrowseItem): string {
  if ("aggregateSource" in item) {
    return `${item.aggregateSource.siteKey}::${item.vod_id}`;
  }
  return item.vod_id;
}

export function mergeVodBrowseItems(
  current: VodBrowseItem[],
  incoming: VodBrowseItem[],
): VodBrowseItem[] {
  if (incoming.length === 0) {
    return current;
  }
  const next = [...current];
  const existingKeys = new Set(next.map((item) => buildVodBrowseItemKey(item)));
  for (const item of incoming) {
    const key = buildVodBrowseItemKey(item);
    if (existingKeys.has(key)) {
      continue;
    }
    existingKeys.add(key);
    next.push(item);
  }
  return next;
}
