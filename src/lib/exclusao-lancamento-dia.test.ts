import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260824105715_exclusao_lancamento_dia_auditada.sql",
    import.meta.url,
  ),
  "utf8",
);
const grade = readFileSync(
  new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url),
  "utf8",
);
const copia = readFileSync(
  new URL("../components/CopiarDiaAnteriorDialog.tsx", import.meta.url),
  "utf8",
);

test("exclusão é atômica, auditada e não alcança funcionário ou outras datas", () => {
  const rpc = migration.match(
    /CREATE OR REPLACE FUNCTION public\.obras_excluir_lancamento_dia[\s\S]+?\n\$\$;/,
  )?.[0];
  assert.ok(rpc);
  assert.match(rpc, /INSERT INTO public\.alocacoes_dia_exclusoes/);
  assert.match(rpc, /DELETE FROM public\.registros_horas WHERE id = v_registro\.id/);
  assert.match(rpc, /DELETE FROM public\.alocacoes WHERE id = v_alocacao\.id/);
  assert.doesNotMatch(rpc, /DELETE FROM public\.funcionarios/);
  assert.doesNotMatch(rpc, /\bCOMMIT\b/);
  assert.match(rpc, /to_jsonb\(v_alocacao\)/);
  assert.match(rpc, /to_jsonb\(v_registro\)/);
});

test("RPC de exclusão protege sessão, permissão, competência e concorrência", () => {
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(migration, /v_usuario uuid := auth\.uid\(\)/);
  assert.match(migration, /public\.competencia_fechada\(v_alocacao\.data\)/);
  assert.match(migration, /v_alocacao\.created_by = v_usuario[\s\S]+get_user_level/);
  assert.match(migration, /v_registro\.created_by = v_usuario[\s\S]+get_user_level/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.obras_excluir_lancamento_dia\(uuid\) FROM PUBLIC, anon/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.obras_excluir_lancamento_dia\(uuid\) TO authenticated/,
  );
});

test("RLS da auditoria não expõe exclusões globalmente", () => {
  assert.doesNotMatch(migration, /alocacoes_dia_exclusoes[\s\S]+USING \(true\)/);
  assert.match(migration, /excluido_por = \(SELECT auth\.uid\(\)\)/);
  for (const role of ["coordenador", "gerente", "diretor"])
    assert.match(migration, new RegExp(`'${role}'::public\\.app_role`));
  assert.match(migration, /GRANT SELECT ON TABLE public\.alocacoes_dia_exclusoes TO authenticated/);
  assert.doesNotMatch(
    migration,
    /GRANT (?:INSERT|UPDATE|DELETE)[^;]*alocacoes_dia_exclusoes TO authenticated/,
  );
});

test("exclusão permanece suprimida após reload e a prévia sinaliza o estado", () => {
  assert.match(
    migration,
    /UNIQUE INDEX alocacoes_dia_exclusoes_supressao_ativa_uidx[\s\S]+\(funcionario_id, data\)[\s\S]+WHERE ativa_para_copia = true/,
  );
  assert.match(migration, /'excluido_destino'/);
  assert.match(migration, /total_suprimidos/);
  assert.match(migration, /NOT o\.id = ANY\(v_suprimidos\)/);
  assert.match(copia, /Excluído no destino — não será recriado/);
});

test("RPC definitiva bloqueia chamada direta e corrida com exclusão", () => {
  const definitiva = migration.match(
    /CREATE OR REPLACE FUNCTION public\.obras_copiar_jornadas_v2[\s\S]+?\n\$\$;/,
  )?.[0];
  assert.ok(definitiva);
  assert.match(definitiva, /pg_advisory_xact_lock/);
  assert.match(definitiva, /FROM public\.alocacoes_dia_exclusoes/);
  assert.match(definitiva, /v_preservados := v_preservados \+ 1;[\s\S]+CONTINUE/);
});

test("recriação manual neutraliza supressão sem afetar a cópia automática", () => {
  assert.match(migration, /AFTER INSERT ON public\.alocacoes/);
  assert.match(
    migration,
    /UPDATE public\.alocacoes_dia_exclusoes[\s\S]+ativa_para_copia = false[\s\S]+NEW\.funcionario_id[\s\S]+NEW\.data/,
  );
  assert.match(migration, /neutralizada_por = auth\.uid\(\)/);
  assert.match(migration, /neutralizada_em = now\(\)/);
  assert.match(migration, /AND e\.ativa_para_copia = true/);
  assert.match(migration, /v_item->'detalhe', 'copia'/);
});

test("grade confirma exclusão, usa a RPC e expõe ações conforme permissão", () => {
  assert.match(grade, /Excluir o lançamento deste funcionário em \$\{dataBr\}\?/);
  assert.match(grade, /obras_excluir_lancamento_dia/);
  assert.doesNotMatch(grade, /from\("alocacoes"\)\.delete\(\)\.eq\("id", a\.id\)/);
  assert.match(grade, /canDeleteDailyAllocation/);
  assert.match(grade, /Editar jornada/);
  assert.match(grade, /aria-label="Excluir lançamento"/);
});

test("pacote não altera regra de HE e preserva jornada e AJUDANTE existentes", () => {
  assert.doesNotMatch(migration, /extras_justificativa|horas_extras < 2/);
  assert.match(grade, /obras_salvar_jornada_v2/);
  assert.match(grade, /exigeJustificativaExtras/);
  assert.match(grade, /editEspecialidadeAjudante/);
  assert.match(copia, /especialidadeAjudante: especialidadeNovaAlocacao/);
});
