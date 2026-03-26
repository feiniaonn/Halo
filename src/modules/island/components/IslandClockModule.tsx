import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { IslandModuleDefinition } from "@/modules/island/types";

export const clockIslandModule: IslandModuleDefinition = {
  id: "clock",
  priority: 0,
  isActive: () => true,
  canExpand: () => false,
  renderCapsule: (context) => (
    <motion.div layout className="flex h-full w-full items-center justify-center px-6">
      <span
        className={cn(
          "truncate font-semibold tracking-[0.34em] text-white/74 tabular-nums",
          context.frame.density === "tight" ? "text-[12px]" : "text-[13px]",
        )}
      >
        {context.clock.timeLabel}
      </span>
    </motion.div>
  ),
};
