export type MediaMode = "vod" | "live";

export type MediaNoticeKind = "success" | "warning" | "error";

export interface MediaNotice {
  kind: MediaNoticeKind;
  text: string;
}
