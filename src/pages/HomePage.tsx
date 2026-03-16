import { motion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";
import { clampPercent, formatUptime } from "@/lib/formatters";

import { useSystemOverview } from "@/modules/dashboard";
import { Card } from "@/components/ui/card";



const defaultLinks = [
  { id: "media", title: "媒体库", desc: "点播与直播模块", href: "#" },
  { id: "music", title: "音乐", desc: "本地播放与听歌历史", href: "#" },
] as const;

type Page = "dashboard" | "media" | "music" | "settings";



const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 350,
      damping: 25,
    },
  },
};

export function HomePage({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const { systemOverview, systemLoading, systemError } = useSystemOverview();

  const cpuPercent = clampPercent(systemOverview?.cpuUsage ?? 0);
  const memoryPercent = clampPercent(
    systemOverview && systemOverview.memoryTotalBytes > 0
      ? (systemOverview.memoryUsedBytes / systemOverview.memoryTotalBytes) * 100
      : 0,
  );
  const diskPercent = clampPercent(
    systemOverview && systemOverview.diskTotalBytes > 0
      ? (systemOverview.diskUsedBytes / systemOverview.diskTotalBytes) * 100
      : 0,
  );
  const gpuPercent = systemOverview?.gpuUsage == null ? null : clampPercent(systemOverview.gpuUsage);
  const appCpuPercent =
    systemOverview?.appCpuUsage == null ? null : clampPercent(systemOverview.appCpuUsage);
  const appMemoryPercent =
    systemOverview &&
    systemOverview.memoryTotalBytes > 0 &&
    systemOverview.appMemoryUsedBytes != null
      ? clampPercent((systemOverview.appMemoryUsedBytes / systemOverview.memoryTotalBytes) * 100)
      : null;
  const appGpuPercent =
    systemOverview?.appGpuUsage == null ? null : clampPercent(systemOverview.appGpuUsage);
  const osLabel = [systemOverview?.osName, systemOverview?.osVersion].filter(Boolean).join(" ") || "\u672a\u77e5\u7cfb\u7edf";


  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 pt-1 pb-10 relative">


      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="shrink-0 flex items-center justify-between px-1"
      >
        <div>
          <h1 className="text-[32px] sm:text-[40px] font-black tracking-tight bg-gradient-to-br from-foreground via-foreground/90 to-foreground/50 bg-clip-text text-transparent drop-shadow-sm">
            欢迎来到 Halo 仪表盘
          </h1>
          <p className="mt-2 text-[14px] font-medium tracking-wide text-muted-foreground/80 bg-muted/30 inline-block px-3 py-1 rounded-full border border-white/5 backdrop-blur-sm">
            在这里管理你的媒体库、听音乐，或调整各项系统设置
          </p>
        </div>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-5"
      >
        <motion.section variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {defaultLinks.map((item) => (
            <Card
              key={item.id}
              onClick={() => onNavigate?.(item.id as Page)}
              className={cn(
                "glass-card border-none flex min-h-[180px] flex-col gap-4 p-6 relative overflow-hidden group",
                "cursor-pointer transition-transform duration-400 hover:-translate-y-1 shadow-[0_8px_32px_rgba(0,0,0,0.05)] hover:shadow-lg",
              )}
            >
              <div className="relative z-10 flex flex-col h-full bg-transparent">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-110 transition-all duration-300 shadow-sm">
                    {item.id === "media" ? (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="7" width="20" height="15" rx="2" ry="2" /><polyline points="17 2 12 7 7 2" /></svg>
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                    )}
                  </div>
                </div>
                <div>
                  <h2 className="text-[19px] font-bold tracking-tight text-foreground/90 group-hover:text-primary transition-colors">{item.title}</h2>
                  <p className="mt-1.5 text-[14px] text-muted-foreground/80 font-medium tracking-wide">{item.desc}</p>
                </div>
                <div className="mt-auto flex items-center pt-2 overflow-hidden">
                  <span className="text-[13px] font-bold text-primary opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 flex items-center gap-1">
                    立即进入<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </motion.section>


        <motion.section variants={itemVariants}>
          <Card className="glass-card border-none rounded-3xl p-5 relative overflow-hidden flex flex-col gap-5">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

            <div className="flex items-center justify-between gap-2 px-1 relative z-10">
              <div className="flex items-center gap-2.5">
                <div className="flex bg-primary/10 p-2 rounded-xl text-primary">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
                    <polyline points="7.5 19.79 7.5 14.6 3 12" />
                    <polyline points="21 12 16.5 14.6 16.5 19.79" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                </div>
                <h2 className="text-[16px] font-semibold tracking-tight">{"\u7cfb\u7edf\u6982\u89c8"}</h2>
              </div>
              <div className="flex items-center gap-3">
                {systemOverview && (
                  <div className="text-[12px] font-medium text-muted-foreground hidden sm:flex items-center gap-2">
                    <span className="truncate max-w-[120px]">{systemOverview.hostName ?? "未知"}</span>
                    <span className="opacity-40">|</span>
                    <span className="text-foreground/80 font-bold">{formatUptime(systemOverview.uptimeSecs)}</span>
                  </div>
                )}
                <div className="text-[11px] font-medium text-muted-foreground bg-black/5 dark:bg-white/10 px-2 py-1 rounded-lg backdrop-blur-sm">
                  {!systemLoading && systemOverview ? osLabel : "--"}
                </div>
              </div>
            </div>

            {systemLoading && (
              <div className="h-16 w-full animate-pulse rounded-2xl bg-black/5 dark:bg-white/5 relative z-10" />
            )}

            {!systemLoading && systemError && !systemOverview && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-[13px] font-medium text-red-600 relative z-10">
                {systemError}
              </div>
            )}

            {systemOverview && (
              <div className="flex flex-col sm:flex-row gap-3 relative z-10">
                {/* 系统总资源 */}
                <div className="flex-1 grid grid-cols-4 gap-2 rounded-2xl bg-black/5 dark:bg-white/5 p-3">
                  <div className="flex flex-col justify-center items-center gap-1.5 p-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">CPU</span>
                    <span className="text-[15px] font-black text-blue-600 dark:text-blue-400">{cpuPercent.toFixed(0)}%</span>
                  </div>
                  <div className="flex flex-col justify-center items-center gap-1.5 p-1 border-l border-white/5 dark:border-black/5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">内存</span>
                    <span className="text-[15px] font-black text-violet-600 dark:text-violet-400">{memoryPercent.toFixed(0)}%</span>
                  </div>
                  <div className="flex flex-col justify-center items-center gap-1.5 p-1 border-l border-white/5 dark:border-black/5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">磁盘</span>
                    <span className="text-[15px] font-black text-emerald-600 dark:text-emerald-400">{diskPercent.toFixed(0)}%</span>
                  </div>
                  <div className="flex flex-col justify-center items-center gap-1.5 p-1 border-l border-white/5 dark:border-black/5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">GPU</span>
                    <span className="text-[15px] font-black text-amber-600 dark:text-amber-400">{gpuPercent == null ? "--" : `${gpuPercent.toFixed(0)}%`}</span>
                  </div>
                </div>

                {/* 应用本身资源占用 */}
                <div className="flex-1 grid grid-cols-3 gap-2 rounded-2xl bg-black/5 dark:bg-white/5 p-3">
                  <div className="flex flex-col justify-center items-center gap-1.5 p-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">应用 CPU</span>
                    <span className="text-[15px] font-black text-cyan-600 dark:text-cyan-400">{appCpuPercent == null ? "--" : `${appCpuPercent.toFixed(1)}%`}</span>
                  </div>
                  <div className="flex flex-col justify-center items-center gap-1.5 p-1 border-l border-white/5 dark:border-black/5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">应用 内存</span>
                    <span className="text-[15px] font-black text-fuchsia-600 dark:text-fuchsia-400">{appMemoryPercent == null ? "--" : `${appMemoryPercent.toFixed(1)}%`}</span>
                  </div>
                  <div className="flex flex-col justify-center items-center gap-1.5 p-1 border-l border-white/5 dark:border-black/5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">应用 GPU</span>
                    <span className="text-[15px] font-black text-orange-600 dark:text-orange-400">{appGpuPercent == null ? "--" : `${appGpuPercent.toFixed(1)}%`}</span>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </motion.section>
      </motion.div >
    </div >
  );
}
