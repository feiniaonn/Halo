import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import {
  normalizeVodImageUrl,
  proxyVodImage,
  shouldPreferProxyImage,
} from "@/modules/media/services/vodImageProxy";

interface VodProxyImageProps {
  src: string;
  alt: string;
  className?: string;
  emptyLabel?: string;
}

interface ResolvedVodProxyImageProps extends Omit<VodProxyImageProps, "src"> {
  normalizedSrc: string;
}

function ResolvedVodProxyImage({
  normalizedSrc,
  alt,
  className,
  emptyLabel,
}: ResolvedVodProxyImageProps) {
  const prefersProxy = shouldPreferProxyImage(normalizedSrc);
  const [error, setError] = useState(false);
  const [displaySrc, setDisplaySrc] = useState(() => (prefersProxy ? "" : normalizedSrc));
  const [proxyAttempted, setProxyAttempted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!normalizedSrc) {
      return () => {
        cancelled = true;
      };
    }

    if (!prefersProxy) {
      return () => {
        cancelled = true;
      };
    }
    void proxyVodImage(normalizedSrc).then((resolved) => {
      if (cancelled || !resolved) return;
      setDisplaySrc(resolved);
      setProxyAttempted(true);
      setError(false);
    });

    return () => {
      cancelled = true;
    };
  }, [normalizedSrc, prefersProxy]);

  const handleImageError = useCallback(() => {
    const normalized = normalizedSrc;
    if (!normalized) {
      setError(true);
      return;
    }

    if (proxyAttempted || displaySrc.startsWith("data:")) {
      setError(true);
      return;
    }

    setProxyAttempted(true);
    void proxyVodImage(normalized).then((resolved) => {
      if (!resolved) {
        setError(true);
        return;
      }
      setDisplaySrc(resolved);
      setError(false);
    });
  }, [displaySrc, normalizedSrc, proxyAttempted]);

  if (error || !displaySrc) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-white/10 text-xs text-muted-foreground/50",
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <img
      src={displaySrc}
      alt={alt}
      onError={handleImageError}
      className={cn("object-cover", className)}
      loading="lazy"
    />
  );
}

export function VodProxyImage({
  src,
  alt,
  className,
  emptyLabel = "无图",
}: VodProxyImageProps) {
  const normalizedSrc = normalizeVodImageUrl(src);

  return (
    <ResolvedVodProxyImage
      key={normalizedSrc || "__empty__"}
      normalizedSrc={normalizedSrc}
      alt={alt}
      className={className}
      emptyLabel={emptyLabel}
    />
  );
}
