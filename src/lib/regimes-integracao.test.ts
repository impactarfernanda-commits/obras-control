import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260821120817_adiciona_regime_local_alojado.sql",
  "utf8",
);
const funcionarios = readFileSync("src/routes/_authenticated/funcionarios.tsx", "utf8");
const planejamento = readFileSync("src/lib/planejamento-hh.functions.ts", "utf8");
const relatorio = readFileSync("src/lib/relatorio-centro-custo.functions.ts", "utf8");
const composicao = readFileSync("src/lib/relatorio-centro-custo.ts", "utf8");
const telaRelatorios = readFileSync("src/routes/_authenticated/relatorios.tsx", "utf8");
const excel = readFileSync("src/lib/relatorio-centro-custo-xlsx.ts", "utf8");

test("vigencias de regime sao independentes das vigencias financeiras e nao sobrepoem", () => {
  assert.match(migration, /CREATE TABLE public\.funcionario_regime_vigencias/);
  assert.doesNotMatch(migration, /ALTER TABLE public\.funcionario_custos_vigencias/);
  assert.match(migration, /EXCLUDE USING gist[\s\S]*daterange[\s\S]*WITH &&/);
  assert.match(migration, /UNIQUE \(funcionario_id, vigencia_inicio\)/);
  assert.doesNotMatch(migration, /funcionario_cc_vigencias/);
  const fimTabela = migration.indexOf("CREATE INDEX funcionario_regime_vigencias_busca_idx");
  assert.doesNotMatch(migration.slice(0, fimTabela), /obra_id/);
});

test("referencia de CC traz ultimo anterior e mudancas do periodo sem expor ao cliente", () => {
  assert.match(migration, /FUNCTION public\.obras_control_alocacoes_referencia_regime/);
  assert.match(migration, /DISTINCT ON \(a\.funcionario_id\)/);
  assert.match(migration, /a\.data < p_inicio/);
  assert.match(migration, /a\.data BETWEEN p_inicio AND p_fim/);
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /TO service_role/);
});

test("RPC de lote e transacional, autenticada e protege competencia fechada", () => {
  assert.match(migration, /FUNCTION public\.definir_regime_funcionarios/);
  assert.match(migration, /FOREACH v_funcionario_id IN ARRAY p_funcionario_ids LOOP/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /fc\.fechada AND fc\.data_fim >= p_vigencia_inicio/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon/);
  assert.match(migration, /auth\.uid\(\) IS NULL/);
});

test("nova tabela possui RLS e grants explicitos", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.funcionario_regime_vigencias/);
  assert.match(migration, /GRANT SELECT ON public\.funcionario_regime_vigencias TO authenticated/);
  assert.doesNotMatch(migration, /FOR (?:INSERT|UPDATE|DELETE) TO authenticated/);
});

test("Funcionarios centraliza coluna, edicao, historico e acao em lote", () => {
  assert.match(funcionarios, /<TableHead>Regime<\/TableHead>/);
  assert.match(funcionarios, /Não informado/);
  assert.match(funcionarios, /name="regime"/);
  assert.match(funcionarios, /name="regime_vigencia_inicio"/);
  assert.match(funcionarios, /Definir regime em lote/);
  assert.match(funcionarios, /Histórico de regime/);
  assert.match(funcionarios, /definir_regime_funcionarios/);
  assert.match(funcionarios, /Classificação inicial com vigência oficial em 25\/07\/2026/);
  assert.match(funcionarios, /Data efetiva da mudança/);
  assert.ok(
    funcionarios.indexOf("f.data_admissao") <
      funcionarios.indexOf("regimeLabel(f.regime)", funcionarios.indexOf("f.data_admissao")),
    "Admissão deve ser renderizada antes de Regime",
  );
});

test("relatorio de CC integra fonte, calculo, cards, tabela e Excel", () => {
  assert.match(relatorio, /funcionario_regime_vigencias/);
  assert.match(relatorio, /obras_control_alocacoes_referencia_regime/);
  assert.match(composicao, /apurarCustosRegime/);
  assert.match(composicao, /custoRegimeLocal/);
  assert.match(composicao, /custoRegimeAlojado/);
  assert.match(telaRelatorios, /Regime Local/);
  assert.match(telaRelatorios, /Regime Alojado/);
  assert.match(telaRelatorios, /Custo Regime/);
  assert.match(excel, /Custo Regime Local/);
  assert.match(excel, /Custo Regime Alojado/);
  assert.match(excel, /Custo Regime/);
});

test("apuracao soma custos de regime e alerta ausencia", () => {
  assert.match(planejamento, /apurarCustosRegime/);
  assert.match(planejamento, /obras_control_alocacoes_referencia_regime/);
  assert.match(planejamento, /regime_local/);
  assert.match(planejamento, /regime_alojado/);
  assert.match(planejamento, /Regime nao informado/);
  assert.match(planejamento, /Alojado sem CC de referência/);
});
