import assert from "node:assert/strict";
import test from "node:test";

import { calcularCompetencia } from "./competencias.ts";
import {
  CATEGORIAS_MOD_CIVIL_CONHECIDAS,
  CATEGORIAS_MOD_MONTAGEM_CONHECIDAS,
  categoriaEhAjudante,
  classificarTipoMod,
  competenciaUsaSegmentacaoMod,
} from "./especialidade-ajudante.ts";

test("segmentacao inicia na competencia agosto/2026 pelo ciclo canonico 25 a 24", () => {
  assert.equal(competenciaUsaSegmentacaoMod(calcularCompetencia("2026-07-24").competencia), false);
  assert.equal(competenciaUsaSegmentacaoMod(calcularCompetencia("2026-07-26").competencia), true);
});

test("reconhece somente a categoria canonica AJUDANTE", () => {
  assert.equal(categoriaEhAjudante("AJUDANTE"), true);
  assert.equal(categoriaEhAjudante("ajudante"), true);
  assert.equal(categoriaEhAjudante("PEDREIRO"), false);
  assert.equal(categoriaEhAjudante("MONTADOR I"), false);
});

test("classifica a matriz civil, montagem e pendencias sem fallback silencioso", () => {
  assert.equal(classificarTipoMod("PEDREIRO", null), "Civil");
  assert.equal(classificarTipoMod("MESTRE DE OBRAS I", null), "Civil");
  assert.equal(classificarTipoMod("MESTRE DE OBRAS", null), "Civil");
  assert.equal(classificarTipoMod("OPERADOR DE RETROESCAVADEIRA", null), "Civil");
  assert.equal(classificarTipoMod("OPERADOR DE RETRO", null), "Civil");
  assert.equal(classificarTipoMod("MONTADOR I", null), "Montagem");
  assert.equal(classificarTipoMod("MONTADOR", null), "Montagem");
  assert.equal(classificarTipoMod("AJUDANTE", "civil"), "Civil");
  assert.equal(classificarTipoMod("AJUDANTE", "montagem"), "Montagem");
  assert.equal(classificarTipoMod("AJUDANTE", null), "A classificar");
  assert.equal(classificarTipoMod("OPERADOR DE ESCAVADEIRA", null), "Civil");
  assert.equal(classificarTipoMod("OPERADOR ESCAVADEIRA", null), "Civil");
  assert.notEqual(classificarTipoMod("OPERADOR DE ESCAVADEIRA", null), "A classificar");
  assert.notEqual(classificarTipoMod("OPERADOR ESCAVADEIRA", null), "A classificar");
  assert.equal(classificarTipoMod("CATEGORIA MOD FUTURA", null), "A classificar");
});

test("normaliza todas as variacoes de Mestre de Obra como MOD Civil", () => {
  for (const categoria of [
    "MESTRE DE OBRA",
    "MESTRE DE OBRA I",
    "MESTRE DE OBRA II",
    "MESTRE DE OBRAS",
    "MESTRE DE OBRAS I",
    "MESTRE DE OBRAS II",
    "mestre de obra i",
    "  méstre   de   óbra ii  ",
  ]) {
    assert.equal(classificarTipoMod(categoria, null), "Civil", categoria);
  }
});

test("todas as categorias MOD conhecidas possuem destino salvo AJUDANTE dependente da alocacao", () => {
  for (const categoria of CATEGORIAS_MOD_CIVIL_CONHECIDAS)
    assert.equal(classificarTipoMod(categoria, null), "Civil", categoria);
  for (const categoria of CATEGORIAS_MOD_MONTAGEM_CONHECIDAS)
    assert.equal(classificarTipoMod(categoria, null), "Montagem", categoria);

  assert.equal(classificarTipoMod("AJUDANTE", null), "A classificar");
  assert.equal(classificarTipoMod("AJUDANTE", "civil"), "Civil");
  assert.equal(classificarTipoMod("AJUDANTE", "montagem"), "Montagem");
});
