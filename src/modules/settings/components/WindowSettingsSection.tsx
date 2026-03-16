import { AppWindow, MonitorSmartphone, Power, Maximize } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { CloseBehavior, MiniRestoreMode } from '@/modules/settings/types/settings.types';

export function WindowSettingsSection({
  launchAtLogin,
  closeBehavior,
  miniRestoreMode,
  miniModeWidth,
  miniModeHeight,
  onLaunchAtLoginChange,
  onCloseBehaviorChange,
  onMiniRestoreModeChange,
  onMiniModeSizeChange,
}: {
  launchAtLogin: boolean;
  closeBehavior: CloseBehavior;
  miniRestoreMode: MiniRestoreMode;
  miniModeWidth: number;
  miniModeHeight: number;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onCloseBehaviorChange: (behavior: CloseBehavior) => void;
  onMiniRestoreModeChange: (mode: MiniRestoreMode) => void;
  onMiniModeSizeChange: (width: number, height: number) => void;
}) {
  const closeOptions: Array<{
    id: CloseBehavior;
    label: string;
    description: string;
  }> = [
    { id: 'exit', label: '退出程序', description: '关闭直接退出 Halo' },
    { id: 'tray', label: '最小化到托盘', description: '保留后台运行能力' },
    { id: 'tray_mini', label: '托盘与迷你模式', description: '进入迷你模式驻留' },
  ];

  const restoreOptions: Array<{
    id: MiniRestoreMode;
    label: string;
    description: string;
  }> = [
    { id: 'button', label: '仅按钮', description: '通过点击按钮恢复' },
    { id: 'double_click', label: '仅双击', description: '双击窗口空白处恢复' },
    { id: 'both', label: '双击或按钮', description: '同时支持按钮与双击' },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-12 pt-4">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">窗口与常驻行为</h2>
          <p className="text-sm text-muted-foreground mt-1">
            统一控制自启动、关闭逻辑和迷你窗口恢复方式。
          </p>
        </div>
      </section>

      {/* 启动与常驻 */}
      <section className="space-y-1">
        <div className="flex items-center justify-between py-4">
          <div className="space-y-1 flex-1 pr-8">
            <div className="flex items-center gap-2">
              <Power className="size-4 text-primary" />
              <h3 className="text-sm font-medium leading-none">开机自动启动</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              系统登录后 Halo 自动在后台启动，适合需要常驻托盘的使用方式。
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <Switch
              checked={launchAtLogin}
              onCheckedChange={onLaunchAtLoginChange}
            />
          </div>
        </div>
        
        <Separator />

        {/* 关闭行为 */}
        <div className="flex flex-col gap-4 py-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <AppWindow className="size-4 text-primary" />
              <h3 className="text-sm font-medium leading-none">关闭主窗口行为</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              配置点击主窗口关闭按钮 (×) 时的默认动作。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {closeOptions.map((option) => (
              <div
                key={option.id}
                onClick={() => onCloseBehaviorChange(option.id)}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-xl border p-4 shadow-sm transition-all hover:bg-accent",
                  closeBehavior === option.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border/60 bg-card"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{option.label}</span>
                  {closeBehavior === option.id && (
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* 迷你模式 */}
        <div className="flex flex-col gap-4 py-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="size-4 text-primary" />
              <h3 className="text-sm font-medium leading-none">迷你窗口恢复方式</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              配置从迷你模式（桌面歌词/悬浮播放器）恢复到主界面的交互手势。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {restoreOptions.map((option) => (
              <div
                key={option.id}
                onClick={() => onMiniRestoreModeChange(option.id)}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-xl border p-4 shadow-sm transition-all hover:bg-accent",
                  miniRestoreMode === option.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border/60 bg-card"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{option.label}</span>
                  {miniRestoreMode === option.id && (
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* 迷你模式尺寸设置 */}
        <div className="flex flex-col gap-4 py-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Maximize className="size-4 text-primary" />
              <h3 className="text-sm font-medium leading-none">迷你窗口尺寸</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              自定义迷你窗口（灵动岛）的宽度和高度。
            </p>
          </div>
          <div className="space-y-6 pt-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">宽度 ({miniModeWidth}px)</span>
                <span className="text-xs text-muted-foreground">400px - 1000px</span>
              </div>
              <Slider
                value={[miniModeWidth]}
                min={400}
                max={1000}
                step={10}
                onValueChange={(vals) => onMiniModeSizeChange(vals[0] ?? 700, miniModeHeight)}
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">高度 ({miniModeHeight}px)</span>
                <span className="text-xs text-muted-foreground">20px - 50px</span>
              </div>
              <Slider
                value={[miniModeHeight]}
                min={20}
                max={50}
                step={2}
                onValueChange={(vals) => onMiniModeSizeChange(miniModeWidth, vals[0] ?? 50)}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
