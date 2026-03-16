import type { TvBoxVodItem } from '@/modules/media/types/tvbox.types';

function normalizeMatchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-_.·•:：,，'"“”‘’/\\|()\[\]{}【】<>《》]/g, '');
}

export function scoreVodDispatchCandidate(keyword: string, item: Pick<TvBoxVodItem, 'vod_name'>): number {
  const normalizedKeyword = normalizeMatchText(keyword);
  const normalizedTitle = normalizeMatchText(item.vod_name);
  if (!normalizedKeyword || !normalizedTitle) {
    return 0;
  }
  if (normalizedTitle === normalizedKeyword) {
    return 100;
  }
  if (normalizedTitle.includes(normalizedKeyword)) {
    return 80;
  }
  if (normalizedKeyword.includes(normalizedTitle)) {
    return 60;
  }
  const sharedPrefixLength = Array.from(normalizedKeyword).findIndex(
    (_, index) => normalizedKeyword[index] !== normalizedTitle[index],
  );
  if (sharedPrefixLength > 0) {
    return Math.min(40 + sharedPrefixLength, 59);
  }
  return 0;
}

export function pickBestVodDispatchCandidate(
  keyword: string,
  items: TvBoxVodItem[],
): TvBoxVodItem | null {
  let best: TvBoxVodItem | null = null;
  let bestScore = 0;

  for (const item of items) {
    const score = scoreVodDispatchCandidate(keyword, item);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  if (best) {
    return best;
  }
  return items[0] ?? null;
}
