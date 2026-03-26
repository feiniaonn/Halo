/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "halo-interactive halo-focusable inline-flex shrink-0 items-center justify-center gap-2 rounded-[calc(var(--radius-xl)-2px)] border text-sm font-semibold whitespace-nowrap outline-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary/24 bg-[linear-gradient(135deg,rgba(82,214,236,0.92),rgba(35,159,190,0.86))] text-primary-foreground shadow-[var(--halo-shadow-glow)] hover:brightness-[1.06]",
        destructive:
          "border-destructive/28 bg-[linear-gradient(135deg,rgba(239,86,106,0.92),rgba(194,50,77,0.88))] text-white shadow-[0_18px_38px_-24px_rgba(239,86,106,0.52)] hover:brightness-105 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border-border/60 bg-background/50 text-foreground/90 shadow-sm backdrop-blur-md hover:border-border hover:bg-background/80 hover:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10",
        secondary:
          "border-border/50 bg-secondary/60 text-secondary-foreground shadow-sm backdrop-blur-md hover:border-border/80 hover:bg-secondary/80 dark:border-white/10 dark:bg-white/10 dark:hover:bg-white/20",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-white/[0.05] hover:text-foreground dark:hover:bg-white/10",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        xs: "h-7 gap-1 rounded-[calc(var(--radius-md)-2px)] px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-[calc(var(--radius-lg)-4px)] px-3.5 has-[>svg]:px-3",
        lg: "h-11 rounded-[calc(var(--radius-xl)+2px)] px-6 has-[>svg]:px-4",
        icon: "size-10 rounded-[calc(var(--radius-xl)-2px)]",
        "icon-xs": "size-7 rounded-[calc(var(--radius-md)-2px)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-[calc(var(--radius-lg)-2px)]",
        "icon-lg": "size-11 rounded-[calc(var(--radius-xl)+2px)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
