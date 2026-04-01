import { Code2, ShieldCheck } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export function DeveloperSettingsSection({
  developerMode,
  onDeveloperModeChange,
}: {
  developerMode: boolean;
  onDeveloperModeChange: (enabled: boolean) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-12 pt-4">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">开发者功能</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            开启后会在侧边栏新增 AI 管理模块，用于配置服务地址、密钥、模型和连通性测试。
          </p>
        </div>
      </section>

      <section className="space-y-1">
        <div className="flex items-center justify-between py-4">
          <div className="flex flex-1 items-start gap-4 pr-8">
            <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-background/40 text-primary/80 shadow-sm">
              <Code2 className="size-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-medium leading-none text-foreground">启用开发者模式</h3>
              <p className="text-sm text-muted-foreground">
                打开后会解锁侧边栏中的“AI 管理”，用于管理本地 AI 接入配置和接口测试。
              </p>
            </div>
          </div>
          <Switch checked={developerMode} onCheckedChange={onDeveloperModeChange} />
        </div>

        <Separator />

        <div className="rounded-2xl border border-border/50 bg-card/40 p-4 backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="size-4" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">本地安全说明</div>
              <p className="text-sm leading-6 text-muted-foreground">
                API Key 和额外请求头不会写入前端本地存储。AI 管理页改走桌面端 Rust
                后端，并将敏感字段加密保存到本地数据库。
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
