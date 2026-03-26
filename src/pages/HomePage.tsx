import { motion, type Variants } from "framer-motion";
import { Gauge, Settings2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatUptime } from "@/lib/formatters";
import { useSystemOverview } from "@/modules/dashboard"; // Used just for uptime/OS String

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.18, ease: "easeOut" },
  },
};

export function HomePage() {
  const { systemOverview } = useSystemOverview();

  const osLabel =
    [systemOverview?.osName, systemOverview?.osVersion].filter(Boolean).join(" ") || "未知系统";

  return (
    <div className="relative mx-auto flex w-full max-w-[1320px] flex-col gap-5 pt-1 pb-8">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-5"
      >
        <motion.section variants={itemVariants}>
          <Card className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-background/20 backdrop-blur-3xl px-8 py-8 shadow-sm">
            <div className="relative flex h-full flex-col justify-between gap-8">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80">
                  <span className="size-1.5 rounded-full bg-primary/80" />
                  Command Deck
                </div>
                <div className="max-w-3xl space-y-3">
                  <h1 className="max-w-3xl text-[32px] font-bold leading-tight tracking-tight text-foreground sm:text-[40px]">
                    Halo 桌面工作台
                  </h1>
                  <p className="max-w-2xl text-[14px] leading-6 text-muted-foreground sm:text-[15px]">
                    一个面向媒体调度、播放控制与桌面管理的统一界面。保持信息密度、动效与视觉语言一致，让你切换模块时不会再像换到另一套应用。
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/30 backdrop-blur-md px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-background/50 text-primary/80 backdrop-blur-sm">
                    <Sparkles className="size-4" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Mood</div>
                    <div className="text-[13px] font-semibold text-foreground/80">明亮控制台</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/30 backdrop-blur-md px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-background/50 text-amber-500/80 backdrop-blur-sm">
                    <Gauge className="size-4" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Runtime</div>
                    <div className="text-[13px] font-semibold text-foreground/80">
                      {systemOverview ? formatUptime(systemOverview.uptimeSecs) : "--"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/30 backdrop-blur-md px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-background/50 text-emerald-500/80 backdrop-blur-sm">
                    <Settings2 className="size-4" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">System</div>
                    <div className="truncate text-[13px] font-semibold text-foreground/80">{osLabel}</div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </motion.section>
      </motion.div>
    </div>
  );
}
