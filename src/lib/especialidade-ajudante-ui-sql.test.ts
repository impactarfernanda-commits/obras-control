import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tela = readFileSync("src/routes/_authenticated/alocacoes.tsx", "utf8");
const periodo = readFileSync("src/components/AlocarPeriodoDialog.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260817113000_especialidade_ajudante_alocacoes.sql",
  "utf8",
);
const dryRun = readFileSync(
  "supabase/manual/DRY_RUN_20260817113000_especialidade_ajudante.sql",
  "utf8",
);

test("AJUDANTE mostra campo obrigatorio Civil/Montagem nos fluxos diario e periodo", () => {
  for (const fonte of [tela, periodo]) {
    assert.match(fonte, /categoriaEhAjudante/);
    assert.match(fonte, /Atua/);
    assert.match(fonte, /value="civil"/);
    assert.match(fonte, /value="montagem"/);
  }
});

test("especialidade fica restrita a AJUDANTE e a competencia agosto/2026 em diante", () => {
  assert.match(tela, /funcionarioSelecionadoExigeEspecialidade/);
  assert.match(tela, /competenciaUsaSegmentacaoMod\(calcularCompetencia\(watchData/);
  assert.match(periodo, /periodoExigeEspecialidade/);
  assert.match(periodo, /dias\.some\(\(data\) =>/);
});

test("AJUDANTE sem selecao e bloqueado com mensagem curta", () => {
  for (const fonte of [tela, periodo])
    assert.match(fonte, /Informe se o ajudante atuar.+ em Civil ou Montagem\./);
});

test("edicao recupera classificacao e somente exige valor no periodo segmentado", () => {
  assert.match(tela, /setEditEspecialidadeAjudante\(a\.especialidade_ajudante \?\? null\)/);
  assert.match(tela, /editEspecialidadeAjudante !== null/);
  assert.match(tela, /especialidade_ajudante:[\s\S]*editEspecialidadeAjudante/);
});

test("migration preserva NULL legado e valida inserts e updates no servidor", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS especialidade_ajudante text NULL/);
  assert.match(migration, /BEFORE INSERT OR UPDATE/);
  assert.match(migration, /extract\(day FROM NEW\.data\) >= 25/);
  assert.match(migration, /v_competencia < DATE '2026-08-01'/);
  assert.match(migration, /v_categoria = 'AJUDANTE'.*especialidade_ajudante IS NULL/s);
  assert.doesNotMatch(migration, /UPDATE public\.alocacoes\s+SET especialidade_ajudante/i);
});

test("dry-run e transacional e nunca confirma dados", () => {
  assert.match(dryRun, /^--[\s\S]*BEGIN;/);
  assert.match(dryRun, /ROLLBACK;\s*$/);
  assert.doesNotMatch(dryRun, /COMMIT;/);
});

test("dry-run pre-migration aplica o DDL integral antes da primeira fixture", () => {
  const ddlMigration = migration.replace(/^(?:--.*\r?\n)+/, "").trim();
  assert.ok(dryRun.includes(ddlMigration), "DDL da migration deve permanecer sincronizado");

  const coluna = dryRun.indexOf("ADD COLUMN IF NOT EXISTS especialidade_ajudante");
  const funcao = dryRun.indexOf("CREATE OR REPLACE FUNCTION public.validar_especialidade");
  const trigger = dryRun.indexOf("CREATE TRIGGER trg_validar_especialidade");
  const primeiraFixture = dryRun.indexOf("INSERT INTO public.alocacoes");
  assert.ok(coluna >= 0 && funcao > coluna && trigger > funcao);
  assert.ok(primeiraFixture > trigger, "fixture nao pode usar a coluna antes do DDL/trigger");
});

test("dry-run cobre legado, matriz MOD e igualdade financeira", () => {
  assert.match(dryRun, /Legado real, quando existir, permanece somente legivel/);
  assert.match(dryRun, /DATE '2026-07-26', 'civil'/);
  assert.match(dryRun, /DATE '2026-07-27', 'montagem'/);
  assert.doesNotMatch(dryRun, /UPDATE public\.alocacoes/);
  for (const categoria of [
    "MONTADOR",
    "MESTRE DE OBRAS",
    "OPERADOR DE RETRO",
    "OPERADOR DE RETROESCAVADEIRA",
    "OPERADOR ESCAVADEIRA",
    "OPERADOR DE ESCAVADEIRA",
  ])
    assert.ok(dryRun.includes(`'${categoria}'`));
  assert.match(dryRun, /\('OPERADOR ESCAVADEIRA', 'MOD Civil'\)/);
  assert.match(dryRun, /\('OPERADOR DE ESCAVADEIRA', 'MOD Civil'\)/);
  assert.doesNotMatch(dryRun, /\('OPERADOR(?: DE)? ESCAVADEIRA', 'MOD a classificar'\)/);
  assert.match(
    dryRun,
    /v_mod_civil \+ v_mod_montagem \+ v_mod_a_classificar \+ v_moi <> v_total_antes/,
  );
});

test("fixtures sinteticas nao dependem de funcionario real elegivel", () => {
  assert.doesNotMatch(
    dryRun,
    /FROM public\.funcionarios\s+WHERE upper\(btrim\(categoria_mo\)\) <> 'AJUDANTE' LIMIT 1/,
  );
  for (const criterio of [
    /v_ajudante uuid := gen_random_uuid\(\)/,
    /v_nao_ajudante uuid := gen_random_uuid\(\)/,
    /INSERT INTO public\.funcionarios/,
    /'__DRY_RUN_AJUDANTE_'/,
    /'__DRY_RUN_PEDREIRO_'/,
    /true, DATE '2026-07-01', NULL, NULL, true/,
    /INSERT INTO public\.obras/,
    /'__DRY_RUN_OBRA_'/,
  ])
    assert.match(dryRun, criterio);
});

test("competencia fechada usa tabela temporaria sem reabrir estado real", () => {
  assert.match(dryRun, /v_agosto_fechado boolean := public\.competencia_fechada/);
  assert.match(dryRun, /CREATE TEMP TABLE dry_run_alocacoes_fixture/);
  assert.match(dryRun, /CREATE TRIGGER trg_validar_especialidade_ajudante_fixture/);
  assert.match(dryRun, /IF v_agosto_fechado THEN/);
  assert.doesNotMatch(dryRun, /UPDATE public\.fechamentos_competencia/);
  assert.match(dryRun, /DATE '2026-07-24'[\s\S]*DATE '2026-07-25'/);
});

test("tela agrupa pendencias e classifica somente os ids explicitos do grupo", () => {
  assert.match(tela, /Pendentes de classificação/);
  assert.match(tela, /filtrarPendenciasClassificacaoAjudante/);
  assert.match(tela, /agruparPendenciasClassificacaoAjudante/);
  assert.match(tela, /grupos para classificar/);
  assert.match(tela, /grupo\.alocacoes\.map\(\(\{ id \}\) => id\)/);
  assert.match(tela, /\.update\(\{ especialidade_ajudante: especialidade \}\)/);
  assert.match(tela, /\.in\("id", ids\)/);
  assert.match(tela, /\.is\("especialidade_ajudante", null\)/);
  assert.match(tela, /data\?\.length \?\? 0/);
});

test("classificacao preserva permissoes e bloqueio de competencia", () => {
  assert.match(tela, /canEditAllocationHoursByRole/);
  assert.match(tela, /alocacao\.created_by === user\?\.id/);
  assert.match(tela, /garantirCompetenciaAberta\(supabase, data\)/);
  assert.match(tela, /competenciaSelecionadaFechada/);
});

test("formulario por periodo pede especialidade uma vez e replica em todas as linhas", () => {
  assert.equal(periodo.match(/<Label>Atuação do ajudante \*<\/Label>/g)?.length, 1);
  assert.match(periodo, /const alocRows = diasAlvo\.map/);
  assert.match(periodo, /especialidade_ajudante:[\s\S]*\? especialidadeAjudante[\s\S]*: null/);
});

test("formularios ocultam e limpam a especialidade para nao-AJUDANTE", () => {
  assert.match(
    tela,
    /if \(!funcionarioSelecionadoExigeEspecialidade\) form\.setValue\("especialidade_ajudante", null\)/,
  );
  assert.match(periodo, /if \(!periodoExigeEspecialidade\) setEspecialidadeAjudante\(null\)/);
});
