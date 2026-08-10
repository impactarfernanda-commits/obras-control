export const APP_NAVIGATION_ITEMS = [
  { title: "Dashboard", url: "/dashboard", minLevel: 2 },
  { title: "Funcionários", url: "/funcionarios", minLevel: 1 },
  { title: "Centros de custo", url: "/obras", minLevel: 1 },
  { title: "Alocações", url: "/alocacoes", minLevel: 1 },
  { title: "Relatórios", url: "/relatorios", minLevel: 2 },
  { title: "Configurações", url: "/configuracoes", minLevel: 3 },
  { title: "Usuários", url: "/admin/usuarios", minLevel: 1, requiresUserManagement: true },
] as const;
