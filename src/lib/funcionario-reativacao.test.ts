import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260930120000_reativacao_funcionario_auditada.sql",
    import.meta.url,
  ),
  "utf8",
);
const tela = readFileSync(
  new URL("../routes/_authenticated/funcionarios.tsx", import.meta.url),
  "utf8",
);

test("migration cria auditoria imutavel com ator, motivo e estados anterior/novo", () => {
  assert.match(migration, /CREATE TABLE public\.funcionario_estado_auditoria/);
  for (const coluna of [
    "funcionario_id",
    "acao",
    "ativo_anterior",
    "ativo_novo",
    "data_desligamento_anterior",
    "data_desligamento_novo",
    "deleted_at_anterior",
    "deleted_at_novo",
    "motivo",
    "created_by",
    "created_at",
  ]) {
    assert.match(migration, new RegExp(`\\b${coluna}\\b`), coluna);
  }
  assert.match(migration, /CHECK \(acao = 'reativacao'\)/);
  assert.match(migration, /char_length\(motivo\) BETWEEN 10 AND 1000/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.funcionario_estado_auditoria/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE).*funcionario_estado_auditoria/);
});

test("RPC exige autenticacao, gerente ou diretor e valida todos os estados", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reativar_funcionario/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog, public/);
  assert.match(migration, /v_usuario uuid := auth\.uid\(\)/);
  assert.match(migration, /has_role\(v_usuario, 'gerente'\).*has_role\(v_usuario, 'diretor'\)/s);
  for (const erro of [
    "AUTENTICACAO_OBRIGATORIA",
    "REATIVACAO_RESTRITA_GERENTE_DIRETOR",
    "FUNCIONARIO_NAO_ENCONTRADO",
    "FUNCIONARIO_JA_ATIVO",
    "FUNCIONARIO_EXCLUIDO_NAO_PODE_SER_REATIVADO",
    "FUNCIONARIO_SEM_DATA_DESLIGAMENTO",
    "FUNCIONARIO_FORA_OBRAS_CONTROL",
  ]) {
    assert.match(migration, new RegExp(erro), erro);
  }
  assert.match(migration, /SELECT f\.\* INTO v_funcionario[\s\S]*FOR UPDATE/);
});

test("RPC normaliza o motivo e altera somente ativo e data de desligamento", () => {
  assert.match(migration, /v_motivo text := btrim\(coalesce\(p_motivo, ''\)\)/);
  assert.match(migration, /char_length\(v_motivo\) < 10/);
  assert.match(migration, /char_length\(v_motivo\) > 1000/);
  const update = migration.match(
    /UPDATE public\.funcionarios f\s+SET ([\s\S]*?)\s+WHERE f\.id = v_funcionario\.id;/,
  );
  assert.ok(update);
  assert.match(update[1], /ativo = true/);
  assert.match(update[1], /data_desligamento = NULL/);
  for (const proibido of [
    "deleted_at",
    "deleted_by",
    "visivel_obras_control",
    "nome",
    "data_admissao",
    "categoria_mo",
    "salario",
  ]) {
    assert.doesNotMatch(update[1], new RegExp(proibido), proibido);
  }
  assert.match(migration, /INSERT INTO public\.funcionario_estado_auditoria/);
  assert.match(
    migration,
    /v_funcionario\.deleted_at, v_funcionario\.deleted_at, v_motivo, v_usuario/,
  );
});

test("guard bloqueia reativacao direta com autorizacao privada e consumivel", () => {
  assert.match(migration, /REATIVACAO_FUNCIONARIO_SOMENTE_VIA_RPC/);
  assert.match(migration, /CREATE TABLE public\.funcionario_reativacao_autorizacoes/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.funcionario_reativacao_autorizacoes/);
  assert.doesNotMatch(migration, /GRANT .*funcionario_reativacao_autorizacoes TO authenticated/);
  assert.match(migration, /DELETE FROM public\.funcionario_reativacao_autorizacoes/);
  assert.match(migration, /GET DIAGNOSTICS autorizacoes_consumidas = ROW_COUNT/);
  assert.match(migration, /autorizacoes_consumidas <> 1/);
  assert.match(migration, /txid_current\(\)/);
  assert.doesNotMatch(migration, /(?:set_config|current_setting)\(/);
  assert.match(migration, /OLD\.ativo IS FALSE[\s\S]*NEW\.ativo IS TRUE/);
  assert.match(
    migration,
    /OLD\.data_desligamento IS NOT NULL[\s\S]*NEW\.data_desligamento IS NULL/,
  );
});

test("RPC nao toca tabelas historicas ou vinculos operacionais", () => {
  const rpc = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.reativar_funcionario"),
  );
  for (const tabela of [
    "alocacoes",
    "registros_horas",
    "funcionario_regime_vigencias",
    "funcionario_custos_vigencias",
    "funcionario_cc_vigencias",
    "responsaveis_pessoas",
  ]) {
    assert.doesNotMatch(rpc, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM) public\\.${tabela}`));
  }
});

test("tela exige motivo, evita duplo clique e invalida seletores e relatorios", () => {
  assert.match(tela, /canReactivateEmployee\(role, f\)/);
  assert.match(tela, /Reativar funcionário/);
  assert.match(tela, /Motivo da reativação/);
  assert.match(tela, /Desligamento lançado por engano/);
  assert.match(tela, /reactivationReason\.trim\(\)\.length < 10/);
  assert.match(tela, /reactivateMutation\.isPending/);
  for (const chave of [
    "funcionarios-cadastro",
    "funcionarios-min-all",
    "funcionarios-alocacao-selecao",
    "funcionarios-alocar-periodo-base-segura",
    "funcionarios-registros-selecao",
    "funcionarios-relatorios",
    "relatorio-sem-alocacao",
    "relatorio-centros-custo",
  ]) {
    assert.match(tela, new RegExp(chave), chave);
  }
});
