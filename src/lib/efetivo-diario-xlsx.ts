import * as XLSX from "xlsx";

import { sanitizeXlsxFilename } from "./relatorio-centro-custo-xlsx.ts";

export type LinhaEfetivoDiario = {
  funcionario: string;
  funcao: string;
  especialidadeAjudante?: "civil" | "montagem" | null;
  situacao: string;
  horasNormais: number;
  horasExtra50: number;
  horasExtra100: number;
  totalHoras: number;
  observacoes?: string | null;
};

export type EfetivoDiarioWorkbookInput = {
  data: string;
  obra: string;
  linhas: LinhaEfetivoDiario[];
};

const FORMATO_DATA = "dd/mm/yyyy";
const FORMATO_HORAS = "0.00";

function dataExcel(dataISO: string) {
  return new Date(`${dataISO}T00:00:00`);
}

export function efetivoDiarioXlsxFilename(input: EfetivoDiarioWorkbookInput) {
  return `Efetivo_${sanitizeXlsxFilename(input.obra)}_${input.data}.xlsx`;
}

export function buildEfetivoDiarioWorkbook(input: EfetivoDiarioWorkbookInput) {
  const workbook = XLSX.utils.book_new();
  const cabecalho = [
    "Data",
    "Centro de custo",
    "Funcionário",
    "Função",
    "Atuação do ajudante",
    "Situação",
    "Horas normais",
    "HE 50%",
    "HE 100%",
    "Total de horas",
    "Observações",
  ];
  const linhas = input.linhas.map((linha) => [
    dataExcel(input.data),
    input.obra,
    linha.funcionario,
    linha.funcao,
    linha.especialidadeAjudante === "civil"
      ? "Civil"
      : linha.especialidadeAjudante === "montagem"
        ? "Montagem"
        : "",
    linha.situacao,
    linha.horasNormais,
    linha.horasExtra50,
    linha.horasExtra100,
    linha.totalHoras,
    linha.observacoes?.trim() ?? "",
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas]);

  sheet["!cols"] = [
    { wch: 13 },
    { wch: 32 },
    { wch: 30 },
    { wch: 24 },
    { wch: 21 },
    { wch: 26 },
    { wch: 15 },
    { wch: 11 },
    { wch: 11 },
    { wch: 16 },
    { wch: 36 },
  ];
  sheet["!autofilter"] = { ref: `A1:K${Math.max(1, linhas.length + 1)}` };

  for (let indice = 1; indice <= linhas.length; indice += 1) {
    const data = sheet[XLSX.utils.encode_cell({ r: indice, c: 0 })];
    if (data) data.z = FORMATO_DATA;
    for (let coluna = 6; coluna <= 9; coluna += 1) {
      const horas = sheet[XLSX.utils.encode_cell({ r: indice, c: coluna })];
      if (horas) horas.z = FORMATO_HORAS;
    }
  }

  XLSX.utils.book_append_sheet(workbook, sheet, "Efetivo do dia");
  return workbook;
}

export function exportEfetivoDiarioXlsx(input: EfetivoDiarioWorkbookInput) {
  XLSX.writeFile(buildEfetivoDiarioWorkbook(input), efetivoDiarioXlsxFilename(input));
}
