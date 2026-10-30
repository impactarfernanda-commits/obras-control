import type { QueryClient } from "@tanstack/react-query";
import type { Role } from "./access-control.ts";
import type { RelatorioFinanceiroCompletoDTO } from "./relatorio-centro-custo.functions.ts";

export const relatorioFinanceiroCompletoKeys = {
  root: ["relatorio-financeiro-completo"] as const,
  competencia: (userId: string | null | undefined, competencia: string) =>
    [...relatorioFinanceiroCompletoKeys.root, userId ?? "signed-out", competencia] as const,
};

export function removerRelatorioFinanceiroDoUsuario(queryClient: QueryClient, userId: string) {
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === relatorioFinanceiroCompletoKeys.root[0] && query.queryKey[1] === userId,
  });
}

export function relatorioFinanceiroCompletoHabilitado(valor?: string) {
  const configurado =
    valor ??
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_RELATORIO_FINANCEIRO_COMPLETO;
  return configurado === "true";
}

export function selecionarFluxoFinanceiro(input: {
  role: Role | null;
  aba: "funcionarios" | "obras" | "alocacao-centro-custo" | "sem-alocacao";
  flagHabilitada: boolean;
}) {
  const autorizado = input.role === "gerente" || input.role === "diretor";
  const folhaVisivel = autorizado && input.aba === "funcionarios";
  const usarCompleto = folhaVisivel && input.flagHabilitada;
  const podeVerCentro = input.role === "coordenador" || autorizado;

  return {
    usarCompleto,
    consultarFolhaLegada: folhaVisivel && !usarCompleto,
    consultarCentros:
      podeVerCentro && (input.aba === "obras" || (input.aba === "funcionarios" && !usarCompleto)),
  };
}

export function adaptarRelatorioFinanceiroCompleto(
  dto: RelatorioFinanceiroCompletoDTO | undefined,
) {
  const funcionarios = dto?.funcionarios ?? [];
  return {
    obras: dto?.obras ?? [],
    funcionarios: funcionarios.map((funcionario) => ({
      id: funcionario.funcionarioId,
      nome: funcionario.funcionarioNome,
      categoria_mo: funcionario.categoria,
      ativo: funcionario.ativo,
      salario: funcionario.custoMensal.salario,
      data_admissao: funcionario.dataAdmissao,
      data_desligamento: funcionario.dataDesligamento,
      deleted_at: null,
      visivel_obras_control: true,
    })),
    custosPorFuncionario: new Map(
      funcionarios.map((funcionario) => [funcionario.funcionarioId, funcionario.custoMensal]),
    ),
    proporcionaisPorFuncionario: new Map(
      funcionarios.map((funcionario) => [
        funcionario.funcionarioId,
        funcionario.proporcionalCompetencia,
      ]),
    ),
    tiposPorFuncionario: new Map(
      funcionarios.map((funcionario) => [funcionario.funcionarioId, funcionario.tipo]),
    ),
    totaisMensaisIntegrais: new Map(
      funcionarios.map((funcionario) => [
        funcionario.funcionarioId,
        funcionario.totalMensalIntegral,
      ]),
    ),
    totaisProporcionaisCompetencia: new Map(
      funcionarios.map((funcionario) => [
        funcionario.funcionarioId,
        funcionario.totalProporcionalCompetencia,
      ]),
    ),
    alocacoes: funcionarios.flatMap((funcionario) =>
      funcionario.alocacoes.map((alocacao) => ({
        ...alocacao,
        funcionario_id: funcionario.funcionarioId,
        tipo_mao_obra: null,
      })),
    ),
    registros: funcionarios.flatMap((funcionario) =>
      funcionario.registros.map((registro) => ({
        ...registro,
        id: registro.id ?? `${funcionario.funcionarioId}|${registro.obra_id}|${registro.data}`,
        funcionario_id: funcionario.funcionarioId,
      })),
    ),
    detalhes: funcionarios.flatMap((funcionario) =>
      funcionario.registros.flatMap((registro) =>
        registro.detalhe
          ? [
              {
                ...registro.detalhe,
                registro_horas_id:
                  registro.id ??
                  `${funcionario.funcionarioId}|${registro.obra_id}|${registro.data}`,
              },
            ]
          : [],
      ),
    ),
  };
}
