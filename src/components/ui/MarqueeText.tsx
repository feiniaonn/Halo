import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function MarqueeText({
  children,
  className,
  containerClassName,
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const checkWidth = () => {
      if (containerRef.current && textRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const textWidth = textRef.current.scrollWidth;
        if (textWidth > containerWidth) {
          setShouldAnimate(true);
          setDistance(containerWidth - textWidth);
        } else {
          setShouldAnimate(false);
          setDistance(0);
        }
      }
    };

    checkWidth();
    const observer = new ResizeObserver(checkWidth);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    if (textRef.current) {
      observer.observe(textRef.current);
    }

    return () => observer.disconnect();
  }, [children]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-hidden whitespace-nowrap relative",
        shouldAnimate && "mask-image-fade-edges",
        containerClassName
      )}
    >
      <div
        ref={textRef}
        className={cn("inline-block", className)}
        style={
          shouldAnimate
            ? ({
                "--marquee-distance": `${distance}px`,
                animation: "marquee-bounce 12s linear infinite",
              } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
