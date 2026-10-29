import type { Role } from "@/lib/access-control";

export type AbaRelatorios = "funcionarios" | "obras" | "alocacao-centro-custo" | "sem-alocacao";

export function abaInicialRelatorios(role: Role | null): AbaRelatorios {
  if (role === "gerente" || role === "diretor") return "funcionarios";
  if (role === "coordenador") return "obras";
  return "sem-alocacao";
}

export function consultasRelatoriosPorAba(role: Role | null, aba: AbaRelatorios) {
  const podeVerFolha = role === "gerente" || role === "diretor";
  const podeVerCentroCusto = role === "coordenador" || podeVerFolha;

  return {
    folha: podeVerFolha && aba === "funcionarios",
    centros: podeVerCentroCusto && (aba === "funcionarios" || aba === "obras"),
    semAlocacao: aba === "sem-alocacao" || aba === "alocacao-centro-custo",
  };
}
