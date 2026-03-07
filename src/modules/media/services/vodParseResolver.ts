import type { TvBoxParse } from "../types/vodWindow.types";

export interface VodParseSelectionOptions {
    jxIndex: number;
    routeName: string;
    pageUrl: string;
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

export function selectVodParses(
    parses: TvBoxParse[],
    { jxIndex, routeName, pageUrl }: VodParseSelectionOptions,
): VodParseSelectionResult {
    const supported = parses.filter(
        (parse) =>
            supportsVodParseType(parse) &&
            typeof parse.url === "string" &&
            parse.url.startsWith("http"),
    );
    const matched = supported.filter((parse) => matchesParseFlags(parse, routeName, pageUrl));
    return {
        ordered: reorderByJx(matched, jxIndex),
        totalSupported: supported.length,
        filteredOutCount: supported.length - matched.length,
    };
}
