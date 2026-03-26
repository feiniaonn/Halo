import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("halo-skeleton rounded-[calc(var(--radius-lg)-4px)]", className)}
      {...props}
    />
  )
}

export { Skeleton }
