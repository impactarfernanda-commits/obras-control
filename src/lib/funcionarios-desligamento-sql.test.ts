import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260812080000_libera_desligamento_funcionarios_roles_internas.sql",
    import.meta.url,
  ),
  "utf8",
);
const dryRun = readFileSync(
  new URL(
    "../../supabase/manual/DRY_RUN_20260812080000_libera_desligamento_funcionarios_roles_internas.sql",
    import.meta.url,
  ),
  "utf8",
);
const verification = readFileSync(
  new URL("../../supabase/manual/verificar_libera_desligamento_funcionarios.sql", import.meta.url),
  "utf8",
);

test("migration libera somente a transicao inicial para as cinco roles internas", () => {
  for (const role of ["assistente", "supervisor", "coordenador", "gerente", "diretor"]) {
    assert.match(migration, new RegExp(`has_role\\(auth\\.uid\\(\\), '${role}'\\)`));
  }
  for (const predicate of [
    "OLD.ativo IS TRUE",
    "NEW.ativo IS FALSE",
    "OLD.data_desligamento IS NULL",
    "NEW.data_desligamento IS NOT NULL",
    "OLD.deleted_at IS NULL",
    "NEW.deleted_at IS NULL",
    "OLD.deleted_by IS NULL",
    "NEW.deleted_by IS NULL",
  ])
    assert.ok(migration.includes(predicate), predicate);
});

test("migration mantem restricoes administrativas e invariantes de datas", () => {
  assert.match(migration, /AND NOT gerente_ou_diretor\s+AND NOT desligamento_inicial/);
  assert.ok(migration.includes("DATA_DESLIGAMENTO_OBRIGATORIA"));
  assert.ok(migration.includes("DATA_DESLIGAMENTO_ANTERIOR_ADMISSAO"));
  assert.ok(migration.includes("ULTIMA_ALOCACAO_FUNCIONARIO:"));
  assert.ok(migration.includes("FROM public.alocacoes"));
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.alocacoes/i);
});

test("dry-run e SQL puro, transacional e termina em rollback", () => {
  assert.doesNotMatch(dryRun, /^\s*\\(?:set|i|ir|include|echo)\b/im);
  assert.match(dryRun, /^\s*BEGIN\s*;/i);
  assert.match(dryRun, /ROLLBACK\s*;\s*$/i);
  assert.doesNotMatch(migration, /ROLLBACK\s*;/i);
});

test("dry-run representa integralmente o corpo da migration", () => {
  const match = dryRun.match(/-- BEGIN MIGRATION BODY\r?\n([\s\S]*?)\r?\n-- END MIGRATION BODY/);
  assert.ok(match, "marcadores do corpo da migration ausentes");
  const normalize = (sql: string) => sql.replace(/\r\n/g, "\n").trim();
  assert.equal(normalize(match[1]), normalize(migration));

  const assertBlock = dryRun.slice(dryRun.indexOf("-- END MIGRATION BODY"));
  for (const invariant of [
    "OLD.ativo IS TRUE",
    "NEW.ativo IS FALSE",
    "DATA_DESLIGAMENTO_OBRIGATORIA",
    "DATA_DESLIGAMENTO_ANTERIOR_ADMISSAO",
    "ULTIMA_ALOCACAO_FUNCIONARIO:",
    "AND NOT gerente_ou_diretor",
    "AND NOT desligamento_inicial",
    "OLD.deleted_at",
    "NEW.deleted_at",
    "OLD.deleted_by",
    "NEW.deleted_by",
  ])
    assert.ok(assertBlock.includes(invariant), invariant);
});

test("verificacao consulta ACL de PUBLIC sem tratar pseudo-role como role real", () => {
  assert.doesNotMatch(verification, /has_function_privilege\(\s*'PUBLIC'/i);
  assert.match(verification, /aclexplode\s*\(/i);
  assert.match(verification, /acldefault\s*\(\s*'f'/i);
  assert.match(verification, /grantee\s*=\s*0/i);
  assert.match(verification, /AS public_sem_execute/i);
  assert.match(verification, /has_function_privilege\(\s*'anon'/i);
  assert.match(verification, /has_function_privilege\(\s*'authenticated'/i);
});
