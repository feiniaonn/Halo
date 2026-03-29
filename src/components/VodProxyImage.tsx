import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import {
  buildVodImageProxyCandidates,
  buildVodImageRenderCandidates,
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
  const renderCandidates = useMemo(
    () => buildVodImageRenderCandidates(normalizedSrc),
    [normalizedSrc],
  );
  const proxyCandidates = useMemo(
    () => buildVodImageProxyCandidates(normalizedSrc),
    [normalizedSrc],
  );
  const [error, setError] = useState(false);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [displaySrc, setDisplaySrc] = useState(() => renderCandidates[0] ?? "");
  const [proxySettled, setProxySettled] = useState(false);
  const shouldWaitForProxy = prefersProxy && !proxySettled;

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

    void (async () => {
      for (const candidate of proxyCandidates) {
        const resolved = await proxyVodImage(candidate);
        if (cancelled) return;
        if (!resolved || resolved === candidate) {
          continue;
        }
        setDisplaySrc(resolved);
        setError(false);
        setProxySettled(true);
        return;
      }

      if (!cancelled) {
        setProxySettled(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [normalizedSrc, prefersProxy, proxyCandidates]);

  const handleImageError = useCallback(() => {
    if (!renderCandidates.length) {
      if (!shouldWaitForProxy) {
        setError(true);
      }
      return;
    }

    if (displaySrc.startsWith("data:")) {
      if (!shouldWaitForProxy) {
        setError(true);
      }
      return;
    }

    const nextIndex = candidateIndex + 1;
    if (nextIndex < renderCandidates.length) {
      setCandidateIndex(nextIndex);
      setDisplaySrc(renderCandidates[nextIndex] ?? "");
      setError(false);
      return;
    }

    if (!shouldWaitForProxy) {
      setError(true);
    }
  }, [candidateIndex, displaySrc, renderCandidates, shouldWaitForProxy]);

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
