import * as XLSX from "xlsx";

import type { CentroConsolidado } from "./relatorio-centro-custo";

export type CostCenterWorkbookInput = {
  centro: CentroConsolidado;
  competencia: string;
  periodoInicial: string;
  periodoFinal: string;
  segmentarMod: boolean;
};

const FORMATO_MOEDA = "R$ #,##0.00";
const FORMATO_DATA = "dd/mm/yyyy";

function dataExcel(dataISO: string) {
  return new Date(`${dataISO}T00:00:00`);
}

function aplicarFormato(
  sheet: XLSX.WorkSheet,
  range: { inicio: number; fim: number },
  colunas: number[],
  formato: string,
) {
  for (let linha = range.inicio; linha <= range.fim; linha += 1) {
    for (const coluna of colunas) {
      const celula = sheet[XLSX.utils.encode_cell({ r: linha, c: coluna })];
      if (celula) celula.z = formato;
    }
  }
}

export function sanitizeXlsxFilename(value: string) {
  const semControles = Array.from(value, (caractere) =>
    caractere.charCodeAt(0) <= 31 ? " " : caractere,
  ).join("");
  const sanitized = semControles
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/[^a-zA-Z0-9._ -]+/g, " ")
    .trim()
    .replace(/[ .]+$/g, "")
    .replace(/[\s-]+/g, "_");
  return sanitized || "centro_de_custo";
}

export function costCenterXlsxFilename(input: CostCenterWorkbookInput) {
  return `CC_${sanitizeXlsxFilename(input.centro.nome)}_${sanitizeXlsxFilename(input.competencia)}.xlsx`;
}

export function buildCostCenterWorkbook(input: CostCenterWorkbookInput) {
  const { centro, competencia, periodoInicial, periodoFinal, segmentarMod } = input;
  const periodo = `${new Date(`${periodoInicial}T00:00:00`).toLocaleDateString("pt-BR")} a ${new Date(`${periodoFinal}T00:00:00`).toLocaleDateString("pt-BR")}`;
  const workbook = XLSX.utils.book_new();

  const resumo = XLSX.utils.aoa_to_sheet([
    ["Campo", "Valor"],
    ["Centro de custo", centro.nome],
    ["Competência", competencia],
    ["Período", periodo],
    ["Custo total", centro.total],
    ...(segmentarMod
      ? ([
          ["MOD Civil", centro.modCivil],
          ["MOD Montagem", centro.modMontagem],
        ] as Array<[string, number]>)
      : ([["MOD", centro.mod]] as Array<[string, number]>)),
    ...(segmentarMod && centro.modAClassificar > 0
      ? ([["MOD a classificar", centro.modAClassificar]] as Array<[string, number]>)
      : []),
    ["MOI", centro.moi],
    ["Funcionários", centro.funcs],
    ["Dias alocados — soma da equipe", centro.dias],
    ["Custo das horas extras", centro.custoHE],
    ["Custo do adicional noturno", centro.custoAdicionalNoturno],
    ["Custo Refeição Local", centro.custoRegimeLocal],
    ["Custo Refeição Alojado", centro.custoRegimeAlojado],
    ["Custo Refeição", centro.custoRegimeLocal + centro.custoRegimeAlojado],
  ]);
  resumo["!cols"] = [{ wch: 34 }, { wch: 35 }];
  aplicarFormato(resumo, { inicio: 4, fim: 8 }, [1], FORMATO_MOEDA);
  XLSX.utils.book_append_sheet(workbook, resumo, "Resumo");

  const cabecalho = [
    "Centro de custo",
    "Competência",
    "Período inicial",
    "Período final",
    "Funcionário",
    "Função",
    "Tipo",
    ...(segmentarMod ? ["Tipo MOD"] : []),
    "Regime",
    "Dias",
    "Horas normais",
    "HE 50%",
    "HE 100%",
    "Horas sem adicional de HE",
    "Horas noturnas remuneráveis",
    "Custo base",
    "Custo HE",
    "Custo adicional noturno",
    "Custo Refeição Local",
    "Custo Refeição Alojado",
    "Custo Refeição",
    "Total",
  ];
  const linhas = centro.linhas.map((linha) => [
    centro.nome,
    competencia,
    dataExcel(periodoInicial),
    dataExcel(periodoFinal),
    linha.funcionarioNome,
    linha.funcao,
    linha.tipo,
    ...(segmentarMod ? [linha.tipoMod ?? ""] : []),
    linha.regime,
    linha.dias,
    linha.horasNormais,
    linha.horas50,
    linha.horas100,
    linha.horasSemAdicionalHe,
    linha.horasNoturnasRemuneraveis,
    linha.custoBase,
    linha.custoHE,
    linha.custoAdicionalNoturno,
    linha.custoRegimeLocal,
    linha.custoRegimeAlojado,
    linha.custoRegime,
    linha.total,
  ]);
  const detalhe = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas]);
  const primeiraLinha = 2;
  const ultimaLinha = linhas.length + 1;
  const linhaTotal = linhas.length + 2;
  const total = (coluna: string) =>
    linhas.length ? { f: `SUM(${coluna}${primeiraLinha}:${coluna}${ultimaLinha})` } : 0;
  const primeiraColunaNumerica = segmentarMod ? "J" : "I";
  const ultimaColuna = segmentarMod ? "V" : "U";
  XLSX.utils.sheet_add_aoa(
    detalhe,
    [
      [
        "TOTAL",
        "",
        "",
        "",
        "",
        "",
        "",
        ...(segmentarMod ? [""] : []),
        "",
        ...Array.from({ length: 13 }, (_, indice) =>
          total(String.fromCharCode(primeiraColunaNumerica.charCodeAt(0) + indice)),
        ),
      ],
    ],
    { origin: `A${linhaTotal}` },
  );
  detalhe["!cols"] = [
    { wch: 30 },
    { wch: 22 },
    { wch: 15 },
    { wch: 15 },
    { wch: 28 },
    { wch: 24 },
    { wch: 10 },
    ...(segmentarMod ? [{ wch: 16 }] : []),
    { wch: 18 },
    { wch: 10 },
    { wch: 15 },
    { wch: 10 },
    { wch: 10 },
    { wch: 22 },
    { wch: 24 },
    { wch: 16 },
    { wch: 18 },
    { wch: 20 },
    { wch: 18 },
    { wch: 16 },
    { wch: 16 },
    { wch: 20 },
  ];
  detalhe["!autofilter"] = { ref: `A1:${ultimaColuna}${Math.max(1, ultimaLinha)}` };
  aplicarFormato(detalhe, { inicio: 1, fim: linhas.length }, [2, 3], FORMATO_DATA);
  aplicarFormato(
    detalhe,
    { inicio: 1, fim: linhas.length + 1 },
    segmentarMod ? [15, 16, 17, 18, 19, 20, 21] : [14, 15, 16, 17, 18, 19, 20],
    FORMATO_MOEDA,
  );
  XLSX.utils.book_append_sheet(workbook, detalhe, "Detalhamento");
  return workbook;
}

export function exportCostCenterXlsx(input: CostCenterWorkbookInput) {
  XLSX.writeFile(buildCostCenterWorkbook(input), costCenterXlsxFilename(input));
}
