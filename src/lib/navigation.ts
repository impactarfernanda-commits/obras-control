export const APP_NAVIGATION_ITEMS = [
  { title: "Funcionários", url: "/funcionarios", minLevel: 1 },
  { title: "Centros de custo", url: "/obras", minLevel: 1 },
  { title: "Alocações", url: "/alocacoes", minLevel: 1 },
  {
    title: "Relatórios",
    url: "/relatorios",
    minLevel: 2,
    allowedRoles: ["coordenador", "gerente", "diretor"],
  },
  {
    title: "Planejamento HH e Custos",
    url: "/planejamento-hh",
    minLevel: 2,
    allowedRoles: ["coordenador", "gerente", "diretor"],
  },
  { title: "Configurações", url: "/configuracoes", minLevel: 3 },
  { title: "Usuários", url: "/admin/usuarios", minLevel: 1, requiresUserManagement: true },
] as const;
