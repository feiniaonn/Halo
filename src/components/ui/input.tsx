import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "halo-focusable h-10 w-full min-w-0 rounded-[calc(var(--radius-xl)-4px)] border border-border/50 bg-background/50 px-3.5 py-2 text-base shadow-sm backdrop-blur-xl transition-[transform,box-shadow,border-color,background-color] duration-200 outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:border-white/10 dark:bg-white/5",
        "hover:border-border/80 hover:bg-background/70 dark:hover:bg-white/10 focus-visible:border-primary/50 focus-visible:bg-background focus-visible:ring-[2px] focus-visible:ring-primary/20 dark:focus-visible:bg-white/10",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
