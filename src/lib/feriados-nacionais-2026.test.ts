import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calcularJornadaDetalhada } from "./jornada-horas.ts";
import { datasUteisNoIntervalo } from "./relatorio-sem-alocacao.ts";

const raiz = new URL("../../", import.meta.url);
const ler = (caminho: string) => readFileSync(new URL(caminho, raiz), "utf8");
const migration = ler("supabase/migrations/20261015120000_adiciona_feriados_nacionais_2026.sql");
const prevalidar = ler("supabase/manual/prevalidar_feriados_nacionais_2026.sql");
const dryRun = ler("supabase/manual/testar_feriados_nacionais_2026.sql");
const rollback = ler("supabase/manual/validar_rollback_feriados_nacionais_2026.sql");

const feriadosNovos = ["2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"];
const feriados = new Set(["2026-09-07", ...feriadosNovos]);

test("migration de dados e idempotente, ativa as datas e nao duplica 07/09", () => {
  for (const data of feriadosNovos) assert.match(migration, new RegExp(data));
  assert.doesNotMatch(migration, /2026-09-07/);
  assert.match(migration, /ON CONFLICT \(data\) DO UPDATE/);
  assert.match(migration, /SET ativo = true/);
  assert.doesNotMatch(migration, /CREATE TABLE|ALTER TABLE|DROP TABLE/i);
});

test("feriados sem expediente nao entram em Sem alocacao e dia util comum permanece", () => {
  for (const data of feriadosNovos) {
    assert.deepEqual(datasUteisNoIntervalo(data, data, feriados), []);
  }
  assert.deepEqual(datasUteisNoIntervalo("2026-10-13", "2026-10-13", feriados), ["2026-10-13"]);
});

test("jornada em cada feriado permanece valida e integralmente HE 100%", () => {
  for (const data of ["2026-09-07", ...feriadosNovos]) {
    const resultado = calcularJornadaDetalhada({
      data,
      horaEntrada: "07:00",
      horaSaida: "16:00",
      intervaloMinutos: 60,
      feriados,
    });
    assert.equal(resultado.valido, true, data);
    assert.equal(resultado.minutosHe100, 480, data);
    assert.equal(resultado.minutosNormais, 0, data);
    assert.equal(resultado.minutosHe50, 0, data);
  }
});

test("dias disponiveis excluem feriado util sem regressao de fim de semana", () => {
  assert.equal(datasUteisNoIntervalo("2026-10-01", "2026-10-31").length, 22);
  assert.equal(datasUteisNoIntervalo("2026-10-01", "2026-10-31", feriados).length, 21);
  assert.equal(datasUteisNoIntervalo("2026-11-01", "2026-11-30").length, 21);
  assert.equal(datasUteisNoIntervalo("2026-11-01", "2026-11-30", feriados).length, 19);
  assert.deepEqual(datasUteisNoIntervalo("2026-11-14", "2026-11-15", feriados), []);
});

test("scripts manuais cobrem estrutura, dry run funcional e rollback sem executar SQL", () => {
  for (const termo of [
    "information_schema.columns",
    "pg_constraint",
    "pg_policies",
    "relrowsecurity",
    "has_table_privilege",
    "2026-09-07",
  ])
    assert.match(prevalidar, new RegExp(termo));
  assert.match(dryRun, /^-- DRY RUN[\s\S]*\bBEGIN;[\s\S]*\bROLLBACK;\s*$/);
  for (const termo of [
    "sem_alocacao",
    "minutos_he_100",
    "dias_disponiveis",
    "dias_alocados",
    "guard_extras_requerem_normais",
    "relatorio_alocacao_centro_custo",
  ])
    assert.match(dryRun, new RegExp(termo));
  assert.match(rollback, /SOMENTE LEITURA/);
  assert.doesNotMatch(rollback, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
});

test("dry run retorna os 14 indicadores em uma unica linha e preserva a migration literal", () => {
  assert.match(dryRun, /\bBEGIN;/);
  assert.match(dryRun, /\bROLLBACK;\s*$/);
  assert.doesNotMatch(dryRun, /\bCOMMIT\b/i);
  const corpoMigration = migration.match(/INSERT INTO[\s\S]*;\s*$/)?.[0].trim();
  assert.ok(corpoMigration);
  assert.ok(dryRun.includes(corpoMigration));

  const indicadores = [...dryRun.matchAll(/AS "(\d{2}_[^"]+)"/g)].map((item) => item[1]);
  assert.deepEqual(
    indicadores.map((nome) => nome.slice(0, 2)),
    Array.from({ length: 14 }, (_, indice) => String(indice + 1).padStart(2, "0")),
  );
  assert.equal(new Set(indicadores).size, 14);
  assert.equal((dryRun.match(/^SELECT\b/gm) ?? []).length, 1);
  assert.match(dryRun, /FROM indicadores i;\s*\n\s*ROLLBACK;/);
  assert.match(dryRun, /AS dry_run_aprovado/);
});
