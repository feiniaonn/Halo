export interface LiveLine {
    url: string;
    headers?: Record<string, string>;
}

export interface LiveChannel {
    name: string;
    urls: string[]; // Multiple URLs separated by '#' in the source
    lines?: LiveLine[]; // Detailed per-line info, including request headers
    logo?: string;
    tvgId?: string; // For EPG matching
}

export interface LiveGroup {
    groupName: string;
    channels: LiveChannel[];
}
