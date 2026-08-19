import assert from "node:assert/strict";
import test from "node:test";

import {
  especialidadeNovaAlocacao,
  funcionariosAjudantesSemEspecialidade,
  resolverEspecialidadeAjudante,
  sugerirEspecialidadePeriodo,
  type RegistroEspecialidadeAjudante,
} from "./resolver-especialidade-ajudante.ts";

const registro = (
  especialidade_ajudante: "civil" | "montagem" | null,
  data = "2026-08-10",
  obra_id = "obra-1",
): RegistroEspecialidadeAjudante => ({
  funcionario_id: "func-1",
  obra_id,
  data,
  especialidade_ajudante,
});

const resolver = (
  historico: RegistroEspecialidadeAjudante[],
  especialidadeOrigem: "civil" | "montagem" | null = null,
) =>
  resolverEspecialidadeAjudante({
    funcionarioId: "func-1",
    obraId: "obra-1",
    competencia: "2026-08",
    dataDestino: "2026-08-17",
    especialidadeOrigem,
    historico,
  });

test("cópia preserva AJUDANTE Civil como Civil", () => {
  assert.deepEqual(resolver([registro("montagem")], "civil"), {
    estado: "resolvida",
    especialidade: "civil",
    origem: "alocacao_origem",
  });
});

test("cópia preserva AJUDANTE Montagem como Montagem", () => {
  assert.equal(resolver([], "montagem").especialidade, "montagem");
});

test("origem NULL reutiliza historico unico da mesma obra e competencia", () => {
  assert.equal(resolver([registro("civil")]).especialidade, "civil");
  assert.equal(resolver([registro("montagem")]).especialidade, "montagem");
  assert.equal(resolver([registro("civil", "2026-08-10", "outra-obra")]).estado, "indefinida");
  assert.equal(resolver([registro("civil", "2026-08-25")]).estado, "indefinida");
});

test("historico conflitante ou ausente exige escolha", () => {
  assert.equal(
    resolver([registro("civil"), registro("montagem", "2026-08-12")]).estado,
    "conflitante",
  );
  assert.equal(resolver([]).estado, "indefinida");
});

test("periodo sugere somente quando todas as competencias concordam", () => {
  const historico = [registro("civil"), registro("civil", "2026-08-26")];
  assert.equal(
    sugerirEspecialidadePeriodo({
      funcionarioId: "func-1",
      obraId: "obra-1",
      competencias: ["2026-08", "2026-09"],
      historico,
    }).especialidade,
    "civil",
  );
  assert.equal(
    sugerirEspecialidadePeriodo({
      funcionarioId: "func-1",
      obraId: "obra-1",
      competencias: ["2026-08", "2026-09"],
      historico: [registro("civil"), registro("montagem", "2026-08-26")],
    }).estado,
    "conflitante",
  );
});

test("periodo sem historico completo nao cria preferencia permanente", () => {
  assert.equal(
    sugerirEspecialidadePeriodo({
      funcionarioId: "func-1",
      obraId: "obra-1",
      competencias: ["2026-08", "2026-09"],
      historico: [registro("civil")],
    }).estado,
    "indefinida",
  );
});

test("nao-AJUDANTE sempre recebe especialidade NULL", () => {
  assert.equal(
    especialidadeNovaAlocacao({
      ajudante: false,
      resolucao: { estado: "resolvida", especialidade: "civil", origem: "historico" },
      escolha: "montagem",
    }),
    null,
  );
});

test("equipe com tres ajudantes resolvidos nao bloqueia a copia", () => {
  const resolvida = { estado: "resolvida", especialidade: "civil", origem: "historico" } as const;
  const itens = ["a", "b", "c"].map((funcionario_id) => ({
    funcionario_id,
    status: "adicionar",
    ajudante: true,
    resolucao: resolvida,
  }));
  assert.deepEqual(funcionariosAjudantesSemEspecialidade(itens, {}), []);
});

test("somente o ajudante indefinido exige decisao na equipe mista", () => {
  const itens = [
    {
      funcionario_id: "resolvido",
      status: "adicionar",
      ajudante: true,
      resolucao: { estado: "resolvida", especialidade: "civil", origem: "historico" } as const,
    },
    {
      funcionario_id: "indefinido",
      status: "adicionar",
      ajudante: true,
      resolucao: { estado: "indefinida", especialidade: null, origem: null } as const,
    },
    { funcionario_id: "pedreiro", status: "adicionar", ajudante: false, resolucao: null },
  ];
  assert.deepEqual(
    funcionariosAjudantesSemEspecialidade(itens, {}).map(({ funcionario_id }) => funcionario_id),
    ["indefinido"],
  );
  assert.deepEqual(funcionariosAjudantesSemEspecialidade(itens, { indefinido: "montagem" }), []);
});
