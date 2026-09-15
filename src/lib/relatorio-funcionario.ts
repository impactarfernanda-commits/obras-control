import type { CentroConsolidado } from "./relatorio-centro-custo.ts";

// As linhas já contêm a apuração canônica, inclusive rateios e dias sem jornada.
export function custoRefeicaoFuncionario(
  centros: readonly Pick<CentroConsolidado, "id" | "linhas">[],
  funcionarioId: string,
  centroId?: string,
) {
  return centros.reduce(
    (total, centro) =>
      centroId != null && centro.id !== centroId
        ? total
        : total +
          centro.linhas.reduce(
            (subtotal, linha) =>
              subtotal + (linha.funcionarioId === funcionarioId ? linha.custoRegime : 0),
            0,
          ),
    0,
  );
}

export function custoTotalCompetenciaFuncionario(
  custoBase: number,
  custoExtras: number,
  custoRefeicao: number,
) {
  return custoBase + custoExtras + custoRefeicao;
}

export function consolidarCustoFuncionario(
  centros: readonly Pick<CentroConsolidado, "id" | "linhas">[],
  funcionarioId: string,
) {
  const resumo = {
    custoBase: 0,
    custoHE: 0,
    remuneracaoHE: 0,
    encargosProvisoesHE: 0,
    custoAdicionalNoturno: 0,
    custoRefeicao: 0,
    total: 0,
  };
  for (const centro of centros) {
    for (const linha of centro.linhas) {
      if (linha.funcionarioId !== funcionarioId) continue;
      resumo.custoBase += linha.custoBase;
      resumo.custoHE += linha.custoHE;
      resumo.remuneracaoHE += linha.remuneracaoHE;
      resumo.encargosProvisoesHE += linha.encargosProvisoesHE;
      resumo.custoAdicionalNoturno += linha.custoAdicionalNoturno;
      resumo.custoRefeicao += linha.custoRegime;
      resumo.total += linha.total;
    }
  }
  return resumo;
}
