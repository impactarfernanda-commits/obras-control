import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260814174317_planejamento_hh_custos.sql",
  "utf8",
);
const dryRun = readFileSync("supabase/manual/DRY_RUN_20260814174317_planejamento_hh.sql", "utf8");
const server = readFileSync("src/lib/planejamento-hh.functions.ts", "utf8");
const route = readFileSync("src/routes/_authenticated/planejamento-hh.tsx", "utf8");
const parser = readFileSync("src/lib/planejamento-hh-parser.ts", "utf8");
const incremental = readFileSync(
  "supabase/migrations/20260814210000_valida_mapeamento_tipos_planejamento_hh.sql",
  "utf8",
);
const dryRunTipos = readFileSync(
  "supabase/manual/DRY_RUN_20260814210000_valida_mapeamento_tipos_planejamento_hh.sql",
  "utf8",
);
const verificacaoPlanejamento = readFileSync(
  "supabase/manual/verificar_planejamento_hh.sql",
  "utf8",
);

test("baseline possui numericos, checks, versao e uma unica ativa por obra", () => {
  assert.match(migration, /numeric\(16,4\).*CHECK \(hh_previsto >= 0\)/s);
  assert.match(migration, /numeric\(16,2\).*CHECK \(custo_previsto >= 0\)/s);
  assert.match(migration, /UNIQUE \(obra_id, versao\)/);
  assert.match(
    migration,
    /UNIQUE INDEX planejamento_hh_baselines_uma_ativa_por_obra_idx[\s\S]*WHERE ativa/,
  );
});

