import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { tipoEfetivoMapeamento } from "./planejamento-hh-core.ts";
import { parseOrcamentoBuffer } from "./planejamento-hh-parser.ts";

function workbookMinimo() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Função", "Quantidade", "Base de horas", "Custo previsto"],
      ["Engenheiro", 2, 200, 50000],
    ]),
    "MO",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Função", "HH previsto", "Custo previsto"],
      ["Ajudante", 100, 3000],
      ["Ajudante", 50, 1500],
    ]),
    "EAP",
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["CPU", "Recurso"]]), "CPUs");
  wb.Workbook = {
    Sheets: [
      { name: "MO", Hidden: 1 },
      { name: "EAP", Hidden: 0 },
      { name: "CPUs", Hidden: 0 },
    ],
  };
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

test("parser le aba oculta e consolida a mesma funcao", () => {
  const previa = parseOrcamentoBuffer(workbookMinimo());
  assert.deepEqual(previa.erros, []);
  assert.equal(previa.itens.find((i) => i.funcaoOrcamento === "Engenheiro")?.hhPrevisto, 400);
  assert.equal(previa.itens.find((i) => i.funcaoOrcamento === "Ajudante")?.hhPrevisto, 150);
});

test("parser nao soma biblioteca de CPUs e acusa aba obrigatoria ausente", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Função", "HH previsto", "Custo previsto"],
      ["Nao usada", 999, 999],
    ]),
    "CPUs",
  );
  const previa = parseOrcamentoBuffer(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  assert.equal(previa.itens.length, 0);
  assert.ok(previa.erros.some((e) => e.includes("EAP")));
});

test("parser usa apenas CPUs referenciadas na EAP e respeita produtividade", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Função", "HH previsto", "Custo previsto"],
      ["Engenheiro", 10, 1000],
    ]),
    "MO",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["CPU", "Quantidade"],
      ["C1", 100],
    ]),
    "EAP",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["CPU", "Recurso", "Coeficiente", "Produtividade", "Custo unitário"],
      ["C1", "Montador", 2, 4, 30],
      ["NAO-USADA", "Ajudante", 999, 1, 20],
    ]),
    "CPUs",
  );
  const previa = parseOrcamentoBuffer(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  assert.equal(previa.itens.find((i) => i.funcaoOrcamento === "Montador")?.hhPrevisto, 50);
  assert.equal(
    previa.itens.some((i) => i.funcaoOrcamento === "Ajudante"),
    false,
  );
});

