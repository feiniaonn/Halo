import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

type MiniMetricItem = {
  label: string;
  value: number | null;
};

type RenderState = {
  current: number;
  target: number;
};

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function resolveMetricColors(value: number) {
  const isDark = document.documentElement.classList.contains("dark");
  
  // Color logic based on value
  let valueColor = isDark ? "rgba(255,255,255,0.94)" : "rgba(15,23,42,0.94)";
  if (value > 85) {
    valueColor = "rgb(239, 68, 68)"; // Red
  } else if (value > 65) {
    valueColor = "rgb(245, 158, 11)"; // Amber
  }

  return {
    label: isDark ? "rgba(255,255,255,0.58)" : "rgba(15,23,42,0.56)",
    value: valueColor,
    separator: isDark ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.12)",
    barBg: isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.04)",
  };
}

function getItemWidth(height: number) {
  return clampValue(Math.round(height * 1.45), 54, 80);
}

export function getMiniMetricsCanvasWidth(height: number, itemCount: number) {
  const itemWidth = getItemWidth(height);
  const separatorWidth = 5;
  return (itemCount * itemWidth) + (Math.max(0, itemCount - 1) * separatorWidth);
}

/**
 * MiniMetricsCanvas focuses on smooth, efficient rendering of system metrics.
 * Uses a requestAnimationFrame loop for fluid value transitions (lerp).
 */
export function MiniMetricsCanvas({
  items,
  height,
  className,
}: {
  items: MiniMetricItem[];
  height: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useMemo(() => getMiniMetricsCanvasWidth(height, items.length), [height, items.length]);
  const canvasHeight = useMemo(() => clampValue(height - 4, 16, 42), [height]);
  
  // Internal state for interpolation
  const renderStatesRef = useRef<RenderState[]>([]);
  const requestRef = useRef<number | null>(null);

  // Synchronize incoming items with animation targets
  useEffect(() => {
    if (renderStatesRef.current.length !== items.length) {
      renderStatesRef.current = items.map(item => ({
        current: item.value ?? 0,
        target: item.value ?? 0
      }));
    } else {
      items.forEach((item, i) => {
        renderStatesRef.current[i].target = item.value ?? 0;
      });
    }
  }, [items]);

  // Main drawing function
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = width;
    const cssHeight = canvasHeight;

    // Smooth values using lerp
    let needsMoreFrames = false;
    renderStatesRef.current.forEach(state => {
      const diff = state.target - state.current;
      if (Math.abs(diff) > 0.01) {
        state.current += diff * 0.12; // Lerp factor
        needsMoreFrames = true;
      } else {
        state.current = state.target;
      }
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const itemWidth = getItemWidth(height);
    const separatorWidth = 5;
    // Scale font sizes more dynamically relative to height
    const labelSize = clampValue(Math.round(height * 0.18 * 10) / 10, 7.5, 9.5);
    const valueSize = clampValue(Math.round(height * 0.3 * 10) / 10, 10, 14);
    const baseline = Math.round(cssHeight * 0.65);
    const barHeight = 1.5;
    const barTop = Math.round(cssHeight * 0.85);

    ctx.textBaseline = "alphabetic";

    renderStatesRef.current.forEach((state, index) => {
      const item = items[index];
      const startX = index * (itemWidth + separatorWidth);
      const value = state.current;
      const displayValue = Math.round(value);
      const colors = resolveMetricColors(value);

      // Draw Label (Left aligned)
      ctx.font = `600 ${labelSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = colors.label;
      ctx.textAlign = "left";
      ctx.fillText(item.label, startX + 1, baseline);

      // Draw Value Text (Right aligned with small buffer)
      ctx.font = `700 ${valueSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = colors.value;
      ctx.textAlign = "right";
      ctx.fillText(`${displayValue}%`, startX + itemWidth - 1, baseline + 1);

      // Draw Mini Progress Bar
      ctx.fillStyle = colors.barBg;
      ctx.fillRect(startX, barTop, itemWidth, barHeight);
      
      const filledWidth = (value / 100) * itemWidth;
      ctx.fillStyle = colors.value;
      ctx.fillRect(startX, barTop, filledWidth, barHeight);

      // Draw Separator
      if (index < items.length - 1) {
        const separatorX = startX + itemWidth + (separatorWidth / 2);
        ctx.strokeStyle = colors.separator;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(separatorX, cssHeight * 0.22);
        ctx.lineTo(separatorX, cssHeight * 0.82);
        ctx.stroke();
      }
    });

    if (needsMoreFrames) {
      requestRef.current = requestAnimationFrame(draw);
    } else {
      requestRef.current = null;
    }
  };

  // Handle Resize & Initial Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    // Only set these when width/height change to avoid flickering/ghosting
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(canvasHeight * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${canvasHeight}px`;

    // Start or restart animation loop on resize
    if (!requestRef.current) {
      requestRef.current = requestAnimationFrame(draw);
    }
  }, [width, canvasHeight]);

  // Start animation loop when targets change
  useEffect(() => {
    if (!requestRef.current) {
      requestRef.current = requestAnimationFrame(draw);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    };
  }, [items]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("block flex-none select-none [contain:paint] [transform:translateZ(0)]", className)}
      aria-hidden
    />
  );
}
