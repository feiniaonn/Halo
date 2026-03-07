import { cn } from "@/lib/utils";
import { useCoverDataUrl } from "../hooks/useCoverDataUrl";

export function OptionalCoverImage({
  coverPath,
  dataUrl,
  className,
  alt = "",
}: {
  coverPath: string | null;
  dataUrl?: string | null;
  className?: string;
  alt?: string;
}) {
  const resolvedDataUrl = useCoverDataUrl(dataUrl ? null : coverPath);
  const src = dataUrl ?? resolvedDataUrl;

  if (!src) {
    return null;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn("shrink-0 bg-muted object-contain", className)}
    />
  );
}
