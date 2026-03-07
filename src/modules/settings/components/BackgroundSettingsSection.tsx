import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";

type BackgroundType = "none" | "image" | "video";

export function BackgroundSettingsSection({
  allowComponentDownload,
  bgOptimizeHint,
  bgOptimizeStage,
  bgType,
  bgBlur,
  imagePreviewSrc,
  videoPreviewSrc,
  onBackgroundBlurChange,
  onAllowComponentDownloadChange,
  onPrepareVideoOptimizer,
  onClearBackground,
  onApplyStoredBackground,
  onChooseBackground,
  onPreviewError,
}: {
  allowComponentDownload: boolean;
  bgOptimizeHint: string | null;
  bgOptimizeStage: string | null;
  bgType: BackgroundType;
  bgBlur: number;
  imagePreviewSrc: string | null;
  videoPreviewSrc: string | null;
  onBackgroundBlurChange: (blur: number) => void;
  onAllowComponentDownloadChange: (enabled: boolean) => void;
  onPrepareVideoOptimizer: () => void;
  onClearBackground: () => void;
  onApplyStoredBackground: (type: "image" | "video") => void;
  onChooseBackground: (type: "image" | "video") => void;
  onPreviewError: (type: "image" | "video") => void;
}) {
  return (
    <Card className="glass-card border-none p-6 relative overflow-hidden group">
      <div className="z-10 relative">
        <h2 className="text-lg font-bold text-foreground/90 tracking-tight">外观与个性化</h2>
        <p className="mt-1 text-[13px] text-muted-foreground/80 font-medium tracking-wide">自定义应用的全局背景图片或视频（视频仅支持 MP4）</p>
        {bgOptimizeHint && <p className="mt-2 text-[11px] font-mono text-primary/80 bg-primary/10 inline-block px-2 py-1 rounded-md">{bgOptimizeHint}</p>}

        <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-black/10 dark:bg-black/30 p-4 rounded-[16px] border border-white/5">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground/90">视频优化组件</span>
            <span className="text-xs text-muted-foreground/70 mt-0.5">允许后台下载 FFmpeg 以优化视频背景（需确认后下载）</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onPrepareVideoOptimizer}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-bold transition-all duration-300 shadow-sm border",
                allowComponentDownload && bgOptimizeStage !== "download_start"
                  ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90 hover:scale-105 active:scale-95"
                  : "bg-white/5 text-muted-foreground border-white/10 cursor-not-allowed"
              )}
              disabled={!allowComponentDownload || bgOptimizeStage === "download_start"}
            >
              {bgOptimizeStage === "download_start" ? "准备中..." : "准备组件"}
            </button>
            <Switch
              checked={allowComponentDownload}
              onCheckedChange={onAllowComponentDownloadChange}
            />
          </div>
        </div>

        <div className="mt-4 rounded-[16px] border border-white/8 bg-black/10 dark:bg-black/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-foreground/90">背景雾感强度</span>
            <span className="rounded-full bg-background/60 px-2.5 py-0.5 text-xs font-mono text-muted-foreground">
              {bgBlur.toFixed(1)}px
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground/75">调高后会增强图片/视频背景模糊，降低可获得更清晰背景。</p>
          <Slider
            min={0}
            max={36}
            step={0.5}
            value={[bgBlur]}
            onValueChange={([val]) => onBackgroundBlurChange(val)}
            className="mt-3 cursor-pointer"
            aria-label="背景模糊度"
          />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <button
            type="button"
            onClick={onClearBackground}
            className={cn(
              "group/card relative overflow-hidden rounded-[20px] border-2 text-left transition-all duration-500 hover:-translate-y-1 hover:shadow-xl",
              bgType === "none" ? "border-primary shadow-primary/20" : "border-white/5 shadow-black/10 hover:border-white/20"
            )}
          >
            <div className="flex aspect-video items-center justify-center bg-background border border-white/5 transition-transform duration-700 group-hover/card:scale-105">
              <span className="text-sm font-bold tracking-widest text-muted-foreground/50 group-hover/card:text-muted-foreground/80 transition-colors uppercase">默认主题</span>
            </div>
            <div className="absolute inset-0 bg-black/0 group-hover/card:bg-black/10 transition-colors duration-300" />
          </button>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onApplyStoredBackground("image")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                onApplyStoredBackground("image");
              }
            }}
            className={cn(
              "group/card relative overflow-hidden rounded-[20px] border-2 text-left transition-all duration-500 hover:-translate-y-1 hover:shadow-xl",
              bgType === "image" ? "border-primary shadow-primary/20" : "border-white/5 shadow-black/10 hover:border-white/20"
            )}
          >
            <div className="relative h-full">
              {imagePreviewSrc ? (
                <img
                  src={imagePreviewSrc}
                  className="aspect-video w-full object-cover transition-transform duration-700 group-hover/card:scale-105"
                  alt="已保存背景图片"
                  onError={() => onPreviewError("image")}
                />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-muted/50 transition-transform duration-700 group-hover/card:scale-105">
                  <span className="text-sm font-bold tracking-widest text-muted-foreground/50 transition-colors uppercase">没有图片</span>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-8 transform translate-y-1 sm:translate-y-8 group-hover/card:translate-y-0 transition-transform duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-bold text-white/90">
                  <span className="truncate drop-shadow-md">{imagePreviewSrc ? "图片背景" : "尚未选择"}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChooseBackground("image");
                    }}
                    className="rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[10px] transition-all hover:bg-primary hover:border-primary backdrop-blur-md shadow-sm"
                  >
                    更换
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onApplyStoredBackground("video")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                onApplyStoredBackground("video");
              }
            }}
            className={cn(
              "group/card relative overflow-hidden rounded-[20px] border-2 text-left transition-all duration-500 hover:-translate-y-1 hover:shadow-xl",
              bgType === "video" ? "border-primary shadow-primary/20" : "border-white/5 shadow-black/10 hover:border-white/20"
            )}
          >
            <div className="relative h-full">
              {videoPreviewSrc ? (
                <video
                  src={videoPreviewSrc}
                  className="aspect-video w-full object-cover transition-transform duration-700 group-hover/card:scale-105"
                  muted
                  autoPlay
                  loop
                  playsInline
                  preload="metadata"
                  onError={() => onPreviewError("video")}
                />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-muted/50 transition-transform duration-700 group-hover/card:scale-105">
                  <span className="text-sm font-bold tracking-widest text-muted-foreground/50 transition-colors uppercase">无视频</span>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-8 transform translate-y-1 sm:translate-y-8 group-hover/card:translate-y-0 transition-transform duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-bold text-white/90">
                  <span className="truncate drop-shadow-md">{videoPreviewSrc ? "动态视频" : "尚未选择"}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChooseBackground("video");
                    }}
                    className="rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[10px] transition-all hover:bg-primary hover:border-primary backdrop-blur-md shadow-sm"
                  >
                    更换
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

