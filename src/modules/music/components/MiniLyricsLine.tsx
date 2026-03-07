import { cn } from "@/lib/utils";

export function MiniLyricsLine({
  text,
  className,
}: {
  text: string | null;
  className?: string;
}) {
  if (!text) {
    return null;
  }

  return (
    <p
      className={cn(
        "max-w-[210px] truncate text-[10px] leading-tight text-foreground/60 dark:text-foreground/70",
        className,
      )}
      title={text}
    >
      {text}
    </p>
  );
}
