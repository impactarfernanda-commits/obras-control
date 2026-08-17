import { calcularCompetencia } from "./competencias.ts";
import { categoriaEhAjudante, competenciaUsaSegmentacaoMod } from "./especialidade-ajudante.ts";

export type AlocacaoClassificavel = {
  id: string;
  funcionario_id: string;
  data: string;
  especialidade_ajudante?: "civil" | "montagem" | null;
};

export function alocacaoPendenteClassificacaoAjudante(
  alocacao: AlocacaoClassificavel,
  categoria: string | null | undefined,
) {
  return (
    categoriaEhAjudante(categoria) &&
    alocacao.especialidade_ajudante == null &&
    competenciaUsaSegmentacaoMod(calcularCompetencia(alocacao.data).competencia)
  );
}

export function filtrarPendenciasClassificacaoAjudante<T extends AlocacaoClassificavel>(
  alocacoes: T[],
  categoriaPorFuncionario: ReadonlyMap<string, string>,
) {
  return alocacoes.filter((alocacao) =>
    alocacaoPendenteClassificacaoAjudante(
      alocacao,
      categoriaPorFuncionario.get(alocacao.funcionario_id),
    ),
  );
}

export function filtrarAlocacoesSelecionadas<T extends { id: string }>(
  alocacoes: T[],
  idsSelecionados: ReadonlySet<string>,
) {
  return alocacoes.filter((alocacao) => idsSelecionados.has(alocacao.id));
}
