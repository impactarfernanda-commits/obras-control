import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  buildCostCenterWorkbook,
  costCenterXlsxFilename,
  sanitizeXlsxFilename,
  type CostCenterWorkbookInput,
} from "./relatorio-centro-custo-xlsx.ts";

const input: CostCenterWorkbookInput = {
  segmentarMod: true,
  centro: {
    id: "o1",
    nome: "230 - IGUÁ ETE SUL",
    mod: 200.25,
    modCivil: 0,
    modMontagem: 200.25,
    modAClassificar: 0,
    moi: 77.5,
    total: 277.75,
    funcs: 1,
    dias: 2,
    custoHE: 7.5,
    custoAdicionalNoturno: 0,
    custoRegimeLocal: 45,
    custoRegimeAlojado: 0,
    linhas: [
      {
        funcionarioId: "f1",
        funcionarioNome: "Ana",
        funcao: "Montadora",
        tipo: "MOD",
        tipoMod: "Montagem",
        tipoInferido: false,
        dias: 2,
        horasNormais: 17.5,
        horas50: 1.5,
        horas100: 0,
        horasSemAdicionalHe: 0,
        horasNoturnasRemuneraveis: 0,
        custoBase: 192.75,
        custoHE: 7.5,
        custoAdicionalNoturno: 0,
        regime: "Local",
        custoRegimeLocal: 45,
        custoRegimeAlojado: 0,
        custoRegime: 45,
        total: 245.25,
      },
    ],
  },
  competencia: "agosto de 2026",
  periodoInicial: "2026-07-25",
  periodoFinal: "2026-08-24",
};

function sheets(overrides: Partial<CostCenterWorkbookInput> = {}) {
  const workbook = buildCostCenterWorkbook({ ...input, ...overrides });
  return {
    workbook,
    resumo: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Resumo, { header: 1, raw: true }),
    detalhe: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Detalhamento, {
      header: 1,
      raw: true,
    }),
  };
}

test("workbook possui as abas Resumo e Detalhamento", () => {
  assert.deepEqual(sheets().workbook.SheetNames, ["Resumo", "Detalhamento"]);
});

test("resumo preserva centro, competência e período 25→24", () => {
  const { resumo } = sheets();
  assert.equal(resumo[1][1], input.centro.nome);
  assert.equal(resumo[2][1], input.competencia);
  assert.equal(resumo[3][1], "25/07/2026 a 24/08/2026");
});

test("Excel apresenta custos financeiros como refeição e preserva a coluna operacional Regime", () => {
  const { resumo, detalhe } = sheets();
  assert.deepEqual(
    resumo.slice(12, 15).map((linha) => linha[0]),
    ["Custo Refeição Local", "Custo Refeição Alojado", "Custo Refeição"],
  );
  assert.equal(detalhe[0][8], "Regime");
  assert.deepEqual(detalhe[0].slice(18, 21), [
    "Custo Refeição Local",
    "Custo Refeição Alojado",
    "Custo Refeição",
  ]);
});

test("KPIs financeiros e quantitativos do modal permanecem numéricos", () => {
  const { resumo } = sheets();
  for (const index of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    assert.equal(typeof resumo[index][1], "number");
  assert.deepEqual(
    [resumo[4][1], resumo[5][1], resumo[6][1], resumo[7][1]],
    [277.75, 0, 200.25, 77.5],
  );
});

test("detalhamento preserva funcionário, função, tipo e números fornecidos pelo modal", () => {
  const linha = sheets().detalhe[1];
  assert.deepEqual(linha.slice(4, 9), ["Ana", "Montadora", "MOD", "Montagem", "Local"]);
  assert.deepEqual(linha.slice(9, 22), [2, 17.5, 1.5, 0, 0, 0, 192.75, 7.5, 0, 45, 0, 45, 245.25]);
  for (const valor of linha.slice(9, 22)) assert.equal(typeof valor, "number");
});

test("centro sem HE exporta zero numérico", () => {
  const centro = {
    ...input.centro,
    custoHE: 0,
    linhas: [{ ...input.centro.linhas[0], horas50: 0, custoHE: 0 }],
  };
  const { resumo, detalhe } = sheets({ centro });
  assert.equal(resumo[10][1], 0);
  assert.equal(detalhe[1][11], 0);
  assert.equal(detalhe[1][16], 0);
});

test("quantidade variável preserva ordem e alocação parcial sem recalcular custos", () => {
  const parcial = {
    ...input.centro.linhas[0],
    funcionarioId: "f2",
    funcionarioNome: "Bia",
    dias: 1,
    custoBase: 31.23,
    custoHE: 0,
    total: 31.23,
  };
  const centro = { ...input.centro, linhas: [...input.centro.linhas, parcial] };
  const detalhe = sheets({ centro }).detalhe;
  assert.equal(detalhe[1][4], "Ana");
  assert.equal(detalhe[2][4], "Bia");
  assert.equal(detalhe[2][15], 31.23);
  assert.equal(detalhe.length, 4);
});

test("linha TOTAL usa fórmulas com quantidade dinâmica", () => {
  const workbook = sheets().workbook;
  assert.equal(workbook.Sheets.Detalhamento.V3.f, "SUM(V2:V2)");
  assert.equal(workbook.Sheets.Detalhamento.J3.f, "SUM(J2:J2)");
});

test("histórico exporta o leiaute antigo MOD, MOI e Total sem Tipo MOD", () => {
  const { resumo, detalhe, workbook } = sheets({ segmentarMod: false });
  assert.deepEqual(
    resumo.slice(4, 7).map((linha) => linha[0]),
    ["Custo total", "MOD", "MOI"],
  );
  assert.equal(detalhe[0].includes("Tipo MOD"), false);
  assert.equal(workbook.Sheets.Detalhamento.U3.f, "SUM(U2:U2)");
  assert.equal(workbook.Sheets.Detalhamento.I3.f, "SUM(I2:I2)");
});

test("nome do arquivo remove caracteres inválidos e permanece legível", () => {
  assert.equal(
    sanitizeXlsxFilename('04.0003.01 / DIRETORIA: "GERAL"?'),
    "04.0003.01_DIRETORIA_GERAL",
  );
  assert.equal(costCenterXlsxFilename(input), "CC_230_IGUA_ETE_SUL_agosto_de_2026.xlsx");
});

test("exportação é transformação pura dos dados recebidos", () => {
  assert.equal(buildCostCenterWorkbook.length, 1);
  assert.equal(input.centro.linhas[0].total, sheets().detalhe[1][21]);
});
