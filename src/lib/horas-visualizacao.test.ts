import assert from "node:assert/strict";
import test from "node:test";

import { comporHorasParaVisualizacao } from "./horas-visualizacao.ts";

const textos = (entrada: Parameters<typeof comporHorasParaVisualizacao>[0]) =>
  comporHorasParaVisualizacao(entrada).linhas.map((linha) => linha.texto);

test("sábado com 10h brutas exibe somente HE 50%", () => {
  assert.deepEqual(textos({ data: "2026-08-08", horasNormais: 10, horasExtras: 0 }), [
    "10h HE 50%",
  ]);
});

test("domingo com 8h exibe somente HE 100%", () => {
  assert.deepEqual(textos({ data: "2026-08-09", horasNormais: 8, horasExtras: 0 }), ["8h HE 100%"]);
});

test("dia comum com 9h normais não cria parcela extra", () => {
  assert.deepEqual(textos({ data: "2026-08-10", horasNormais: 9, horasExtras: 0 }), ["9h normais"]);
});

test("dia comum misto mostra as parcelas sem repetir o total", () => {
  assert.deepEqual(textos({ data: "2026-08-10", horasNormais: 9, horasExtras: 1.5 }), [
    "9h normais",
    "1,5h HE 50%",
  ]);
});

test("sexta com 10,5h mostra 8h normais e 2,5h HE 50%", () => {
  assert.deepEqual(textos({ data: "2026-08-07", horasNormais: 8, horasExtras: 2.5 }), [
    "8h normais",
    "2,5h HE 50%",
  ]);
});

test("classificação visual conserva o total bruto", () => {
  const casos = [
    { data: "2026-08-07", horasNormais: 8, horasExtras: 2.5 },
    { data: "2026-08-08", horasNormais: 10, horasExtras: 0 },
    { data: "2026-08-09", horasNormais: 6, horasExtras: 2 },
  ];
  for (const caso of casos) {
    const composicao = comporHorasParaVisualizacao(caso);
    assert.equal(
      composicao.horasNormaisApuradas +
        composicao.horasExtra50Apuradas +
        composicao.horasExtra100Apuradas,
      caso.horasNormais + caso.horasExtras,
    );
  }
});

test("nenhuma composição repete o total bruto como uma parcela extra", () => {
  for (const caso of [
    { data: "2026-08-10", horasNormais: 9, horasExtras: 1.5 },
    { data: "2026-08-08", horasNormais: 10, horasExtras: 0 },
    { data: "2026-08-09", horasNormais: 8, horasExtras: 0 },
  ]) {
    const composicao = comporHorasParaVisualizacao(caso);
    assert.equal(
      composicao.linhas.some((linha) => linha.texto === `${composicao.total}h`),
      false,
    );
    assert.equal(
      composicao.linhas.reduce((soma, linha) => soma + linha.horas, 0),
      composicao.total,
    );
  }
});
