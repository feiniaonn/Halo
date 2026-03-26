import { AppWindow, Power, Minimize2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { CloseBehavior } from '@/modules/settings/types/settings.types';

export function WindowSettingsSection({
  launchAtLogin,
  closeBehavior,
  onLaunchAtLoginChange,
  onCloseBehaviorChange,
}: {
  launchAtLogin: boolean;
  closeBehavior: CloseBehavior;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onCloseBehaviorChange: (behavior: CloseBehavior) => void;
}) {
  const closeOptions: Array<{
    id: CloseBehavior;
    label: string;
    description: string;
    icon: typeof AppWindow;
  }> = [
    { id: 'exit', label: '退出程序', description: '关闭直接退出 Halo', icon: Power },
    { id: 'tray', label: '最小化到托盘', description: '保留后台运行能力', icon: Minimize2 },
    { id: 'tray_mini', label: '托盘与迷你模式', description: '进入迷你模式驻留', icon: AppWindow },
  ];
  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-12 pt-4">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">基础行为</h2>
          <p className="text-sm text-muted-foreground mt-1">
            设置应用的启动与关闭逻辑。
          </p>
        </div>
      </section>

      {/* 启动与常驻 */}
      <section className="space-y-1">
          <div className="flex items-center justify-between py-4">
            <div className="space-y-1 flex-1 pr-8">
              <h3 className="text-sm font-medium leading-none text-foreground">开机自启动</h3>
              <p className="text-sm text-muted-foreground mt-1.5">
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
            <h3 className="text-sm font-medium leading-none text-foreground">关闭主窗口行为</h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              配置点击主窗口关闭按钮 (×) 时的默认动作。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {closeOptions.map((option) => (
              <div
                key={option.id}
                onClick={() => onCloseBehaviorChange(option.id)}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-xl border p-4 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-md hover:border-border/80",
                  closeBehavior === option.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "bg-card/40 backdrop-blur-xl hover:bg-card/80"
                )}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background shadow-sm border">
                    <option.icon className="size-5 text-muted-foreground" />
                  </div>
                  {closeBehavior === option.id && <span className="text-xs font-semibold text-primary">使用中</span>}
                </div>
                <h3 className="font-semibold text-sm text-foreground">{option.label}</h3>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        </section>
    </div>
  );
}







