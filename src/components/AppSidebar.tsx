import { Link, useRouterState } from "@tanstack/react-router";
import {
  Users,
  Building2,
  CalendarRange,
  DollarSign,
  BarChart3,
  LayoutDashboard,
  Settings,
  LogOut,
  ShieldCheck,
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
import { Button } from "@/components/ui/button";

type Item = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  minLevel: 1 | 2 | 3;
};

const items: Item[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, minLevel: 2 },
  { title: "Funcionários", url: "/funcionarios", icon: Users, minLevel: 1 },
  { title: "Obras", url: "/obras", icon: Building2, minLevel: 1 },
  { title: "Alocações", url: "/alocacoes", icon: CalendarRange, minLevel: 1 },
  { title: "Custos", url: "/custos", icon: DollarSign, minLevel: 1 },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3, minLevel: 2 },
  { title: "Configurações", url: "/configuracoes", icon: Settings, minLevel: 3 },
  { title: "Usuários", url: "/admin/usuarios", icon: ShieldCheck, minLevel: 3 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { role, fullName, isDirector, isManagerOrAbove, signOut } = useAuth();

  const level = isDirector ? 3 : isManagerOrAbove ? 2 : 1;
  const visible = items.filter((i) => level >= i.minLevel);

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
