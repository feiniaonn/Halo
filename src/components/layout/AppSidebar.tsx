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
import { LayoutDashboard, Music, Film, Settings } from "lucide-react";

type Page = "dashboard" | "media" | "music" | "settings";

const navItems = [
    { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
    { id: "music", label: "音乐", icon: Music },
    { id: "media", label: "点播", icon: Film },
    { id: "settings", label: "设置", icon: Settings },
] as const;

export function AppSidebar({
    currentPage,
    onNavigate,
    hasUpdate,
}: {
    currentPage?: Page;
    onNavigate?: (page: Page) => void;
    hasUpdate?: boolean;
}) {
    const { state, toggleSidebar } = useSidebar();
    const isCollapsed = state === "collapsed";

    return (
        <Sidebar
            collapsible="icon"
            className="z-10 bg-transparent shadow-none border-none"
        >
            <SidebarHeader className={cn(
                "h-[72px] flex items-center justify-center transition-all duration-300",
                isCollapsed ? "px-1" : "px-4"
            )}>
                {isCollapsed ? (
                    <button
                        type="button"
                        onClick={toggleSidebar}
                        className="size-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0 hover:bg-primary/30 transition-all cursor-pointer outline-none active:scale-95"
                        title="展开侧边栏"
                    >
                        <img
                            src={appBrandIcon}
                            alt="Halo"
                            className="size-7 rounded-full object-cover"
                            draggable={false}
                        />
                    </button>
                ) : (
                    <div className="flex w-full items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                                <img
                                    src={appBrandIcon}
                                    alt="Halo"
                                    className="size-6 rounded-full object-cover"
                                    draggable={false}
                                />
                            </div>
                            <span className="text-xl font-bold tracking-tight text-foreground">Halo</span>
                        </div>
                        <button
                            type="button"
                            onClick={toggleSidebar}
                            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors outline-none cursor-pointer"
                            title="收起侧边栏"
                        >
                            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                <line x1="9" y1="3" x2="9" y2="21" />
                            </svg>
                        </button>
                    </div>
                )}
            </SidebarHeader>

            <SidebarContent className={cn("pt-4 transition-all duration-300", isCollapsed ? "px-1" : "px-2")}>
                <SidebarMenu className="gap-2">
                    {navItems.map((item) => (
                        <SidebarMenuItem key={item.id}>
                            <SidebarMenuButton
                                onClick={() => onNavigate?.(item.id)}
                                isActive={currentPage === item.id}
                                tooltip={item.label}
                                className={cn(
                                    "rounded-xl relative overflow-hidden transition-all duration-300",
                                    isCollapsed ? "py-6 px-0 justify-center size-10! mx-auto" : "py-6 px-4",
                                    currentPage === item.id
                                        ? "bg-white/20 dark:bg-black/20 text-foreground shadow-sm hover:bg-white/20 dark:hover:bg-black/20"
                                        : "text-muted-foreground hover:text-foreground hover:bg-white/10 dark:hover:bg-black/10"
                                )}
                            >
                                <div className={cn("absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-0 transition-opacity duration-300", currentPage === item.id && "opacity-100")} />
                                <item.icon className={cn("shrink-0 relative z-10", isCollapsed ? "size-6" : "size-5")} />
                                {!isCollapsed && (
                                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2 relative z-10 text-sm font-medium">
                                        <span className="truncate">{item.label}</span>
                                        {item.id === "settings" && hasUpdate && (
                                            <span className="size-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                                        )}
                                    </span>
                                )}
                                {isCollapsed && item.id === "settings" && hasUpdate && (
                                    <span className="absolute top-3 right-3 h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                                )}
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    ))}
                </SidebarMenu>
            </SidebarContent>
            <SidebarFooter />
        </Sidebar>
    );
}
