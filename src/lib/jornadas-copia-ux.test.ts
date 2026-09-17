import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const grade = readFileSync(new URL("../components/RegistrosGrid.tsx", import.meta.url), "utf8");
const modal = readFileSync(new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url), "utf8");
const copia = readFileSync(new URL("../components/CopiarDiaAnteriorDialog.tsx", import.meta.url), "utf8");
const sql = readFileSync(new URL("../../supabase/migrations/20260917120000_copia_somente_jornadas.sql", import.meta.url), "utf8");

test("grade exige ID para edição e envia célula vazia ao formulário de criação", () => {
  assert.match(grade, /if \(!r\.id\) \{/);
  assert.match(grade, /Nenhum lançamento nesta data/);
  assert.match(grade, /onAddRegistro\?\.\(f\.id, obraId, dateStr\)/);
  assert.match(modal, /onAddRegistro=\{\(funcionarioId, obraId, data\) => \{/);
  assert.match(modal, /form\.setValue\("funcionario_id", funcionarioId\)/);
  assert.match(modal, /form\.setValue\("data_fim", data\)/);
});

test("datas do período aparecem juntas depois do tipo", () => {
  const tipo = modal.indexOf('name="tipo_registro"');
  const periodo = modal.indexOf('>Período</p>');
  const de = modal.indexOf('name="data"', tipo);
  const ate = modal.indexOf('name="data_fim"', de);
  assert.ok(tipo < periodo && periodo < de && de < ate);
  assert.match(modal, /sm:grid-cols-2/);
});

test("prévia e gravação só aceitam jornada persistida e revalidam ausência", () => {
  assert.match(copia, /origemData: previa\.origem_data/);
  assert.match(copia, /total_nao_copiaveis/);
  assert.match(sql, /r\.tipo_registro = 'horas'/);
  assert.match(sql, /r\.tipo_registro IS DISTINCT FROM 'horas'/);
  assert.match(sql, /EXCEPT SELECT unnest\(v_nao_copiaveis\)/);
  assert.match(sql, /v_origem_data := nullif\(v_item->>'origemData'/);
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(sql, /'nao_copiaveis', v_nao_copiaveis/);
});
