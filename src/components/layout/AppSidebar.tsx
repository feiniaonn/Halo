import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import appBrandIcon from "@/assets/halo-app-icon.png";
import { Activity, Bot, Film, LayoutDashboard, Music, Settings } from "lucide-react";

type Page = "dashboard" | "media" | "music" | "island" | "ai" | "settings";

export function AppSidebar({
  currentPage,
  onNavigate,
  hasUpdate,
  developerModeEnabled = false,
}: {
  currentPage?: Page;
  onNavigate?: (page: Page) => void;
  hasUpdate?: boolean;
  developerModeEnabled?: boolean;
}) {
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  const navItems = [
    { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
    { id: "music", label: "音乐库", icon: Music },
    { id: "media", label: "点播中心", icon: Film },
    { id: "island", label: "环岛", icon: Activity },
    ...(developerModeEnabled
      ? [{ id: "ai", label: "AI 管理", icon: Bot } as const]
      : []),
    { id: "settings", label: "系统设置", icon: Settings },
  ] as const;

  return (
    <Sidebar collapsible="icon" className="z-10 border-none bg-transparent shadow-none">
      <SidebarHeader
        className={cn(
          "flex items-center justify-center pt-8 transition-all duration-300",
          isCollapsed ? "px-0" : "px-0",
        )}
      >
        {isCollapsed ? (
          <button
            type="button"
            onClick={toggleSidebar}
            title="展开侧栏"
            aria-label="展开侧栏"
            aria-expanded={false}
            className="halo-interactive halo-focusable mt-1 flex size-10 items-center justify-center rounded-lg border border-transparent bg-transparent transition-colors hover:bg-muted/50"
          >
            <img src={appBrandIcon} alt="Halo" className="size-6 rounded-md object-cover opacity-80" draggable={false} />
          </button>
        ) : (
          <div className="flex w-full items-center justify-between px-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
                <img src={appBrandIcon} alt="Halo" className="size-5 rounded object-cover" draggable={false} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[16px] font-semibold tracking-tight text-foreground">Halo</div>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleSidebar}
              title="收起侧栏"
              aria-label="收起侧栏"
              aria-expanded
              className="halo-interactive halo-focusable flex size-8 items-center justify-center rounded-[calc(var(--radius-lg)-6px)] border border-transparent bg-transparent text-muted-foreground/40 transition-all hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M15 5l-6 7 6 7" />
              </svg>
            </button>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className={cn("mt-6 px-4 transition-all duration-300", isCollapsed && "px-0")}>
        <SidebarMenu className="gap-5">
          {navItems.map((item) => {
            const active = currentPage === item.id;
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  onClick={() => onNavigate?.(item.id)}
                  isActive={active}
                  tooltip={item.label}
                  className={cn(
                    "halo-interactive relative overflow-hidden rounded-lg px-4 py-3.5 transition-all duration-200",
                    isCollapsed && "mx-auto size-10! justify-center p-0!",
                    active
                      ? "bg-muted text-foreground shadow-sm"
                      : "bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <item.icon className={cn("relative z-10 shrink-0", isCollapsed ? "size-5" : "size-4.5")} />

                  {!isCollapsed && (
                    <span className="relative z-10 flex min-w-0 flex-1 items-center justify-between gap-3">
                      <span className="block truncate text-[13px] font-medium tracking-wide">
                        {item.label}
                      </span>
                      {item.id === "settings" && hasUpdate ? (
                        <span className="size-2 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(255,183,88,0.9)]" />
                      ) : null}
                    </span>
                  )}

                  {isCollapsed && item.id === "settings" && hasUpdate && (
                    <span className="absolute right-2 top-2 size-2 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(255,183,88,0.9)]" />
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className={cn("px-0 pb-3", isCollapsed && "hidden")}>
        <div className="mt-4 flex flex-col items-center justify-center gap-0.5 opacity-30 transition-opacity hover:opacity-100">
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Created By
          </span>
          <a rel="noreferrer" className="cursor-default text-xs font-bold tracking-widest text-foreground">
            DEERFLOW
          </a>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
