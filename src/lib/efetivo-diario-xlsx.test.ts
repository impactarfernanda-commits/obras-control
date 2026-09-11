import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import CFB from "cfb";
import * as XLSX from "xlsx";

import {
  buildEfetivoDiarioWorkbook,
  efetivoDiarioXlsxFilename,
  type EfetivoDiarioWorkbookInput,
  writeEfetivoDiarioWorkbook,
} from "./efetivo-diario-xlsx.ts";

const input: EfetivoDiarioWorkbookInput = {
  data: "2026-08-18",
  obra: "237.3 - Costa Verde",
  linhas: [
    {
      funcionario: "Ana Souza",
      funcao: "Ajudante",
      tipoRegistro: "horas",
      trabalhoEfetivo: 10.5,
      observacoes: "Equipe A",
    },
    { funcionario: "Falta", funcao: "Montador I", tipoRegistro: "falta", trabalhoEfetivo: 8 },
    {
      funcionario: "Folga de campo",
      funcao: "Montador I",
      tipoRegistro: "folga_campo",
      trabalhoEfetivo: 8,
    },
    {
      funcionario: "Férias",
      funcao: "Montador I",
      tipoRegistro: "ferias",
      trabalhoEfetivo: 8,
    },
    {
      funcionario: "Atestado",
      funcao: "Montador I",
      tipoRegistro: "falta",
      faltaTipo: "atestado",
      trabalhoEfetivo: 8,
    },
    {
      funcionario: "Afastamento",
      funcao: "Montador I",
      tipoRegistro: "falta",
      faltaTipo: "afastamento",
      trabalhoEfetivo: 8,
    },
    {
      funcionario: "Registro administrativo",
      funcao: "Montador I",
      tipoRegistro: "horas",
      trabalhoEfetivo: 0,
    },
    {
      funcionario: "Situação mista",
      funcao: "Encarregado",
      tipoRegistro: "horas",
      trabalhoEfetivo: 8,
      observacoes: "Trabalhou e teve outra ocorrência no período",
    },
    {
      funcionario: "Situação mista",
      funcao: "Encarregado",
      tipoRegistro: "falta",
      faltaTipo: "atestado",
      trabalhoEfetivo: 8,
    },
  ],
};

function linhasDaTabela(inputWorkbook = input) {
  const workbook = buildEfetivoDiarioWorkbook(inputWorkbook);
  const sheet = workbook.Sheets.Efetivo;
  return {
    sheet,
    rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      range: 4,
      defval: "",
    }),
  };
}

test("exporta somente registro normal com trabalho e mantém a linha trabalhada da situação mista", () => {
  const { sheet, rows } = linhasDaTabela();

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ["Funcionário", "Função", "Observações"]);
  assert.deepEqual(rows[1], ["Ana Souza", "Ajudante", "Equipe A"]);
  assert.equal(rows[2]?.[0], "Situação mista");

  const nomes = rows.slice(1).map((row) => row[0]);
  for (const ausencia of [
    "Falta",
    "Folga de campo",
    "Férias",
    "Atestado",
    "Afastamento",
    "Registro administrativo",
  ]) {
    assert.doesNotMatch(nomes.join("|"), new RegExp(ausencia));
  }
});

test("mantém somente Funcionário, Função e Observações na tabela", () => {
  const { rows } = linhasDaTabela();
  const cabecalho = rows[0] as string[];

  for (const removida of [
    "Atuação do ajudante",
    "Situação",
    "Horas normais",
    "HE 50%",
    "HE 100%",
    "Total de horas",
    "Data",
    "Centro de custo",
  ]) {
    assert.ok(!cabecalho.includes(removida));
  }
  assert.deepEqual(cabecalho, ["Funcionário", "Função", "Observações"]);
});

