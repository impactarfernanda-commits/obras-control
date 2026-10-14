import * as XLSX from "xlsx";

import type { RelatorioAlocacaoCc } from "./relatorio-alocacao-centro-custo.ts";
import { separarCentroCustoObra } from "./relatorio-alocacao-centro-custo.ts";

const FORMATO_DATA = "dd/mm/yyyy";

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
  const centros = [
    ...new Map(relatorio.resumo.map((linha) => [linha.obraId, linha])).values(),
  ].sort((a, b) => a.centroCusto.localeCompare(b.centroCusto, "pt-BR", { numeric: true }));
  const resumo = XLSX.utils.aoa_to_sheet([
    [
      "Funcionário",
      "Categoria/Função",
      "Dias disponíveis",
      "Dias alocados",
      "Observação",
      ...centros.map((centro) => `${centro.centroCusto} - ${centro.obra}`),
    ],
    ...relatorio.funcionarios.map((funcionario) => [
      funcionario.funcionarioNome,
      funcionario.categoria,
      funcionario.totalDiasDisponiveis,
      funcionario.totalDiasAlocados,
      funcionario.observacao,
      ...centros.map((coluna) => {
        const centro = funcionario.centros.find((item) => item.obraId === coluna.obraId);
        return centro
          ? `${percentualExcel(centro.percentualDiasAlocados)}\n${centro.diasAlocados} dia(s)`
          : "—";
      }),
    ]),
  ]);
  resumo["!cols"] = [28, 24, 16, 14, 28, ...centros.map(() => 28)].map((wch) => ({ wch }));
  resumo["!rows"] = [{}, ...relatorio.funcionarios.map(() => ({ hpt: 30 }))];
  resumo["!autofilter"] = {
    ref: `A1:${XLSX.utils.encode_col(4 + centros.length)}${Math.max(1, relatorio.funcionarios.length + 1)}`,
  };
  XLSX.utils.book_append_sheet(workbook, resumo, "RESUMO");

  const detalhamento = XLSX.utils.aoa_to_sheet([
    ["Funcionário", "Categoria/Função", "Data", "Centro de custo", "Obra"],
    ...relatorio.detalhes.map((linha) => {
      const partes = separarCentroCustoObra(linha.obra_nome);
      return [
        linha.funcionario_nome,
        linha.categoria,
        dataExcel(linha.data),
        linha.obra_id ? partes.centroCusto : "",
        linha.obra_id ? partes.obra : "",
      ];
    }),
  ]);
  detalhamento["!cols"] = [28, 24, 14, 16, 30].map((wch) => ({ wch }));
  detalhamento["!autofilter"] = { ref: `A1:E${Math.max(1, relatorio.detalhes.length + 1)}` };
  formatarColunas(detalhamento, 1, relatorio.detalhes.length, [2], FORMATO_DATA);
  XLSX.utils.book_append_sheet(workbook, detalhamento, "DETALHAMENTO");
  return workbook;
}

function percentualExcel(valor: number) {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
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
