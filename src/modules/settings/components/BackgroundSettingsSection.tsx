import { ImageIcon, Sparkles, Video } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type BackgroundType = 'none' | 'image' | 'video';

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
  onApplyStoredBackground: (type: 'image' | 'video') => void;
  onChooseBackground: (type: 'image' | 'video') => void;
  onPreviewError: (type: 'image' | 'video') => void;
}) {
  const activePreviewType = bgType === 'image' || bgType === 'video' ? bgType : 'none';

  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-12 pt-4">
      {/* 实时预览区 */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">实时背景预览</h2>
          <p className="text-sm text-muted-foreground mt-1">
            当前应用界面的背景效果预览。
          </p>
        </div>
        <div className="relative mx-auto aspect-video w-full max-w-[480px] overflow-hidden rounded-xl border shadow-sm bg-black/5">
          {activePreviewType === 'image' && imagePreviewSrc ? (
            <img
              src={imagePreviewSrc}
              alt="当前背景图预览"
              className="h-full w-full object-cover"
              onError={() => onPreviewError('image')}
            />
          ) : activePreviewType === 'video' && videoPreviewSrc ? (
            <video
              src={videoPreviewSrc}
              className="h-full w-full object-cover"
              muted
              autoPlay
              loop
              playsInline
              preload="metadata"
              onError={() => onPreviewError('video')}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-900">
              <span className="text-sm font-medium text-muted-foreground">默认主题背景</span>
            </div>
          )}
          
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-white/20 bg-black/40 px-2 py-1 text-xs font-semibold text-white backdrop-blur-md">
                {bgType === 'image' ? '图片背景' : bgType === 'video' ? '视频背景' : '默认主题'}
              </span>
              <span className="rounded-md border border-white/20 bg-black/40 px-2 py-1 text-xs font-semibold text-white backdrop-blur-md">
                模糊 {bgBlur.toFixed(1)}px
              </span>
            </div>
          </div>
        </div>
      </section>

      <Separator />

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
              "relative flex cursor-pointer flex-col gap-4 rounded-xl border p-4 shadow-sm transition-all hover:bg-accent hover:text-accent-foreground",
              bgType === 'none' && "border-primary bg-primary/5 ring-1 ring-primary"
            )}
            onClick={onClearBackground}
          >
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background shadow-sm border">
                <Sparkles className="size-5 text-muted-foreground" />
              </div>
              {bgType === 'none' && <span className="text-xs font-semibold text-primary">使用中</span>}
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-sm">默认主题</h3>
              <p className="text-xs text-muted-foreground">纯净无背景，跟随系统深色/浅色模式。</p>
            </div>
          </div>

          {/* 图片 */}
          <div
            className={cn(
              "relative flex flex-col gap-4 rounded-xl border p-4 shadow-sm transition-all",
              bgType === 'image' ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background shadow-sm border">
                <ImageIcon className="size-5 text-muted-foreground" />
              </div>
              {bgType === 'image' && <span className="text-xs font-semibold text-primary">使用中</span>}
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-sm">图片背景</h3>
              <p className="text-xs text-muted-foreground mb-3">使用本地图片作为静态壁纸。</p>
            </div>
            <div className="mt-auto flex items-center gap-2 pt-2">
              <Button size="sm" variant={bgType === 'image' ? "secondary" : "default"} className="flex-1 h-8 text-xs" onClick={() => onApplyStoredBackground('image')}>
                应用
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => onChooseBackground('image')}>
                更换
              </Button>
            </div>
          </div>

          {/* 视频 */}
          <div
            className={cn(
              "relative flex flex-col gap-4 rounded-xl border p-4 shadow-sm transition-all",
              bgType === 'video' ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background shadow-sm border">
                <Video className="size-5 text-muted-foreground" />
              </div>
              {bgType === 'video' && <span className="text-xs font-semibold text-primary">使用中</span>}
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-sm">视频背景</h3>
              <p className="text-xs text-muted-foreground mb-3">使用本地 MP4 视频作为动态壁纸。</p>
            </div>
            <div className="mt-auto flex items-center gap-2 pt-2">
              <Button size="sm" variant={bgType === 'video' ? "secondary" : "default"} className="flex-1 h-8 text-xs" onClick={() => onApplyStoredBackground('video')}>
                应用
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => onChooseBackground('video')}>
                更换
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
            <h3 className="text-sm font-medium leading-none">背景雾感强度</h3>
            <p className="text-sm text-muted-foreground">
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

        <Separator />

        {/* 视频优化组件开关 */}
        <div className="flex items-center justify-between py-4">
          <div className="space-y-1 flex-1 pr-8">
            <h3 className="text-sm font-medium leading-none">视频优化组件支持</h3>
            <p className="text-sm text-muted-foreground">
              开启后，系统将准备 FFmpeg 组件用于将动态视频处理为更低功耗、更流畅的格式。
            </p>
            {bgOptimizeHint && (
              <p className="text-xs text-primary mt-2 font-medium">
                状态: {bgOptimizeHint}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <Button 
              size="sm" 
              variant="secondary" 
              disabled={!allowComponentDownload || bgOptimizeStage === 'download_start'}
              onClick={onPrepareVideoOptimizer}
            >
              {bgOptimizeStage === 'download_start' ? '准备中...' : '准备环境'}
            </Button>
            <Switch
              checked={allowComponentDownload}
              onCheckedChange={onAllowComponentDownloadChange}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
