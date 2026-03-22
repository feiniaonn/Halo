import type { TvBoxVodItem } from '@/modules/media/types/tvbox.types';

const MIN_DISPATCH_MATCH_SCORE = 36;

function normalizeMatchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z\u4e00-\u9fa5]/gi, '');
}

function tokenizeMatchText(value: string): string[] {
  return Array.from(
    new Set(
      value
        .trim()
        .toLowerCase()
        .split(/[^0-9a-z\u4e00-\u9fa5]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

export function scoreVodDispatchCandidate(
  keyword: string,
  item: Pick<TvBoxVodItem, 'vod_name' | 'vod_remarks'>,
): number {
  const normalizedKeyword = normalizeMatchText(keyword);
  const normalizedTitle = normalizeMatchText(item.vod_name);
  if (!normalizedKeyword || !normalizedTitle) {
    return 0;
  }

  if (normalizedTitle === normalizedKeyword) {
    return 140;
  }

  let score = 0;
  if (
    normalizedTitle.startsWith(normalizedKeyword)
    || normalizedKeyword.startsWith(normalizedTitle)
  ) {
    score = Math.max(score, 112);
  } else if (
    normalizedTitle.includes(normalizedKeyword)
    || normalizedKeyword.includes(normalizedTitle)
  ) {
    score = Math.max(score, 92);
  }

  const keywordTokens = tokenizeMatchText(keyword);
  const titleTokens = tokenizeMatchText(item.vod_name);
  if (keywordTokens.length > 0 && titleTokens.length > 0) {
    const sharedTokenCount = keywordTokens.filter((token) => titleTokens.includes(token)).length;
    if (sharedTokenCount > 0) {
      score = Math.max(score, 36 + Math.min(sharedTokenCount * 18, 44));
    }
  }

  const sharedPrefixLength = Array.from(normalizedKeyword).findIndex(
    (_, index) => normalizedKeyword[index] !== normalizedTitle[index],
  );
  if (sharedPrefixLength >= 4) {
    score = Math.max(score, Math.min(40 + sharedPrefixLength, 59));
  }

  const normalizedRemarks = normalizeMatchText(item.vod_remarks ?? '');
  if (normalizedRemarks) {
    if (
      normalizedRemarks.includes(normalizedKeyword)
      || normalizedKeyword.includes(normalizedRemarks)
    ) {
      score += 8;
    }
  }

  return score;
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

  if (best && bestScore >= MIN_DISPATCH_MATCH_SCORE) {
    return best;
  }
  return null;
}
