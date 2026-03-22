import type { VodParseRankingRecord } from "@/modules/media/services/vodParseRanking";
import {
    getVodParseHealthSnapshot,
    getVodParseHealthState,
    type VodParseHealthRecord,
} from "@/modules/media/services/vodParseHealth";
import type { TvBoxParse } from "../types/vodWindow.types";

export interface VodParseSelectionOptions {
    jxIndex: number;
    routeName: string;
    pageUrl: string;
    rankingRecords?: VodParseRankingRecord[];
    healthRecords?: VodParseHealthRecord[];
}

export interface VodParseSelectionResult {
    ordered: TvBoxParse[];
    totalSupported: number;
    filteredOutCount: number;
}

export function supportsVodParseType(parse: TvBoxParse): boolean {
    return parse.type === 0 || parse.type === 1;
}

export function matchesParseFlags(parse: TvBoxParse, routeName: string, pageUrl: string): boolean {
    const flags = Array.isArray(parse.ext?.flag) ? parse.ext.flag : [];
    if (flags.length === 0) return true;

    const haystack = `${routeName} ${pageUrl}`.toLowerCase();
    return flags.some((flag) => {
        const token = String(flag ?? "").trim().toLowerCase();
        if (!token) return false;
        return haystack.includes(token);
    });
}

function reorderByJx(parses: TvBoxParse[], jxIndex: number): TvBoxParse[] {
    if (jxIndex < 1 || jxIndex > parses.length) return parses;
    const start = jxIndex - 1;
    return [...parses.slice(start), ...parses.slice(0, start)];
}

function normalizeParseUrl(url: string): string {
    return url.trim();
}

function reorderBySelectionSignals(
    parses: TvBoxParse[],
    rankingRecords: VodParseRankingRecord[] | undefined,
    healthRecords: VodParseHealthRecord[] | undefined,
): TvBoxParse[] {
    if ((!rankingRecords?.length && !healthRecords?.length) || parses.length <= 1) {
        return parses;
    }

    const rankingMap = new Map(
        (rankingRecords ?? []).map((record, index) => [
            normalizeParseUrl(record.parseUrl),
            {
                successCount: Number(record.successCount ?? 0),
                lastSuccessAt: Number(record.lastSuccessAt ?? 0),
                priorityIndex: index,
            },
        ]),
    );
    const healthMap = new Map(
        (healthRecords ?? []).map((record) => [
            normalizeParseUrl(record.parseUrl),
            record,
        ]),
    );
    const healthWeight = {
        healthy: 0,
        cooldown: 1,
        quarantined: 2,
    } as const;

    return parses
        .map((parse, index) => ({ parse, index }))
        .sort((left, right) => {
            const leftHealthRecord = healthMap.get(normalizeParseUrl(left.parse.url));
            const rightHealthRecord = healthMap.get(normalizeParseUrl(right.parse.url));
            const leftSnapshot = getVodParseHealthSnapshot(leftHealthRecord);
            const rightSnapshot = getVodParseHealthSnapshot(rightHealthRecord);
            const leftHealth = getVodParseHealthState(
                leftHealthRecord,
            );
            const rightHealth = getVodParseHealthState(
                rightHealthRecord,
            );
            if (healthWeight[leftHealth] !== healthWeight[rightHealth]) {
                return healthWeight[leftHealth] - healthWeight[rightHealth];
            }

            const leftRank = rankingMap.get(normalizeParseUrl(left.parse.url));
            const rightRank = rankingMap.get(normalizeParseUrl(right.parse.url));

            if (leftRank && !rightRank) return -1;
            if (rightRank && !leftRank) return 1;

            if (leftRank && rightRank) {
                if (rightRank.successCount !== leftRank.successCount) {
                    return rightRank.successCount - leftRank.successCount;
                }
                if (rightRank.lastSuccessAt !== leftRank.lastSuccessAt) {
                    return rightRank.lastSuccessAt - leftRank.lastSuccessAt;
                }
                if (leftRank.priorityIndex !== rightRank.priorityIndex) {
                    return leftRank.priorityIndex - rightRank.priorityIndex;
                }
            }

            if (rightSnapshot.stabilityScore !== leftSnapshot.stabilityScore) {
                return rightSnapshot.stabilityScore - leftSnapshot.stabilityScore;
            }

            const leftDuration = leftHealthRecord?.avgDurationMs ?? 0;
            const rightDuration = rightHealthRecord?.avgDurationMs ?? 0;
            if (leftDuration > 0 && rightDuration > 0 && leftDuration !== rightDuration) {
                return leftDuration - rightDuration;
            }

            const leftUsage = leftHealthRecord?.lastUsedAt ?? 0;
            const rightUsage = rightHealthRecord?.lastUsedAt ?? 0;
            if (rightUsage !== leftUsage) {
                return rightUsage - leftUsage;
            }

            return left.index - right.index;
        })
        .map((entry) => entry.parse);
}

export function selectVodParses(
    parses: TvBoxParse[],
    { jxIndex, routeName, pageUrl, rankingRecords, healthRecords }: VodParseSelectionOptions,
): VodParseSelectionResult {
    const supported = parses.filter(
        (parse) =>
            supportsVodParseType(parse) &&
            typeof parse.url === "string" &&
            parse.url.startsWith("http"),
    );
    const matched = supported.filter((parse) => matchesParseFlags(parse, routeName, pageUrl));
    return {
        ordered: reorderBySelectionSignals(
            reorderByJx(matched, jxIndex),
            rankingRecords,
            healthRecords,
        ),
        totalSupported: supported.length,
        filteredOutCount: supported.length - matched.length,
    };
}
