import assert from "node:assert/strict";
import test from "node:test";

import {
  agruparPendenciasClassificacaoAjudante,
  alocacaoPendenteClassificacaoAjudante,
  filtrarAlocacoesSelecionadas,
  filtrarPendenciasClassificacaoAjudante,
} from "./pendencias-classificacao-ajudante.ts";

const alocacao = (id: string, data: string, especialidade: "civil" | "montagem" | null = null) => ({
  id,
  funcionario_id: id,
  obra_id: "obra-1",
  data,
  especialidade_ajudante: especialidade,
});

const pendencia = (id: string, funcionario_id: string, obra_id: string, data: string) => ({
  id,
  funcionario_id,
  obra_id,
  data,
  especialidade_ajudante: null,
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

test("dez pendencias do mesmo funcionario, obra e competencia formam um grupo", () => {
  const registros = Array.from({ length: 10 }, (_, indice) =>
    pendencia(`a-${indice}`, "func-1", "obra-1", `2026-08-${String(indice + 1).padStart(2, "0")}`),
  );
  const grupos = agruparPendenciasClassificacaoAjudante(registros);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].quantidade, 10);
  assert.equal(grupos[0].dataInicio, "2026-08-01");
  assert.equal(grupos[0].dataFim, "2026-08-10");
});

test("mesmo funcionario em obras diferentes forma grupos diferentes", () => {
  const grupos = agruparPendenciasClassificacaoAjudante([
    pendencia("a", "func-1", "obra-1", "2026-08-01"),
    pendencia("b", "func-1", "obra-2", "2026-08-02"),
  ]);
  assert.equal(grupos.length, 2);
});

test("mesmo funcionario em competencias diferentes forma grupos diferentes", () => {
  const grupos = agruparPendenciasClassificacaoAjudante([
    pendencia("a", "func-1", "obra-1", "2026-08-24"),
    pendencia("b", "func-1", "obra-1", "2026-08-25"),
  ]);
  assert.equal(grupos.length, 2);
  assert.deepEqual(
    grupos.map(({ competencia }) => competencia),
    ["2026-08", "2026-09"],
  );
});

test("grupo parcial recebe apenas os registros que continuam pendentes", () => {
  const registros = [
    pendencia("nulo", "func-1", "obra-1", "2026-08-01"),
    {
      ...pendencia("civil", "func-1", "obra-1", "2026-08-02"),
      especialidade_ajudante: "civil" as const,
    },
    {
      ...pendencia("montagem", "func-1", "obra-1", "2026-08-03"),
      especialidade_ajudante: "montagem" as const,
    },
  ];
  const pendentes = filtrarPendenciasClassificacaoAjudante(
    registros,
    new Map([["func-1", "AJUDANTE"]]),
  );
  const grupos = agruparPendenciasClassificacaoAjudante(pendentes);
  assert.equal(grupos.length, 1);
  assert.deepEqual(
    grupos[0].alocacoes.map(({ id }) => id),
    ["nulo"],
  );
});
