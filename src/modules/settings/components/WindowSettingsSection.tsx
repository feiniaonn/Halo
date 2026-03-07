import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import type { CloseBehavior, MiniRestoreMode } from "@/modules/settings/types/settings.types";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export function WindowSettingsSection({
  launchAtLogin,
  closeBehavior,
  miniRestoreMode,
  onLaunchAtLoginChange,
  onCloseBehaviorChange,
  onMiniRestoreModeChange,
}: {
  launchAtLogin: boolean;
  closeBehavior: CloseBehavior;
  miniRestoreMode: MiniRestoreMode;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onCloseBehaviorChange: (behavior: CloseBehavior) => void;
  onMiniRestoreModeChange: (mode: MiniRestoreMode) => void;
}) {
  const closeOptions = [
    { id: "exit", label: "退出程序" },
    { id: "tray", label: "最小化到托盘" },
    { id: "tray_mini", label: "托盘与迷你模式" },
  ] as const;

  const restoreOptions = [
    { id: "button", label: "仅按钮" },
    { id: "double_click", label: "仅双击" },
    { id: "both", label: "双击或按钮" },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <Card className="glass-card border-none p-6 relative overflow-hidden group">
        <div className="flex items-center justify-between z-10 relative">
          <div>
            <h2 className="text-lg font-bold text-foreground/90 tracking-tight">开机自启</h2>
            <p className="mt-1 text-[13px] text-muted-foreground/80 font-medium tracking-wide">系统登录后自动在后台启动 Halo 服务</p>
          </div>
          <Switch
            checked={launchAtLogin}
            onCheckedChange={onLaunchAtLoginChange}
          />
        </div>
      </Card>

      <Card className="glass-card border-none p-6 relative overflow-hidden group">
        <div className="z-10 relative">
          <h2 className="text-lg font-bold text-foreground/90 tracking-tight">关闭窗口行为</h2>
          <p className="mt-1 text-[13px] text-muted-foreground/80 font-medium tracking-wide">当主界面的关闭按钮被点击时，应用的表现</p>

          <div className="mt-6 flex bg-black/10 dark:bg-black/30 p-1.5 rounded-[16px] shadow-inner gap-1 relative z-20 overflow-x-auto no-scrollbar mask-linear-x">
            {closeOptions.map((opt) => {
              const isActive = closeBehavior === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => onCloseBehaviorChange(opt.id as CloseBehavior)}
                  className={cn(
                    "relative flex-1 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-[12px] transition-all duration-300 z-10 whitespace-nowrap outline-none",
                    isActive ? "text-primary-foreground shadow-sm" : "text-muted-foreground/70 hover:text-foreground hover:bg-white/5"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="closeBehaviorIndicator"
                      className="absolute inset-0 bg-primary/90 rounded-[12px] shadow-md border border-white/20"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      style={{ zIndex: -1 }}
                    />
                  )}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="glass-card border-none p-6 relative overflow-hidden group">
        <div className="z-10 relative">
          <h2 className="text-lg font-bold text-foreground/90 tracking-tight">迷你窗口恢复方式</h2>
          <p className="mt-1 text-[13px] text-muted-foreground/80 font-medium tracking-wide">控制迷你播放器如何恢复为完整主界面</p>

          <div className="mt-6 flex bg-black/10 dark:bg-black/30 p-1.5 rounded-[16px] shadow-inner gap-1 relative z-20 overflow-x-auto no-scrollbar mask-linear-x">
            {restoreOptions.map((opt) => {
              const isActive = miniRestoreMode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => onMiniRestoreModeChange(opt.id as MiniRestoreMode)}
                  className={cn(
                    "relative flex-1 px-4 py-2.5 text-xs sm:text-sm font-bold rounded-[12px] transition-all duration-300 z-10 whitespace-nowrap outline-none",
                    isActive ? "text-primary-foreground shadow-sm" : "text-muted-foreground/70 hover:text-foreground hover:bg-white/5"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="miniRestoreIndicator"
                      className="absolute inset-0 bg-primary/90 rounded-[12px] shadow-md border border-white/20"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      style={{ zIndex: -1 }}
                    />
                  )}
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}

