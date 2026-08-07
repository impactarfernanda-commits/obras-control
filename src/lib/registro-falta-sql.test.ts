import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202608060001_adiciona_registro_falta.sql";
const dryRunPath = "supabase/manual/DRY_RUN_202608060001_adiciona_registro_falta.sql";
const verificationPath = "supabase/manual/verificar_registro_falta.sql";

function normalizarSql(sql: string) {
  return sql
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((linha) => linha.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

function removerComentariosELiterais(sql: string) {
  return sql.replace(/--[^\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");
}

test("dry run autocontido representa integralmente a migration na mesma ordem", () => {
  const migrationBytes = readFileSync(migrationPath);
  const migration = migrationBytes.toString("utf8");
  const dryRun = normalizarSql(readFileSync(dryRunPath, "utf8"));

  assert.equal(
    createHash("sha256").update(migrationBytes).digest("hex"),
    "44232f276484944d6997607ac5c2a09d553852397723e57368271abda0290f01",
    "a migration original não deve ser alterada por esta correção",
  );
  assert.match(dryRun, /^BEGIN;\n/);
  assert.match(dryRun, /\nROLLBACK;$/);

  const corpoDryRun = dryRun.replace(/^BEGIN;\n/, "").replace(/\nROLLBACK;$/, "");
  assert.equal(normalizarSql(corpoDryRun), normalizarSql(migration));

  assert.doesNotMatch(dryRun, /^\s*COMMIT\s*;/im);
  assert.doesNotMatch(dryRun, /^\s*\\/m);
  assert.doesNotMatch(dryRun, /\\set\b|\\ir\b|\\i\b/i);
  assert.equal((dryRun.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((dryRun.match(/^ROLLBACK;$/gm) ?? []).length, 1);
  assert.doesNotMatch(migration, /^\s*(BEGIN|COMMIT);/m);
});

test("migration protege tipo, classificação, total positivo e concorrência", () => {
  const sql = readFileSync(migrationPath, "utf8");
  for (const trecho of [
    "tipo_registro",
    "falta_tipo",
    "NOT VALID",
    "REGISTRO_HORAS_ZERO",
    "REGISTRO_FALTA_CLASSIFICACAO",
    "pg_advisory_xact_lock",
    "BEFORE INSERT OR UPDATE",
    "SECURITY INVOKER",
  ]) {
    assert.ok(sql.includes(trecho), `migration deve conter ${trecho}`);
  }
  assert.doesNotMatch(sql, /UPDATE\s+public\.registros_horas\s+SET\s+tipo_registro/is);
});

test("verificacao e autocontida, somente leitura e cobre as estruturas de falta", () => {
  const sql = readFileSync(verificationPath, "utf8");
  const sqlExecutavel = removerComentariosELiterais(sql);
  const instrucoes = sqlExecutavel
    .split(";")
    .map((instrucao) => instrucao.trim())
    .filter(Boolean);

  assert.ok(
    Buffer.byteLength(sql, "utf8") > 5_000,
    "arquivo de verificacao nao pode estar vazio ou incompleto",
  );
  assert.equal(instrucoes.length, 15, "verificacao deve manter as 15 consultas estruturais");
  assert.ok(instrucoes.every((instrucao) => /^(SELECT|WITH)\b/i.test(instrucao)));
  assert.doesNotMatch(sql, /^\s*\\/m, "SQL Editor nao aceita metacomandos do psql");
  assert.doesNotMatch(
    sqlExecutavel,
    /(^|\n)\s*(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL|BEGIN|COMMIT|ROLLBACK)\b/im,
    "verificacao deve conter apenas consultas de leitura",
  );

  for (const trecho of [
    "public.registros_horas",
    "tipo_registro",
    "falta_tipo",
    "pg_trigger",
    "obras_salvar_registro_horas",
    "obras_validar_conflito_apontamento_diario",
  ]) {
    assert.ok(sql.includes(trecho), `verificacao deve cobrir ${trecho}`);
  }
});

test("migration permanece restrita ao modelo de apontamentos do Obras Control", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /public\.registros_horas/);
  assert.doesNotMatch(sql, /\bro[_ -]?passagens?\b|\bpassagens\b/i);
});
