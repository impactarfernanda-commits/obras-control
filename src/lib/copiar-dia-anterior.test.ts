import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ultimaDataAnterior } from "./copiar-dia-anterior.ts";

const componente = readFileSync(
  new URL("../components/CopiarDiaAnteriorDialog.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260813114059_copia_dia_anterior_alocacoes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("encontra o último dia anterior e segunda pode usar sexta", () => {
  assert.equal(ultimaDataAnterior(["2026-08-07", "2026-08-08"], "2026-08-10"), "2026-08-08");
  assert.equal(ultimaDataAnterior(["2026-08-07"], "2026-08-10"), "2026-08-07");
});
test("origem é consultada somente na mesma obra", () =>
  assert.match(componente, /eq\("obra_id", obraId\).*lt\("data", destino\)/s));
test("confirmação grava especialidades e horas em lote e invalida queries", () => {
  assert.equal((componente.match(/p_aplicar: false/g) ?? []).length, 1);
  assert.doesNotMatch(componente, /p_aplicar: true/);
  assert.match(componente, /especialidade_ajudante:/);
  assert.match(componente, /\.upsert\(/);
  assert.match(componente, /\.from\("registros_horas"\)[\s\S]*\.insert\(linhasRegistro\)/);
  assert.match(componente, /invalidateQueries\(\{ queryKey: \["alocacoes-mes"\]/);
  assert.match(componente, /invalidateQueries\(\{ queryKey: \["registros-mes"\]/);
});
test("copia revalida destino em lote e bloqueia clique duplicado", () => {
  assert.match(componente, /confirmacaoEmAndamento\.current/);
  assert.match(componente, /\.in\("funcionario_id", ids\)/);
  assert.match(componente, /ignoreDuplicates: true/);
});
test("RPC é invoker, transacional e não amplia execução", () => {
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /REVOKE ALL .* FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE .* TO authenticated/);
  assert.doesNotMatch(migration, /COMMIT|SECURITY DEFINER/);
});
test("RPC copia horas normais e zera ocorrências específicas", () => {
  assert.match(migration, /r\.horas_normais/);
  assert.match(migration, /0, false, NULL, NULL, NULL, 'horas', NULL/);
});
test("RPC preserva existentes, filtra desligados e usa autoria atual", () => {
  assert.match(migration, /a\.data = p_data_destino/);
  assert.match(migration, /data_desligamento.*< p_data_destino/);
  assert.match(migration, /v_usuario uuid := auth\.uid\(\)/);
  assert.match(migration, /ON CONFLICT DO NOTHING/);
});
test("prévia não conta duas vezes bloqueios sobrepostos", () => {
  assert.match(migration, /NOT o\.id = ANY\(v_existentes\).*NOT o\.id = ANY\(v_inelegiveis\)/s);
  assert.doesNotMatch(migration, /cardinality\(v_origem\) - cardinality\(v_existentes\)/);
});
test("artefatos SQL são puros, somente leitura ou transacionais com rollback", () => {
  const diagnostico = readFileSync(
    new URL("../../supabase/manual/diagnostico_pre_copia_dia_anterior.sql", import.meta.url),
    "utf8",
  );
  const dryRun = readFileSync(
    new URL(
      "../../supabase/manual/DRY_RUN_20260813114059_copia_dia_anterior_alocacoes.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const verificacao = readFileSync(
    new URL("../../supabase/manual/verificar_copia_dia_anterior.sql", import.meta.url),
    "utf8",
  );
  const smoke = readFileSync(
    new URL("../../supabase/manual/smoke_copia_dia_anterior.sql", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(diagnostico + verificacao, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
  for (const arquivo of [dryRun, smoke]) {
    assert.match(arquivo, /\bBEGIN;/);
    assert.match(arquivo, /\bROLLBACK;/);
  }
  assert.doesNotMatch(dryRun + smoke, /\\(?:set|i|ir)\b/i);
});
test("fluxos existentes permanecem presentes", () => {
  const rota = readFileSync(
    new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url),
    "utf8",
  );
  for (const trecho of [
    "createMutation",
    "editMutation",
    "deleteMutation",
    "AlocarPeriodoDialog",
    "undoLastMutation",
  ])
    assert.match(rota, new RegExp(trecho));
});
