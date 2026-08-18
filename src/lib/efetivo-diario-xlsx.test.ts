import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as XLSX from "xlsx";

import {
  buildEfetivoDiarioWorkbook,
  efetivoDiarioXlsxFilename,
  type EfetivoDiarioWorkbookInput,
} from "./efetivo-diario-xlsx.ts";

const input: EfetivoDiarioWorkbookInput = {
  data: "2026-08-18",
  obra: "237.3 - Costa Verde",
  linhas: [
    {
      funcionario: "Ana Souza",
      funcao: "Ajudante",
      especialidadeAjudante: "civil",
      situacao: "Horas trabalhadas",
      horasNormais: 9,
      horasExtra50: 1.5,
      horasExtra100: 0,
      totalHoras: 10.5,
      observacoes: "Equipe A",
    },
    {
      funcionario: "Bruno Lima",
      funcao: "Montador I",
      situacao: "Alocado — sem apontamento",
      horasNormais: 0,
      horasExtra50: 0,
      horasExtra100: 0,
      totalHoras: 0,
    },
  ],
};

test("exporta todo o efetivo diário com situação e horas classificadas", () => {
  const workbook = buildEfetivoDiarioWorkbook(input);
  const sheet = workbook.Sheets["Efetivo do dia"];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
  });

  assert.equal(rows.length, 3);
  assert.equal(XLSX.utils.format_cell(sheet.A2), "18/08/2026");
  assert.equal(XLSX.utils.format_cell(sheet.A3), "18/08/2026");
  assert.deepEqual(rows[0], [
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
  ]);
  assert.deepEqual(rows[1]?.slice(1), [
    "237.3 - Costa Verde",
    "Ana Souza",
    "Ajudante",
    "Civil",
    "Horas trabalhadas",
    9,
    1.5,
    0,
    10.5,
    "Equipe A",
  ]);
  assert.equal(rows[2]?.[2], "Bruno Lima");
  assert.equal(rows[2]?.[5], "Alocado — sem apontamento");
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
