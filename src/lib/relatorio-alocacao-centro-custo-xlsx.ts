import * as XLSX from "xlsx";

import type { RelatorioAlocacaoCc } from "./relatorio-alocacao-centro-custo.ts";
import { separarCentroCustoObra } from "./relatorio-alocacao-centro-custo.ts";
import { rotuloFalta, rotuloTipoRegistro } from "./registro-falta.ts";

const FORMATO_DATA = "dd/mm/yyyy";
const FORMATO_PERCENTUAL = "0.00%";
const FORMATO_HORAS = "0.00";

export function nomeArquivoAlocacaoCentroCusto(competencia: string) {
  return `Alocacao_por_Centro_de_Custo_${competencia}.xlsx`;
}

function dataExcel(data: string) {
  return new Date(`${data}T00:00:00`);
}

function formatarColunas(
  planilha: XLSX.WorkSheet,
  inicio: number,
  fim: number,
  colunas: number[],
  formato: string,
) {
  for (let linha = inicio; linha <= fim; linha += 1)
    for (const coluna of colunas) {
      const celula = planilha[XLSX.utils.encode_cell({ r: linha, c: coluna })];
      if (celula) celula.z = formato;
    }
}

export function buildAlocacaoCentroCustoWorkbook(relatorio: RelatorioAlocacaoCc) {
  const workbook = XLSX.utils.book_new();
  const resumo = XLSX.utils.aoa_to_sheet([
    [
      "Funcionário",
      "Categoria/Função",
      "Centro de custo",
      "Obra",
      "Dias alocados",
      "Horas normais",
      "HE 50%",
      "HE 100%",
      "Horas sem adicional",
      "Total de horas",
      "% dos dias alocados",
      "Dias esperados",
      "Dias de ausência",
      "Dias sem alocação",
      "% cobertura",
      "% ainda não distribuído",
      "Pendência/observação",
    ],
    ...relatorio.resumo.map((linha) => [
      linha.funcionarioNome,
      linha.categoria,
      linha.centroCusto,
      linha.obra,
      linha.diasAlocados,
      linha.horasNormais,
      linha.horas50,
      linha.horas100,
      linha.horasSemAdicional,
      linha.totalHoras,
      linha.percentualDiasAlocados / 100,
      linha.diasEsperados,
      linha.diasAusencia,
      linha.diasSemAlocacao,
      linha.percentualCobertura / 100,
      linha.percentualNaoDistribuido / 100,
      linha.observacaoPendencia,
    ]),
  ]);
  resumo["!cols"] = [28, 24, 16, 30, 14, 15, 12, 12, 21, 15, 22, 16, 17, 20, 15, 27, 46].map(
    (wch) => ({ wch }),
  );
  resumo["!autofilter"] = { ref: `A1:Q${Math.max(1, relatorio.resumo.length + 1)}` };
  formatarColunas(resumo, 1, relatorio.resumo.length, [5, 6, 7, 8, 9], FORMATO_HORAS);
  formatarColunas(resumo, 1, relatorio.resumo.length, [10, 14, 15], FORMATO_PERCENTUAL);
  XLSX.utils.book_append_sheet(workbook, resumo, "RESUMO");

  const detalhamento = XLSX.utils.aoa_to_sheet([
    [
      "Funcionário",
      "Categoria/Função",
      "Data",
      "Centro de custo",
      "Obra",
      "Situação",
      "Tipo de registro",
      "Classificação",
      "Entrada",
      "Saída",
      "Horas normais",
      "HE 50%",
      "HE 100%",
      "Horas sem adicional",
      "Total",
      "Observação",
      "Pendência/Inconsistência",
    ],
    ...relatorio.detalhes.map((linha) => {
      const partes = separarCentroCustoObra(linha.obra_nome);
      const totalMinutos =
        linha.minutos_normais +
        linha.minutos_he_50 +
        linha.minutos_he_100 +
        linha.minutos_sem_adicional_he;
      return [
        linha.funcionario_nome,
        linha.categoria,
        dataExcel(linha.data),
        linha.obra_id ? partes.centroCusto : "",
        linha.obra_id ? partes.obra : "",
        linha.situacao.replaceAll("_", " "),
        rotuloTipoRegistro(linha.tipo_registro),
        linha.tipo_registro === "falta" ? rotuloFalta(linha.falta_tipo) : "",
        linha.hora_entrada ?? "",
        linha.hora_saida ?? "",
        linha.minutos_normais / 60,
        linha.minutos_he_50 / 60,
        linha.minutos_he_100 / 60,
        linha.minutos_sem_adicional_he / 60,
        totalMinutos / 60,
        linha.observacoes ?? "",
        linha.tipo_inconsistencia ?? "",
      ];
    }),
  ]);
  detalhamento["!cols"] = [28, 24, 14, 16, 30, 18, 20, 22, 12, 12, 15, 12, 12, 21, 14, 38, 38].map(
    (wch) => ({ wch }),
  );
  detalhamento["!autofilter"] = { ref: `A1:Q${Math.max(1, relatorio.detalhes.length + 1)}` };
  formatarColunas(detalhamento, 1, relatorio.detalhes.length, [2], FORMATO_DATA);
  formatarColunas(detalhamento, 1, relatorio.detalhes.length, [10, 11, 12, 13, 14], FORMATO_HORAS);
  XLSX.utils.book_append_sheet(workbook, detalhamento, "DETALHAMENTO");
  return workbook;
}

export function exportarAlocacaoCentroCustoXlsx(
  relatorio: RelatorioAlocacaoCc,
  competencia: string,
) {
  XLSX.writeFile(
    buildAlocacaoCentroCustoWorkbook(relatorio),
    nomeArquivoAlocacaoCentroCusto(competencia),
  );
}
