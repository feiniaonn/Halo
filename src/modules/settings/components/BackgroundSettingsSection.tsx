import { ImageIcon, Sparkles, Video } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type BackgroundType = 'none' | 'image' | 'video';

export function BackgroundSettingsSection({
  bgType,
  bgBlur,
  imagePreviewSrc,
  videoPreviewSrc,
  onBackgroundBlurChange,
  onClearBackground,
  onApplyStoredBackground,
  onChooseBackground,
  onPreviewError,
}: {
  bgType: BackgroundType;
  bgBlur: number;
  imagePreviewSrc: string | null;
  videoPreviewSrc: string | null;
  onBackgroundBlurChange: (blur: number) => void;
  onClearBackground: () => void;
  onApplyStoredBackground: (type: 'image' | 'video') => void;
  onChooseBackground: (type: 'image' | 'video') => void;
  onPreviewError: (type: 'image' | 'video') => void;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-12 pt-4">
      {/* 背景模式选择 */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">选择背景模式</h2>
          <p className="text-sm text-muted-foreground mt-1">
            设置应用的主体背景环境，支持本地图片与视频。
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* 默认 */}
          <div
            className={cn(
              "relative flex cursor-pointer flex-col gap-4 rounded-xl border p-4 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-md hover:border-border/80 overflow-hidden",
              bgType === 'none' ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card/40 backdrop-blur-xl hover:bg-card/80"
            )}
            onClick={onClearBackground}
          >
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/80 shadow-sm border backdrop-blur-sm">
                <Sparkles className="size-5 text-muted-foreground" />
              </div>
              {bgType === 'none' && <span className="text-xs font-semibold text-primary">使用中</span>}
            </div>
            <div className="relative z-10 space-y-1">
              <h3 className="font-semibold text-sm text-foreground">默认主题</h3>
              <p className="text-xs text-muted-foreground">纯净无背景，跟随系统深色/浅色模式。</p>
            </div>
          </div>

          {/* 图片 */}
          <div
            className={cn(
              "relative flex cursor-pointer flex-col gap-4 rounded-xl border p-4 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-md hover:border-border/80 overflow-hidden group",
              bgType === 'image' ? "border-primary ring-1 ring-primary" : "bg-card/40 backdrop-blur-xl hover:bg-card/80"
            )}
            onClick={() => onApplyStoredBackground('image')}
          >
            {imagePreviewSrc && (
              <div className="absolute inset-0 z-0 opacity-20 transition-opacity duration-300 group-hover:opacity-30">
                <img src={imagePreviewSrc} className="h-full w-full object-cover" onError={() => onPreviewError('image')} />
                <div className="absolute inset-0 bg-background/50" />
              </div>
            )}
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/80 shadow-sm border backdrop-blur-sm">
                <ImageIcon className="size-5 text-muted-foreground" />
              </div>
              {bgType === 'image' && <span className="text-xs font-semibold text-primary">使用中</span>}
            </div>
            <div className="relative z-10 space-y-1">
              <h3 className="font-semibold text-sm text-foreground">图片背景</h3>
              <p className="text-xs text-muted-foreground mb-3">使用本地图片作为静态壁纸。</p>
            </div>
            <div className="relative z-10 mt-auto flex items-center justify-end pt-2">
              <Button size="sm" variant="outline" className="h-7 text-[11px] px-3 bg-black/40 hover:bg-black/60 text-white border-white/20 backdrop-blur-md transition-all shadow-sm" onClick={(e) => { e.stopPropagation(); onChooseBackground('image'); }}>
                更换图片
              </Button>
            </div>
          </div>

          {/* 视频 */}
          <div
            className={cn(
              "relative flex cursor-pointer flex-col gap-4 rounded-xl border p-4 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-md hover:border-border/80 overflow-hidden group",
              bgType === 'video' ? "border-primary ring-1 ring-primary" : "bg-card/40 backdrop-blur-xl hover:bg-card/80"
            )}
            onClick={() => onApplyStoredBackground('video')}
          >
            {videoPreviewSrc && (
              <div className="absolute inset-0 z-0 opacity-20 transition-opacity duration-300 group-hover:opacity-30">
                <video src={videoPreviewSrc} className="h-full w-full object-cover" muted autoPlay loop playsInline preload="metadata" onError={() => onPreviewError('video')} />
                <div className="absolute inset-0 bg-background/50" />
              </div>
            )}
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/80 shadow-sm border backdrop-blur-sm">
                <Video className="size-5 text-muted-foreground" />
              </div>
              {bgType === 'video' && <span className="text-xs font-semibold text-primary">使用中</span>}
            </div>
            <div className="relative z-10 space-y-1">
              <h3 className="font-semibold text-sm text-foreground">视频背景</h3>
              <p className="text-xs text-muted-foreground mb-3">使用本地 MP4 视频作为动态壁纸。</p>
            </div>
            <div className="relative z-10 mt-auto flex items-center justify-end pt-2">
              <Button size="sm" variant="outline" className="h-7 text-[11px] px-3 bg-black/40 hover:bg-black/60 text-white border-white/20 backdrop-blur-md transition-all shadow-sm" onClick={(e) => { e.stopPropagation(); onChooseBackground('video'); }}>
                更换视频
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* 视觉与优化 */}
      <section className="space-y-1">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground mb-4">视觉与优化</h2>
        </div>

        {/* 雾感强度 */}
        <div className="flex items-center justify-between py-4">
          <div className="space-y-1 flex-1 pr-8">
            <h3 className="text-sm font-medium leading-none text-foreground">背景雾感强度</h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              调整背景的高斯模糊效果。数值越高，界面元素辨识度越高。
            </p>
          </div>
          <div className="flex w-[200px] shrink-0 items-center gap-4">
            <Slider
              min={0}
              max={36}
              step={0.5}
              value={[bgBlur]}
              onValueChange={([value]) => onBackgroundBlurChange(value)}
              className="flex-1"
            />
            <span className="w-12 text-right text-sm font-semibold tabular-nums text-muted-foreground">
              {bgBlur.toFixed(1)}
            </span>
          </div>
        </div>

        </section>
    </div>
  );
}