test("parser interpreta o leiaute real com CalculaCPUs, MO em blocos e custo cacheado", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["EAP"]]), "EAP");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      [
        "CÓDIGO",
        "REFERÊNCIA",
        "DESCRIÇÃO SERVIÇO",
        "UNIDADE",
        "QUANTIDADE",
        "CUSTO",
        null,
        null,
        null,
      ],
      ["CPU1", "CPU", "Serviço usado", "UN", 10, 100, null, null, 1],
      ["CPU1", "CPU", "Serviço usado", "UN", 10, 100, null, null, 2],
      ["NAOEXISTE", "CPU", "Serviço sem biblioteca", "UN", 1, 1, null, null, 1],
      ["ADLC01", "CPU", "Administração local", "UN", 1, 1, null, null, 1],
    ]),
    "CalculaCPUs",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      [
        "CÓDIGO",
        "DESCRIÇÃO DA COMPOSIÇÃO",
        "UNIDADE",
        "Prod. Equipe",
        null,
        "CÓDIGO INSUMO",
        "RECURSO",
        "UNIDADE",
        "GRUPO",
        null,
        null,
        "Indice",
        null,
        null,
        null,
        "Custo na Composicao",
      ],
      [
        "CPU1",
        "Serviço usado",
        "UN",
        2,
        null,
        "1",
        "Ajudante",
        "H",
        "H",
        null,
        null,
        3,
        null,
        null,
        null,
        20,
      ],
      [
        "CPU1",
        "Serviço usado",
        "UN",
        2,
        null,
        "2",
        "Material",
        "UN",
        "M",
        null,
        null,
        4,
        null,
        null,
        null,
        50,
      ],
      [
        "NAOUSADA",
        "Serviço não usado",
        "UN",
        1,
        null,
        "3",
        "Pedreiro",
        "H",
        "H",
        null,
        null,
        999,
        null,
        null,
        null,
        999,
      ],
      [
        "ADLC01",
        "Administração local",
        "UN",
        1,
        null,
        "4",
        "Engenheiro",
        "H",
        "H",
        null,
        null,
        220,
        null,
        null,
        null,
        1,
      ],
    ]),
    "CPUs",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Equipe"],
      ["DESCRIÇÃO", "PERMANÊNCIA"],
      ["Engenheiro", 2, null, null, null, null, null, null, null, 100, 20, 30, 40],
      [],
      ["Montador", 1, null, null, null, null, null, null, null, 50, 10, 5, 0],
    ]),
    "MO",
  );
  const previa = parseOrcamentoBuffer(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  assert.equal(previa.erros.length, 1);
  assert.equal(previa.itens.find((i) => i.funcaoOrcamento === "Ajudante")?.hhPrevisto, 15);
  assert.equal(previa.itens.find((i) => i.funcaoOrcamento === "Ajudante")?.custoPrevisto, 200);
  assert.equal(previa.itens.find((i) => i.funcaoOrcamento === "Engenheiro")?.hhPrevisto, 440);
  assert.equal(previa.itens.find((i) => i.funcaoOrcamento === "Engenheiro")?.custoPrevisto, 190);
  assert.equal(previa.itens.find((i) => i.funcaoOrcamento === "Montador")?.hhPrevisto, 220);
  assert.equal(
    previa.itens.some((i) => i.funcaoOrcamento === "Pedreiro"),
    false,
  );
  assert.ok(previa.erros.some((erro) => erro.includes("NAOEXISTE")));
});

test("Matinhos preserva totais e move Mestre de obras I para o subtotal MOD confirmado", () => {
  const previa = parseOrcamentoBuffer(
    readFileSync("doc/amostras-hh/Planilha de atividades - SANEPAR Matinhos.xlsm"),
  );
  const tiposCategorias = new Map([["MESTRE DE OBRA I", "MOD" as const]]);
  const itensEfetivos = previa.itens.map((item) => ({
    ...item,
    tipoEfetivo:
      item.funcaoOrcamento === "Mestre de obras I"
        ? tipoEfetivoMapeamento(item.tipoMo, "MESTRE DE OBRA I", tiposCategorias)
        : item.tipoMo,
  }));
  const mestre = itensEfetivos.find((item) => item.funcaoOrcamento === "Mestre de obras I");
  assert.equal(mestre?.tipoMo, "MOI");
  assert.equal(mestre?.tipoEfetivo, "MOD");
  assert.equal(mestre?.hhPrevisto, 990);
  assert.equal(mestre?.custoPrevisto, 49036.23);
  assert.ok(
    previa.erros.some((erro) => erro.includes("ABA")),
    "CPU ABA deve continuar como pendência de ativação",
  );
  const totalHH = itensEfetivos.reduce((soma, item) => soma + item.hhPrevisto, 0);
  const totalCusto = itensEfetivos.reduce((soma, item) => soma + item.custoPrevisto, 0);
  const subtotal = (tipo: "MOI" | "MOD", campo: "hhPrevisto" | "custoPrevisto") =>
    itensEfetivos
      .filter((item) => item.tipoEfetivo === tipo)
      .reduce((soma, item) => soma + item[campo], 0);
  assert.ok(Math.abs(totalHH - 23634.4567) < 0.0001);
  assert.ok(Math.abs(totalCusto - 781380.9514) < 0.0001);
  assert.ok(Math.abs(subtotal("MOI", "hhPrevisto") - 4510) < 0.0001);
  assert.ok(Math.abs(subtotal("MOD", "hhPrevisto") - 19124.4567) < 0.0001);
  assert.ok(Math.abs(subtotal("MOI", "custoPrevisto") - 201757.7525) < 0.0001);
  assert.ok(Math.abs(subtotal("MOD", "custoPrevisto") - 579623.1989) < 0.0001);
});
