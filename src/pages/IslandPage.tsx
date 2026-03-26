import { Activity } from "lucide-react";
import { Separator } from "@/components/ui/separator";

import { Slider } from "@/components/ui/slider";
import { useIslandSizes } from "@/hooks/useIslandSizes";

export function IslandPage({
  miniModeWidth = 700,
  miniModeHeight = 50,
  onMiniModeWidthChange,
  onMiniModeHeightChange,
  onSaveMiniModeSize
}: {
  miniModeWidth?: number;
  miniModeHeight?: number;
  onMiniModeWidthChange?: (width: number) => void;
  onMiniModeHeightChange?: (height: number) => void;
  onSaveMiniModeSize?: (width: number, height: number) => void;
}) {
  const { sizes, updateSizes } = useIslandSizes();

  const updateSizeAndBounds = (key: keyof typeof sizes, val: number) => {
    updateSizes({ [key]: val });
    
    // Auto-expand Tauri window bounds if necessary to prevent clipping
    const requiredWidth = Math.max(
      key === "expandedWidth" ? val + 60 : sizes.expandedWidth + 60,
      key === "capsuleWidth" ? val + 60 : sizes.capsuleWidth + 60
    );
    const requiredHeight = Math.max(
      key === "expandedHeight" ? val + 60 : sizes.expandedHeight + 60,
      key === "capsuleHeight" ? val + 60 : sizes.capsuleHeight + 60
    );

    let needsUpdate = false;
    let newWinWidth = miniModeWidth || 700;
    let newWinHeight = miniModeHeight || 50;

    if (requiredWidth > newWinWidth || requiredWidth < newWinWidth - 200) {
      newWinWidth = requiredWidth;
      needsUpdate = true;
    }
    if (requiredHeight > newWinHeight || requiredHeight < newWinHeight - 200) {
      newWinHeight = requiredHeight;
      needsUpdate = true;
    }

    if (needsUpdate && onSaveMiniModeSize && onMiniModeWidthChange && onMiniModeHeightChange) {
      onMiniModeWidthChange(newWinWidth);
      onMiniModeHeightChange(newWinHeight);
      onSaveMiniModeSize(newWinWidth, newWinHeight);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-8 pb-4 pt-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Activity className="size-6 text-primary" />
          环岛设置
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          在这里管理迷你模式与灵动岛的外观、交互及模块调度。
        </p>
      </div>
      <Separator className="mx-8 w-auto opacity-50" />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl space-y-10 pb-12">
          
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">核心机制</h2>
              <p className="text-sm text-muted-foreground mt-1">管理灵动岛的各种展示形态和调度策略。</p>
            </div>
            
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium leading-none text-foreground">胶囊态默认显示时间</h3>
                    <p className="text-[13px] text-muted-foreground">事件触发后，胶囊态在自动缩回或隐藏前的展示时间。</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      className="flex h-9 w-24 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      defaultValue={3000}
                    />
                    <span className="text-sm text-muted-foreground">毫秒</span>
                  </div>
                </div>
              </div>
            </div>
            
                        <div className="space-y-8 pt-2 rounded-xl border border-border bg-card/40 p-6 shadow-sm">
              <div>
                <h3 className="text-sm font-medium leading-none text-foreground mb-4">胶囊态尺寸 (Capsule)</h3>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">宽度 ({sizes.capsuleWidth}px)</span>
                    </div>
                    <Slider
                      value={[sizes.capsuleWidth]}
                      min={100}
                      max={1200}
                      step={10}
                      onValueChange={(vals) => updateSizeAndBounds("capsuleWidth", vals[0])}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">高度 ({sizes.capsuleHeight}px)</span>
                    </div>
                    <Slider
                      value={[sizes.capsuleHeight]}
                      min={30}
                      max={200}
                      step={2}
                      onValueChange={(vals) => updateSizeAndBounds("capsuleHeight", vals[0])}
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium leading-none text-foreground mb-4">扩展态尺寸 (Expanded)</h3>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">宽度 ({sizes.expandedWidth}px)</span>
                    </div>
                    <Slider
                      value={[sizes.expandedWidth]}
                      min={300}
                      max={2000}
                      step={10}
                      onValueChange={(vals) => updateSizeAndBounds("expandedWidth", vals[0])}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">高度 ({sizes.expandedHeight}px)</span>
                    </div>
                    <Slider
                      value={[sizes.expandedHeight]}
                      min={200}
                      max={1200}
                      step={10}
                      onValueChange={(vals) => updateSizeAndBounds("expandedHeight", vals[0])}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-muted/10 p-6">
              <div className="flex items-center justify-center text-muted-foreground text-sm opacity-80 py-10">
                施工中... (WIP)
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}