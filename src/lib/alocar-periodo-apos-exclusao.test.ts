import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260828160000_corrige_alocar_periodo_apos_exclusao.sql",
    import.meta.url,
  ),
  "utf8",
);
const migrationExclusao = readFileSync(
  new URL(
    "../../supabase/migrations/20260824105715_exclusao_lancamento_dia_auditada.sql",
    import.meta.url,
  ),
  "utf8",
);
const periodo = readFileSync(
  new URL("../components/AlocarPeriodoDialog.tsx", import.meta.url),
  "utf8",
);
const copia = readFileSync(
  new URL("../components/CopiarDiaAnteriorDialog.tsx", import.meta.url),
  "utf8",
);
const diagnostico = readFileSync(
  new URL("../../supabase/manual/diagnostico_alocar_periodo_apos_exclusao.sql", import.meta.url),
  "utf8",
);

test("Alocar período declara intenção manual e Copiar dia mantém origem automática", () => {
  assert.match(periodo, /origemCalculo: "aplicacao"/);
  assert.match(copia, /origemCalculo: "copia"/);
  assert.equal((periodo.match(/obras_copiar_jornadas_v2/g) ?? []).length, 1);
  assert.equal((copia.match(/obras_copiar_jornadas_v2/g) ?? []).length, 1);
});

test("ausência da origem mantém compatibilidade segura como cópia", () => {
  assert.match(migration, /coalesce\(nullif\(v_item->>'origemCalculo', ''\), 'copia'\)/);
  assert.match(migration, /v_origem_calculo NOT IN \('aplicacao', 'copia'\)/);
});

test("supressão bloqueia somente cópia e não conta como ocupação manual", () => {
  assert.match(
    migration,
    /v_origem_calculo = 'copia' AND v_alocacao_id IS NULL AND EXISTS[\s\S]+alocacoes_dia_exclusoes/,
  );
  assert.doesNotMatch(
    migration,
    /v_origem_calculo = 'aplicacao'[\s\S]{0,120}alocacoes_dia_exclusoes/,
  );
});

test("alocação real continua preservada com trava e proteção contra duplicidade", () => {
  assert.match(
    migration,
    /IF v_alocacao_id IS NULL AND EXISTS \([\s\S]+FROM public\.alocacoes a[\s\S]+CONTINUE;/,
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /EXCEPTION WHEN unique_violation/);
  assert.match(migration, /ELSE\s+RAISE;/);
});

test("lote encaminha a origem para a função canônica sem duplicar inserção", () => {
  assert.match(migration, /PERFORM public\.obras_salvar_jornada_v2\([\s\S]+v_origem_calculo/);
  assert.doesNotMatch(migration, /INSERT INTO public\.alocacoes/);
  assert.doesNotMatch(migration, /DELETE FROM public\.alocacoes_dia_exclusoes/);
});

test("trigger existente neutraliza supressão e preserva o histórico", () => {
  assert.match(migrationExclusao, /CREATE TRIGGER trg_limpar_supressao_alocacao_recriada/);
  assert.match(
    migrationExclusao,
    /SET ativa_para_copia = false,[\s\S]+neutralizada_por = auth\.uid\(\)[\s\S]+neutralizada_em = now\(\)/,
  );
  assert.doesNotMatch(migrationExclusao, /DELETE FROM public\.alocacoes_dia_exclusoes/);
});

test("competência e permissões permanecem delegadas à função canônica", () => {
  assert.match(migration, /SECURITY DEFINER SET search_path = pg_catalog, public/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /public\.obras_salvar_jornada_v2/);
  assert.match(migration, /REVOKE ALL[\s\S]+FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE[\s\S]+TO authenticated/);
});

test("diagnóstico de órfãos é estritamente somente leitura", () => {
  assert.match(diagnostico, /registro_horas_orfao/);
  assert.match(diagnostico, /somente_supressao_ativa/);
  assert.doesNotMatch(diagnostico, /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL)\b/i);
});
