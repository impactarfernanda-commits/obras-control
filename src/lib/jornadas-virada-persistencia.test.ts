import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260819120000_jornadas_virada_adicional_noturno.sql",
  "utf8",
);
const tela = readFileSync("src/routes/_authenticated/alocacoes.tsx", "utf8");
const copia = readFileSync("src/components/CopiarDiaAnteriorDialog.tsx", "utf8");
const periodo = readFileSync("src/components/AlocarPeriodoDialog.tsx", "utf8");
const migrationCorretiva = readFileSync(
  "supabase/migrations/20260819130000_corrige_limite_justificativa_e_acl_feriados.sql",
  "utf8",
);

test("migration mantém legado e persiste detalhamento sem backfill", () => {
  assert.match(migration, /CREATE TABLE public\.registros_horas_detalhes/);
  assert.match(migration, /registro_horas_id uuid PRIMARY KEY/);
  assert.match(migration, /versao_calculo text NOT NULL/);
  assert.match(migration, /ON CONFLICT \(registro_horas_id\) DO UPDATE/);
  assert.doesNotMatch(
    migration,
    /INSERT INTO public\.registros_horas_detalhes[\s\S]+SELECT[\s\S]+FROM public\.registros_horas/,
  );
});

test("RPC salva jornada e detalhe atomicamente e verifica sobreposição temporal", () => {
  const corpo =
    migration.match(
      /CREATE OR REPLACE FUNCTION public\.obras_salvar_jornada_v2[\s\S]+?\$\$;/,
    )?.[0] ?? "";
  assert.match(corpo, /INSERT INTO public\.alocacoes/);
  assert.match(corpo, /obras_salvar_registro_horas/);
  assert.match(corpo, /INSERT INTO public\.registros_horas_detalhes/);
  assert.match(corpo, /tsrange\([\s\S]+&& tsrange/);
  assert.match(
    corpo,
    /pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_funcionario_id::text, 0\)\)[\s\S]+IF EXISTS \(/,
  );
  assert.match(corpo, /a\.created_by = v_usuario/);
});

test("RPC em lote preserva duplicados, é concorrente e não engole outros conflitos", () => {
  assert.match(migration, /alocacoes_funcionario_data_unique|UNIQUE \(funcionario_id, data\)/);
  assert.match(migration, /IF v_alocacao_id IS NULL AND EXISTS/);
  assert.match(migration, /EXCEPTION WHEN unique_violation/);
  assert.match(migration, /IF v_alocacao_id IS NULL AND EXISTS[\s\S]+ELSE\s+RAISE;/);
  assert.match(migration, /'processados', v_processados/);
  assert.match(migration, /'preservados', v_preservados/);
  const corpoLote =
    migration.match(
      /CREATE OR REPLACE FUNCTION public\.obras_copiar_jornadas_v2[\s\S]+?\$\$;/,
    )?.[0] ?? "";
  assert.match(corpoLote, /SELECT DISTINCT \(item->>'funcionarioId'\)::uuid[\s\S]+ORDER BY 1/);
  assert.match(corpoLote, /pg_catalog\.pg_advisory_xact_lock\(pg_catalog\.hashtextextended/);
});

test("cópia preserva funcionário ocupado na data mesmo em outra obra", () => {
  const corpoLote =
    migration.match(
      /CREATE OR REPLACE FUNCTION public\.obras_copiar_jornadas_v2[\s\S]+?\$\$;/,
    )?.[0] ?? "";
  const verificacoes =
    corpoLote.match(/WHERE a\.funcionario_id = v_funcionario_id AND a\.data = v_data/g) ?? [];
  assert.equal(verificacoes.length, 2);
  assert.doesNotMatch(
    corpoLote,
    /funcionario_id = v_funcionario_id AND a\.obra_id = v_obra_id AND a\.data/,
  );
  assert.match(corpoLote, /v_alocacao_id IS NULL[\s\S]+v_preservados := v_preservados \+ 1/);
});

test("RPC v2 possui autenticação, autorização, search_path e ACL mínimos", () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /a\.created_by = v_usuario/);
  assert.match(
    migration,
    /a\.funcionario_id = p_funcionario_id AND a\.obra_id = p_obra_id AND a\.data = p_data/,
  );
  assert.match(migration, /SECURITY DEFINER SET search_path = pg_catalog, public/g);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.obras_salvar_jornada_v2[\s\S]+FROM PUBLIC, anon/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.obras_copiar_jornadas_v2\(jsonb\) TO authenticated/,
  );
});

test("edição de horas nunca apaga Civil/Montagem com NULL", () => {
  assert.match(
    migration,
    /especialidade_ajudante = coalesce\(p_especialidade_ajudante, especialidade_ajudante\)/,
  );
  assert.match(tela, /p_especialidade_ajudante: editEspecialidadeAjudante/);
});

test("feriados começam vazios e são configuráveis sem datas inventadas", () => {
  assert.match(migration, /CREATE TABLE public\.feriados_obras_control/);
  assert.doesNotMatch(migration, /INSERT INTO public\.feriados_obras_control/);
});

test("ACL de feriados deixa RLS efetiva para escrita administrativa", () => {
  assert.match(migration, /REVOKE ALL ON public\.feriados_obras_control FROM PUBLIC, anon/);
  assert.match(
    migration,
    /GRANT SELECT ON public\.registros_horas_detalhes, public\.feriados_obras_control TO authenticated/,
  );
  assert.match(
    migration,
    /GRANT INSERT, UPDATE, DELETE ON public\.feriados_obras_control TO authenticated/,
  );
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /feriados_obras_control_(?:insert|update|delete)/g);
});

test("criação, edição e cópia usam RPC v2 e intervalo editável", () => {
  assert.match(tela, /name="intervalo_minutos"/);
  assert.match(tela, /obras_salvar_jornada_v2/);
  assert.match(tela, /especialidade_ajudante: coalesce|p_especialidade_ajudante/);
  assert.match(copia, /obras_copiar_jornadas_v2/);
  assert.match(copia, /intervalo_padrao_minutos/);
  assert.match(copia, /calcularJornadaDetalhada/);
  assert.match(periodo, /obras_copiar_jornadas_v2/);
  assert.match(periodo, /calcularJornadaDetalhada/);
});

test("migration corretiva altera apenas limite de 12h e ACL excessiva de feriados", () => {
  assert.match(migrationCorretiva, /pg_catalog\.pg_get_functiondef/);
  assert.match(migrationCorretiva, /'> 600', '> 720'/);
  assert.match(
    migrationCorretiva,
    /superior a 10 horas\.',\s*'Justificativa obrigatoria para jornada superior a 12 horas\.'/,
  );
  assert.match(
    migrationCorretiva,
    /REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE public\.feriados_obras_control FROM authenticated/,
  );
  assert.match(
    migrationCorretiva,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.feriados_obras_control TO authenticated/,
  );
  assert.doesNotMatch(migrationCorretiva, /CREATE POLICY|DROP POLICY|ALTER POLICY/);
});
