import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  conciliarCentroCusto,
  criarIndiceCentrosExistentes,
  interpretarCentroCusto,
} from "./importacao-legado-centros.ts";

test("interpreta numero e texto sem sufixo como mao de obra indireta", () => {
  assert.deepEqual(interpretarCentroCusto(230), {
    codigoBase: "230",
    tipoMaoObra: "indireta",
    valorOriginal: "230",
  });
  assert.equal(interpretarCentroCusto("230")?.tipoMaoObra, "indireta");
});

test("interpreta M e C sem incorporar o sufixo ao codigo-base", () => {
  assert.equal(interpretarCentroCusto("230-M")?.codigoBase, "230");
  assert.equal(interpretarCentroCusto("230-M")?.tipoMaoObra, "montagem");
  assert.equal(interpretarCentroCusto("230-C")?.codigoBase, "230");
  assert.equal(interpretarCentroCusto("230-C")?.tipoMaoObra, "civil");
});

test("aceita minusculas, espacos e hifens equivalentes", () => {
  assert.equal(interpretarCentroCusto(" 230 - m ")?.tipoMaoObra, "montagem");
  assert.equal(interpretarCentroCusto("230–c")?.tipoMaoObra, "civil");
});

test("preserva zeros a esquerda em celulas textuais", () => {
  assert.equal(interpretarCentroCusto("00230-M")?.codigoBase, "00230");
});

test("concilia primeiro por obras.codigo", () => {
  const obra = { id: "codigo", nome: "ETE Sul", codigo: "230" };
  const indice = criarIndiceCentrosExistentes([obra]);
  assert.equal(conciliarCentroCusto(interpretarCentroCusto("230")!, indice)?.id, "codigo");
});

test("concilia pelo prefixo numerico do nome quando codigo estiver ausente", () => {
  const obra = { id: "nome", nome: "230 - IGUA ETE SUL", codigo: null };
  const indice = criarIndiceCentrosExistentes([obra]);
  assert.equal(conciliarCentroCusto(interpretarCentroCusto("230-M")!, indice)?.id, "nome");
});

test("230, 230-M e 230-C usam o mesmo obra_id e mantem tipos distintos", () => {
  const indice = criarIndiceCentrosExistentes([{ id: "obra-230", nome: "230 - Obra" }]);
  const valores = ["230", "230-M", "230-C"].map((valor) => interpretarCentroCusto(valor)!);
  assert.deepEqual(
    valores.map((valor) => conciliarCentroCusto(valor, indice)?.id),
    ["obra-230", "obra-230", "obra-230"],
  );
  assert.deepEqual(
    valores.map((valor) => valor.tipoMaoObra),
    ["indireta", "montagem", "civil"],
  );
});

test("centro inexistente nao e conciliado nem criado", () => {
  const indice = criarIndiceCentrosExistentes([{ id: "obra-230", nome: "230 - Obra" }]);
  assert.equal(conciliarCentroCusto(interpretarCentroCusto("999-M")!, indice), null);
});

test("concilia os 20 codigos-base da planilha de referencia", () => {
  const codigos = [
    "173",
    "199",
    "212",
    "213",
    "216",
    "229",
    "230",
    "233",
    "235",
    "236",
    "237",
    "238",
    "239",
    "240",
    "241",
    "246",
    "250",
    "252",
    "253",
    "254",
  ];
  const indice = criarIndiceCentrosExistentes(
    codigos.map((codigo) => ({ id: `obra-${codigo}`, nome: `${codigo} - Centro existente` })),
  );
  const variacoes = codigos.flatMap((codigo) => [codigo, `${codigo}-M`, `${codigo}-C`]);

  assert.equal(indice.size, 20);
  for (const valor of variacoes) {
    const interpretado = interpretarCentroCusto(valor)!;
    assert.equal(conciliarCentroCusto(interpretado, indice)?.id, `obra-${interpretado.codigoBase}`);
  }
});

test("fluxo de confirmacao nao contem insert em obras nem lista de centros a criar", () => {
  const componente = readFileSync(
    new URL("../components/ImportarPlanilhaLegadoDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(componente, /from\(["']obras["']\)\.insert/);
  assert.doesNotMatch(componente, /obrasCriar|Centros de custo a criar/);
  assert.match(componente, /obrasNaoEncontradas/);
  assert.match(componente, /preview\.bloqueado/);
});