test("gera layout diário com metadados únicos, filtro, congelamento e larguras", () => {
  const { sheet } = linhasDaTabela();
  const sheetComFreeze = sheet as XLSX.WorkSheet & { "!freeze"?: { ySplit?: number } };

  assert.equal(sheet.A1?.v, "EFETIVO");
  assert.equal(sheet.A2?.v, "Data:");
  assert.equal(XLSX.utils.format_cell(sheet.B2), "18/08/2026");
  assert.equal(sheet.A3?.v, "Centro de custo:");
  assert.equal(sheet.B3?.v, "237.3 - Costa Verde");
  assert.deepEqual(
    sheet["!merges"]?.map((merge) => XLSX.utils.encode_range(merge)),
    ["A1:C1", "B3:C3"],
  );
  assert.equal(sheet["!autofilter"]?.ref, "A5:C7");
  assert.equal(sheetComFreeze["!freeze"]?.ySplit, 5);
  assert.deepEqual(
    sheet["!cols"]?.map((coluna) => coluna.wch),
    [42, 30, 60],
  );
  assert.equal(sheet.C6?.s?.alignment?.wrapText, true);
  assert.equal(sheet.A5?.s?.font?.bold, true);
  assert.equal(sheet.A2?.s?.font?.bold, true);
  assert.equal(sheet.A3?.s?.font?.bold, true);
});

test("serializa no XLSX o congelamento, o destaque e a quebra de Observações", () => {
  const workbook = buildEfetivoDiarioWorkbook(input);
  const conteudo = writeEfetivoDiarioWorkbook(workbook);
  const reaberto = XLSX.read(conteudo, { type: "buffer", cellStyles: true });
  const sheet = reaberto.Sheets.Efetivo;
  const cfb = CFB.read(conteudo, { type: "buffer" });
  const worksheetXml = new TextDecoder().decode(
    Uint8Array.from(CFB.find(cfb, "/xl/worksheets/sheet1.xml")?.content ?? []),
  );

  assert.equal(sheet["!autofilter"]?.ref, "A5:C7");
  assert.deepEqual(
    sheet["!cols"]?.map((coluna) => coluna.wch),
    [42, 30, 60],
  );
  assert.match(worksheetXml, /<pane ySplit="5"[^>]*state="frozen"/);
  assert.match(worksheetXml, /<c r="A1" s="\d+"/);
  assert.match(worksheetXml, /<c r="A2" s="\d+"/);
  assert.match(worksheetXml, /<c r="A3" s="\d+"/);
  assert.match(worksheetXml, /<c r="A5" s="\d+"/);
  assert.match(worksheetXml, /<c r="C6" s="\d+"/);
});

test("mantém cabeçalho e filtro quando não há trabalho efetivo", () => {
  const { sheet, rows } = linhasDaTabela({
    ...input,
    linhas: [
      {
        funcionario: "Sem trabalho",
        funcao: "Ajudante",
        tipoRegistro: "horas",
        trabalhoEfetivo: 0,
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(sheet["!autofilter"]?.ref, "A5:C5");
});

test("gera nome de arquivo seguro com obra e data", () => {
  assert.equal(
    efetivoDiarioXlsxFilename({ ...input, obra: "237/3: Costa Verde?" }),
    "Efetivo_237_3_Costa_Verde_2026-08-18.xlsx",
  );
});

test("calendário diário usa diálogo rolável e oferece exportação do efetivo", () => {
  const source = readFileSync(
    new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url),
    "utf8",
  );
  const trechoCalendario = source.slice(
    source.indexOf("const items = obra.dias.get(d)"),
    source.indexOf('<TabsContent value="grade"'),
  );

  assert.match(trechoCalendario, /<Dialog key=\{d\}>/);
  assert.match(trechoCalendario, /max-h-\[85vh\]/);
  assert.match(trechoCalendario, /overflow-y-auto/);
  assert.match(trechoCalendario, /Exportar efetivo/);
  assert.doesNotMatch(trechoCalendario, /<Popover/);
});
