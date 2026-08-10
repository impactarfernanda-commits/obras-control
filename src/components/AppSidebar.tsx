import { Link, useRouterState } from "@tanstack/react-router";
import {
  Users,
  Building2,
  CalendarRange,
  BarChart3,
  LayoutDashboard,
  Settings,
  LogOut,
  ShieldCheck,
  House,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { TanksBRLogo } from "@/components/TanksBRLogo";
import { useAuth } from "@/hooks/use-auth";
import { canGerenciarUsuarios } from "@/lib/permissoes-especiais";
import { Button } from "@/components/ui/button";
import { APP_NAVIGATION_ITEMS } from "@/lib/navigation";

type Item = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  minLevel: 1 | 2 | 3;
  requiresUserManagement?: boolean;
};

const icons = {
  "/dashboard": LayoutDashboard,
  "/funcionarios": Users,
  "/obras": Building2,
  "/alocacoes": CalendarRange,
  "/relatorios": BarChart3,
  "/configuracoes": Settings,
  "/admin/usuarios": ShieldCheck,
} satisfies Record<(typeof APP_NAVIGATION_ITEMS)[number]["url"], Item["icon"]>;

const items: Item[] = APP_NAVIGATION_ITEMS.map((item) => ({ ...item, icon: icons[item.url] }));

const portalTanksUrl = import.meta.env.VITE_PORTAL_TANKS_URL || "https://portal-tks-br.vercel.app/";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { user, role, fullName, isDirector, isManagerOrAbove, signOut } = useAuth();

  const level = isDirector ? 3 : isManagerOrAbove ? 2 : 1;
  const canManageUsers = canGerenciarUsuarios(user?.email);
  const visible = items.filter((i) =>
    i.requiresUserManagement ? canManageUsers : level >= i.minLevel,
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div
          className={
            collapsed ? "flex h-14 items-center justify-center" : "flex h-14 items-center px-2"
          }
        >
          <TanksBRLogo variant="dark" size={collapsed ? "compact" : "sidebar"} />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => {
                const active = pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-3">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Portal Tanks BR">
              <a href={portalTanksUrl} className="flex items-center gap-3">
                <House className="h-4 w-4 shrink-0" />
                {!collapsed && <span>Portal Tanks BR</span>}
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {!collapsed && (
          <div className="px-2 py-1 text-xs">
            <div className="truncate font-semibold text-sidebar-foreground">
              {fullName || "Usuário"}
            </div>
            <div className="truncate text-sidebar-foreground/60 capitalize">{role ?? "—"}</div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
