import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CoverImage } from "@/modules/music/components/CoverImage";

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function StatusDot({ active, className }: { active: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.42)]",
        active ? "bg-emerald-400/85 animate-pulse" : "bg-white/24",
        className,
      )}
      aria-hidden
    />
  );
}

export function StatusChip({
  active,
  label,
  className,
}: {
  active: boolean;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.05] text-white/56",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      <StatusDot active={active} />
      <span className="truncate">{label}</span>
    </span>
  );
}

const PLAYBACK_BAR_PATTERNS = [
  [0.34, 0.92, 0.42],
  [0.52, 0.28, 0.78],
  [0.26, 0.68, 0.36],
  [0.62, 0.36, 0.84],
] as const;

export function PlaybackActivity({
  isPlaying,
  className,
}: {
  isPlaying: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end gap-[3px]", className)} aria-hidden>
      {PLAYBACK_BAR_PATTERNS.map((pattern, index) => (
        <motion.span
          key={index}
          className={cn(
            "block w-[3px] origin-bottom rounded-full",
            isPlaying ? "bg-white/82 shadow-[0_0_10px_rgba(56,189,248,0.18)]" : "bg-white/26",
          )}
          style={{ height: 15 }}
          animate={
            isPlaying
              ? {
                  scaleY: [...pattern],
                  opacity: [0.42, 1, 0.54],
                }
              : {
                  scaleY: 0.3 + index * 0.04,
                  opacity: 0.4,
                }
          }
          transition={
            isPlaying
              ? {
                  duration: 0.88 + index * 0.06,
                  ease: "easeInOut",
                  repeat: Infinity,
                  delay: index * 0.08,
                }
              : {
                  duration: 0.18,
                  ease: "easeOut",
                }
          }
        />
      ))}
    </div>
  );
}

export function PlaybackOrb({
  size,
  progress,
  isPlaying,
  coverPath,
  coverDataUrl,
}: {
  size: number;
  progress: number;
  isPlaying: boolean;
  coverPath: string | null;
  coverDataUrl: string | null;
}) {
  const shellSize = size + 10;
  const normalizedProgress = clampProgress(progress);

  return (
    <motion.div
      layout
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: shellSize, height: shellSize }}
    >
      <svg className="pointer-events-none absolute inset-0 size-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/6" />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeDasharray="263.89"
          strokeDashoffset={263.89 * (1 - normalizedProgress)}
          strokeLinecap="round"
          className={cn(
            "transition-[stroke-dashoffset] duration-300 ease-out",
            isPlaying ? "text-primary/78" : "text-white/28",
          )}
        />
      </svg>

      <div
        className={cn(
          "relative overflow-hidden rounded-full border border-white/10 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.88)]",
          isPlaying ? "animate-[spin_18s_linear_infinite]" : "scale-[0.985]",
        )}
        style={{ width: size, height: size, willChange: "transform" }}
      >
        <CoverImage
          coverPath={coverPath}
          dataUrl={coverDataUrl}
          size="md"
          className="h-full w-full rounded-full object-cover"
        />
      </div>
    </motion.div>
  );
}
