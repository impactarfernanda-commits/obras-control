import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260908130000_ausencia_planejada_periodos.sql",
  "utf8",
);

test("versionamento do backfill limita-se a ausências sem ID, sem criar dias", () => {
  const backfill = sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION"));
  assert.match(backfill, /ADD COLUMN IF NOT EXISTS ausencia_periodo_id uuid/);
  assert.match(backfill, /CREATE INDEX IF NOT EXISTS registros_horas_ausencia_periodo_idx/);
  assert.match(
    backfill,
    /tipo_registro IN \('ferias', 'folga_campo'\)\s+AND rh.ausencia_periodo_id IS NULL/,
  );
  assert.match(backfill, /lag\(rh.data\)[\s\S]*?= rh.data - 1/);
  assert.match(
    backfill,
    /GROUP BY funcionario_id, obra_id, tipo_registro,\s+created_by, created_at, observacoes, bloco/,
  );
  assert.doesNotMatch(backfill, /INSERT INTO|DELETE FROM|generate_series/);
});

test("criação atribui um UUID ao período e leitura separa lacunas sem inferência no frontend", () => {
  assert.match(sql, /v_periodo_id uuid := gen_random_uuid\(\)/);
  const obter = sql
    .split("CREATE OR REPLACE FUNCTION public.obras_obter_ausencia_planejada_periodo")[1]
    .split("REVOKE ALL")[0];
  assert.match(obter, /rh.data - \(row_number\(\) OVER \(ORDER BY rh.data\)\)::integer AS grupo/);
  assert.match(obter, /rh.ausencia_periodo_id = v_registro.ausencia_periodo_id/);
  assert.match(obter, /WHERE o.grupo = a.grupo/);
  assert.match(obter, /v_quantidade := 1/);
});

test("RPC de edição versionada mantém locks, permissões, competência e auditoria aprovados", () => {
  const editar = sql.split(
    "CREATE OR REPLACE FUNCTION public.obras_editar_ausencia_planejada_periodo",
  )[1];
  assert.match(editar, /SECURITY DEFINER\s+SET search_path TO ''/);
  assert.match(editar, /coalesce\(v_registro.created_by = v_usuario, false\)/);
  assert.match(editar, /ur.role::text IN \('coordenador', 'gerente', 'diretor'\)/);
  assert.match(editar, /'ausencia_periodo\|'/);
  assert.match(editar, /pg_advisory_xact_lock/);
  assert.match(editar, /WHERE rh.id = ANY\(v_ids\) FOR UPDATE/);
  assert.match(editar, /v_total_bloqueado <> v_total_atual/);
  assert.match(editar, /competencia_fechada\(v_data\)/);
  assert.match(editar, /obras_validar_conflito_apontamento_diario/);
  assert.ok(
    editar.indexOf("INSERT INTO public.registros_horas_exclusoes") <
      editar.indexOf("DELETE FROM public.registros_horas"),
  );
  assert.match(editar, /to_jsonb\(rh\)/);
  assert.match(editar, /coalesce\(v_registro.created_by, v_usuario\), v_registro.created_at/);
  assert.doesNotMatch(editar, /(?:UPDATE|DELETE FROM|INSERT INTO) public.alocacoes/);
  assert.match(editar, /FROM PUBLIC, anon/);
  assert.match(editar, /TO authenticated, service_role/);
});
