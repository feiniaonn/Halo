import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { cn } from "@/lib/utils";

interface VodProxyImageProps {
  src: string;
  alt: string;
  className?: string;
  emptyLabel?: string;
}

export function VodProxyImage({ src, alt, className, emptyLabel = "无图" }: VodProxyImageProps) {
  const [proxySrc, setProxySrc] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) return;
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      setProxySrc(src);
      setError(false);
      return;
    }

    invoke<string>("proxy_media", { url: src })
      .then((result) => {
        setProxySrc(result);
        setError(false);
      })
      .catch(() => {
        setError(true);
      });
  }, [src]);

  if (error || !src) {
    return <div className={cn("bg-white/10 flex items-center justify-center", className)}>{emptyLabel}</div>;
  }

  return (
    <img
      src={proxySrc || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"}
      alt={alt}
      className={cn(proxySrc ? "opacity-100" : "opacity-0", className, "transition-opacity duration-300 object-cover")}
      loading="lazy"
    />
  );
}
