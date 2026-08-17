import { calcularCompetencia } from "./competencias.ts";
import { categoriaEhAjudante, competenciaUsaSegmentacaoMod } from "./especialidade-ajudante.ts";

export type AlocacaoClassificavel = {
  id: string;
  funcionario_id: string;
  obra_id: string;
  data: string;
  especialidade_ajudante?: "civil" | "montagem" | null;
};

export type GrupoPendenciasClassificacao<T extends AlocacaoClassificavel> = {
  chave: string;
  funcionario_id: string;
  obra_id: string;
  competencia: string;
  dataInicio: string;
  dataFim: string;
  quantidade: number;
  alocacoes: T[];
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

export function agruparPendenciasClassificacaoAjudante<T extends AlocacaoClassificavel>(
  pendencias: T[],
): GrupoPendenciasClassificacao<T>[] {
  const grupos = new Map<string, GrupoPendenciasClassificacao<T>>();

  for (const alocacao of pendencias) {
    const competencia = calcularCompetencia(alocacao.data).competencia;
    const chave = JSON.stringify([alocacao.funcionario_id, alocacao.obra_id, competencia]);
    const grupo = grupos.get(chave);
    if (grupo) {
      grupo.alocacoes.push(alocacao);
      grupo.quantidade += 1;
      if (alocacao.data < grupo.dataInicio) grupo.dataInicio = alocacao.data;
      if (alocacao.data > grupo.dataFim) grupo.dataFim = alocacao.data;
      continue;
    }
    grupos.set(chave, {
      chave,
      funcionario_id: alocacao.funcionario_id,
      obra_id: alocacao.obra_id,
      competencia,
      dataInicio: alocacao.data,
      dataFim: alocacao.data,
      quantidade: 1,
      alocacoes: [alocacao],
    });
  }

  return Array.from(grupos.values()).sort(
    (a, b) =>
      a.competencia.localeCompare(b.competencia) ||
      a.funcionario_id.localeCompare(b.funcionario_id) ||
      a.obra_id.localeCompare(b.obra_id),
  );
}
