import assert from "node:assert/strict";
import test from "node:test";

import {
  alocacaoPendenteClassificacaoAjudante,
  filtrarAlocacoesSelecionadas,
  filtrarPendenciasClassificacaoAjudante,
} from "./pendencias-classificacao-ajudante.ts";

const alocacao = (id: string, data: string, especialidade: "civil" | "montagem" | null = null) => ({
  id,
  funcionario_id: id,
  data,
  especialidade_ajudante: especialidade,
});

test("julho/2026 nao aparece como pendencia", () => {
  assert.equal(
    alocacaoPendenteClassificacaoAjudante(alocacao("f1", "2026-07-24"), "AJUDANTE"),
    false,
  );
});

test("competencia agosto/2026 com AJUDANTE NULL aparece", () => {
  assert.equal(
    alocacaoPendenteClassificacaoAjudante(alocacao("f1", "2026-07-25"), "AJUDANTE"),
    true,
  );
});

test("AJUDANTE civil ou montagem nao aparece", () => {
  assert.equal(
    alocacaoPendenteClassificacaoAjudante(alocacao("f1", "2026-07-26", "civil"), "AJUDANTE"),
    false,
  );
  assert.equal(
    alocacaoPendenteClassificacaoAjudante(alocacao("f1", "2026-07-27", "montagem"), "AJUDANTE"),
    false,
  );
});

test("nao-AJUDANTE nao aparece", () => {
  assert.equal(
    alocacaoPendenteClassificacaoAjudante(alocacao("f1", "2026-07-26"), "PEDREIRO"),
    false,
  );
});

test("filtro usa a categoria canonica de cada funcionario", () => {
  const registros = [alocacao("ajudante", "2026-07-26"), alocacao("pedreiro", "2026-07-26")];
  const categorias = new Map([
    ["ajudante", "AJUDANTE"],
    ["pedreiro", "PEDREIRO"],
  ]);
  assert.deepEqual(
    filtrarPendenciasClassificacaoAjudante(registros, categorias).map(({ id }) => id),
    ["ajudante"],
  );
});

test("lote altera somente os ids selecionados", () => {
  const registros = [
    alocacao("a", "2026-07-26"),
    alocacao("b", "2026-07-27"),
    alocacao("c", "2026-07-28"),
  ];
  assert.deepEqual(
    filtrarAlocacoesSelecionadas(registros, new Set(["a", "c"])).map(({ id }) => id),
    ["a", "c"],
  );
});
