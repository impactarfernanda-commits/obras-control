import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  inicioDaSemanaSegunda,
  ordenarFuncionariosPorTipoENome,
  semanaInicialDaCompetencia,
} from "./alocacoes-visualizacao.ts";

const iso = (data: Date) =>
  `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(
    data.getDate(),
  ).padStart(2, "0")}`;

test("competencia atual abre na semana atual, de segunda a domingo", () => {
  for (const [hoje, esperado] of [
    ["2026-08-14", "2026-08-10"],
    ["2026-08-10", "2026-08-10"],
    ["2026-08-16", "2026-08-10"],
    ["2026-08-17", "2026-08-17"],
  ]) {
    assert.equal(iso(semanaInicialDaCompetencia(2026, 7, new Date(`${hoje}T12:00:00`))), esperado);
  }
  assert.equal(inicioDaSemanaSegunda(new Date("2026-08-16T12:00:00")).getDay(), 1);
});

test("competencias passada e futura abrem na primeira semana que intersecta o mes", () => {
  const hoje = new Date("2026-08-14T12:00:00");
  assert.equal(iso(semanaInicialDaCompetencia(2026, 6, hoje)), "2026-06-29");
  assert.equal(iso(semanaInicialDaCompetencia(2026, 8, hoje)), "2026-08-31");
});

test("troca de competencia recalcula, mas rerender da mesma competencia preserva navegacao", () => {
  const hoje = new Date("2026-08-14T12:00:00");
  assert.equal(iso(semanaInicialDaCompetencia(2026, 6, hoje)), "2026-06-29");
  assert.equal(iso(semanaInicialDaCompetencia(2026, 7, hoje)), "2026-08-10");
  assert.equal(iso(semanaInicialDaCompetencia(2026, 6, hoje)), "2026-06-29");

  const chaveAntes = iso(semanaInicialDaCompetencia(2026, 7, hoje));
  const semanaNavegada = "2026-08-17";
  const chaveDepois = iso(semanaInicialDaCompetencia(2026, 7, hoje));
  assert.equal(chaveDepois, chaveAntes);
  assert.equal(semanaNavegada, "2026-08-17");
});

test("ordena MOI, MOD e desconhecidos por nome pt-BR sem mutar a entrada", () => {
  const categorias = [
    { nome: "Administrativo", tipo: "MOI" as const },
    { nome: "Pedreiro", tipo: "MOD" as const },
  ];
  const entrada = [
    { nome: "Zulu", categoria_mo: null },
    { nome: "Érica", categoria_mo: "Pedreiro" },
    { nome: "Álvaro", categoria_mo: "Administrativo" },
    { nome: "Bruno", categoria_mo: "Administrativo" },
    { nome: "Carlos", categoria_mo: "Pedreiro" },
  ];
  const copia = entrada.slice();
  const ordenados = ordenarFuncionariosPorTipoENome(
    entrada,
    categorias,
    (funcionario) => funcionario.categoria_mo,
  );
  assert.deepEqual(
    ordenados.map((funcionario) => funcionario.nome),
    ["Álvaro", "Bruno", "Carlos", "Érica", "Zulu"],
  );
  assert.deepEqual(entrada, copia);
});

test("Calendario e Grade semanal usam o mesmo helper de ordenacao", () => {
  const calendario = readFileSync("src/routes/_authenticated/alocacoes.tsx", "utf8");
  const grade = readFileSync("src/components/RegistrosGrid.tsx", "utf8");
  assert.match(calendario, /ordenarFuncionariosPorTipoENome\(/);
  assert.match(grade, /ordenarFuncionariosPorTipoENome\(/);
  assert.match(calendario, /initialWeekStart=\{semanaInicial\}/);
});