test("RLS e ACL nao liberam financeiro a qualquer authenticated", () => {
  for (const tabela of [
    "planejamento_hh_baselines",
    "planejamento_hh_baseline_itens",
    "planejamento_hh_mapeamentos",
    "funcionario_custos_vigencias",
  ])
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${tabela} ENABLE ROW LEVEL SECURITY`));
  assert.match(migration, /public\.can_view_salario\(\(SELECT auth\.uid\(\)\)\)/);
  assert.doesNotMatch(migration, /TO authenticated\s+USING \(true\)/);
});

test("vigencias congelam componentes financeiros e impedem sobreposicao", () => {
  for (const coluna of [
    "salario",
    "encargos_cadastrados",
    "encargos_calculados",
    "provisao_13",
    "provisao_aviso_previo",
    "provisao_ferias",
    "assistencia_medica",
    "assistencia_odontologica",
    "vale_alimentacao",
    "multibeneficio",
    "seguro_vida",
    "custo_mensal_total",
  ])
    assert.match(migration, new RegExp(`${coluna} numeric\\(16,2\\)`));
  assert.match(migration, /EXCLUDE USING gist[\s\S]*daterange[\s\S]*WITH &&/);
  assert.match(migration, /UNIQUE \(funcionario_id, vigencia_inicio\)/);
  assert.match(migration, /estimado_inicial.*apurado_por_vigencia/);
});

test("fontes financeiras criam vigencias sem depender do frontend", () => {
  assert.match(
    migration,
    /snapshot_custo_funcionario[\s\S]*UPDATE OF salario, encargos, categoria_mo/,
  );
  assert.match(migration, /snapshot_custo_categoria[\s\S]*UPDATE OF seguro_vida/);
  assert.match(
    migration,
    /snapshot_custo_beneficios[\s\S]*assistencia_medica[\s\S]*multibeneficio/,
  );
  assert.match(migration, /vigencia_fim = p_vigencia_inicio - 1/);
  assert.match(
    migration,
    /DELETE FROM public\.funcionario_custos_vigencias[\s\S]*vigencia_inicio = p_vigencia_inicio/,
  );
});

test("historico inicial usa primeira evidencia e fica explicitamente estimado", () => {
  assert.match(migration, /min\(rh\.data\)[\s\S]*min\(a\.data\)[\s\S]*data_admissao/);
  assert.match(migration, /'implantacao', 'estimado_inicial'/);
});

test("servidor usa vigencia por data e nao recalcula passado com configuracao atual", () => {
  assert.match(server, /from\("funcionario_custos_vigencias"/);
  assert.match(server, /vigenciaNaData\(vigencias, f\.id, registro\.data\)/);
  assert.match(server, /custoRegistroNaVigencia/);
  assert.doesNotMatch(server, /from\("beneficios_config"\)/);
  assert.doesNotMatch(server, /from\("categoria_salarios"\)/);
  assert.doesNotMatch(server, /\.select\("id,categoria_mo,salario/);
  assert.match(
    server,
    /Parte do custo historico utiliza a base financeira disponivel na implantacao/,
  );
});

test("categoria selecionada fica mapeada e divergencia operacional e apenas informativa", () => {
  assert.doesNotMatch(route, /categorias\s*\.filter\(\(c\) => c\.tipo === i\.tipoMo\)/);
  assert.match(route, /categorias\.map\(\(c\) =>/);
  assert.match(route, /categoriaSelecionada && \(/);
  assert.match(route, />\s*Mapeado\s*</);
  assert.match(route, /categoriaSelecionada\.tipo !== i\.tipoMo/);
  assert.match(
    route,
    /Classificação operacional: \{categoriaSelecionada\.tipo\} · orçamento:[\s\S]*\{i\.tipoMo\}/,
  );
  assert.doesNotMatch(route, /text-amber-700/);
  assert.doesNotMatch(route, /ClassificaÃ|orÃ/);
  assert.match(server, /\.filter\(\(m\) => m\.categoriaMo\)/);
  assert.doesNotMatch(server, /m\.categoriaMo[\s\S]{0,100}categoria.*tipo.*===.*tipoMo/i);
});

test("realizado consolida pela categoria mapeada e preserva o tipo da baseline", () => {
  assert.match(server, /const chave = item\.categoria_mo_mapeada \?\?/);
  assert.match(server, /tipo: item\.tipo_mo/);
  assert.match(server, /const l = linhas\.get\(categoria\) \?\?/);
  assert.match(server, /l\.hhRealizado \+= classif\.hhRealizado/);
  assert.match(server, /funcoesOrcamento/);
});

test("MOI para categoria operacional MOD e validado sem mudar o tipo previsto", () => {
  assert.match(server, /conflitosCategoriaEntreTipos\(data\.mapeamentos\)/);
  assert.doesNotMatch(server, /categoria.*tipo.*===.*tipoMo/i);
  assert.match(route, /MESTRE DE OBRAS|categorias\.map/);
});

test("ativacao bloqueia somente categoria compartilhada entre MOI e MOD", () => {
  assert.match(incremental, /GROUP BY categoria_mo_mapeada/);
  assert.match(incremental, /HAVING count\(DISTINCT tipo_mo\) > 1/);
  assert.match(incremental, /associada simultaneamente a itens MOI e MOD/);
  assert.doesNotMatch(incremental, /HAVING count\(\*\) > 1/);
  assert.match(incremental, /REVOKE ALL.*FROM PUBLIC, anon/s);
});

test("bloqueio de composicao ABA permanece independente do mapeamento", () => {
  assert.match(
    parser,
    /Existem composicoes utilizadas no orcamento que nao puderam ser reconciliadas/,
  );
  assert.match(route, /disabled=\{!!previa\.erros\.length/);
});

test("dry-run incremental e transacional e nao executavel pelo cliente anonimo", () => {
  assert.match(dryRunTipos, /^BEGIN;/m);
  assert.match(dryRunTipos, /HAVING count\(DISTINCT tipo_mo\) > 1/);
  assert.match(dryRunTipos, /has_function_privilege\('anon'/);
  assert.match(dryRunTipos, /aclexplode\(coalesce\(p\.proacl, acldefault\('f', p\.proowner\)\)\)/);
  assert.match(dryRunTipos, /acl\.grantee = 0 AND acl\.privilege_type = 'EXECUTE'/);
  assert.match(dryRunTipos, /NOT has_function_privilege\('authenticated', v_oid, 'EXECUTE'\)/);
  assert.doesNotMatch(dryRunTipos, /has_function_privilege\(['"]public['"]/i);
  assert.doesNotMatch(verificacaoPlanejamento, /has_function_privilege\(['"]public['"]/i);
  assert.match(dryRunTipos, /FROM public\.categorias WHERE tipo = 'MOI'/);
  assert.match(dryRunTipos, /FROM public\.categorias WHERE tipo = 'MOD'/);
  assert.match(dryRunTipos, /v_categoria_mod, 'MOI'/);
  assert.match(dryRunTipos, /v_categoria_moi, 'MOD'/);
  assert.doesNotMatch(dryRunTipos, /Categoria MESTRE DE OBRAS ausente/);
  assert.match(dryRunTipos, /v_previsto <> 150 OR v_realizado <> 20/);
  assert.match(dryRunTipos, /Ativacao MOI\+MOD nao foi bloqueada/);
  assert.match(dryRunTipos, /bloqueio de composicoes nao reconciliadas \(como ABA\) permanece/);
  assert.match(dryRunTipos, /ROLLBACK;\s*$/);
});

test("troca de baseline e transacional e funcao nao e publica", () => {
  assert.match(migration, /FUNCTION public\.ativar_planejamento_hh_baseline/);
  assert.match(
    migration,
    /UPDATE public\.planejamento_hh_baselines[\s\S]*ativa = false[\s\S]*ativa = true/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.ativar_planejamento_hh_baseline\(uuid\) FROM PUBLIC, anon/,
  );
});

test("DTO omite custos inteiramente quando nao ha acesso financeiro", () => {
  assert.match(server, /\.\.\.\(acesso\.financeiro[\s\S]*?custoPrevisto: l\.custoPrevisto/);
  assert.match(server, /\.\.\.\(acesso\.financeiro[\s\S]*?custoPrevisto: cp/);
  assert.doesNotMatch(server, /return \{[^}]*salario/s);
});

test("dry-run e autocontido, puro e termina em rollback", () => {
  assert.match(dryRun, /^BEGIN;/m);
  assert.ok(dryRun.includes(migration.trim()));
  assert.match(dryRun, /ROLLBACK;\s*$/);
  assert.doesNotMatch(dryRun, /^\\(?:set|i|ir)\b/im);
});
