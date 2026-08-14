import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { dataLancamentoFutura } from "./data-lancamento.ts";

const funcionarios = readFileSync("src/routes/_authenticated/funcionarios.tsx", "utf8");
const relatorios = readFileSync("src/routes/_authenticated/relatorios.tsx", "utf8");
const dto = readFileSync("src/lib/relatorio-sem-alocacao.functions.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260814080000_corrige_salario_e_bloqueia_datas_futuras.sql",
  "utf8",
);
const diagnosticoSalarios = readFileSync("supabase/manual/diagnostico_salarios_um.sql", "utf8");
const dryRunSalarios = readFileSync("supabase/manual/DRY_RUN_corrige_salarios_um.sql", "utf8");
const corrigirSalarios = readFileSync("supabase/manual/corrigir_salarios_um.sql", "utf8");
const verificarSalarios = readFileSync("supabase/manual/verificar_salarios_um.sql", "utf8");
const guardOriginal = readFileSync(
  "supabase/migrations/20260611143304_93bf6f0a-9171-4d3f-8401-23230de53331.sql",
  "utf8",
);
const canViewSalario = readFileSync(
  "supabase/migrations/20260611140627_f557256b-417c-4773-9871-77c2feafd787.sql",
  "utf8",
);
const dryRunCompleto = readFileSync(
  "supabase/manual/DRY_RUN_20260814080000_corrige_salario_data.sql",
  "utf8",
);
const scriptCorrecao = readFileSync("supabase/manual/corrigir_salarios_um.sql", "utf8");

test("cadastro não cria nem envia placeholder salarial 1 para perfil não financeiro", () => {
  assert.doesNotMatch(funcionarios, /canSeeSalario\s*\?\s*0\s*:\s*1/);
  assert.match(funcionarios, /if \(canSeeSalario\) \{\s*payload\.salario/s);
  assert.match(migration, /NEW\.salario := v_salario/);
  assert.match(migration, /categoria_salarios/);
  assert.match(migration, /FUNCAO_SEM_SALARIO/);
  assert.match(migration, /v_pode_ver_financeiro/);
  assert.match(funcionarios, /visivel_obras_control: true/);
});

test("regra salarial é exclusiva de funcionário explicitamente Obras Control", () => {
  assert.match(migration, /IF NEW\.visivel_obras_control IS NOT TRUE THEN\s+RETURN NEW;/s);
  assert.match(migration, /visivel_obras_control IS NOT TRUE OR salario > 0/);
  assert.match(migration, /FUNCAO_SEM_SALARIO/);
  assert.match(migration, /NEW\.salario := v_salario/);
  assert.match(funcionarios, /f\.visivel_obras_control === true/);
});

test("passagens-only não é bloqueado nem incluído na correção de salário 1", () => {
  for (const sql of [diagnosticoSalarios, dryRunSalarios, corrigirSalarios, verificarSalarios]) {
    assert.match(sql, /visivel_obras_control IS TRUE/);
    assert.doesNotMatch(sql, /nome\s*(?:=|like|ilike)/i);
  }
  assert.match(diagnosticoSalarios, /ignorados_fora_obras_control/);
  assert.match(diagnosticoSalarios, /total_obras_control_salario_1/);
  assert.match(diagnosticoSalarios, /sem_correspondencia/);
  assert.match(diagnosticoSalarios, /ambiguos/);
});

test("guard normal preserva gerente/diretor e bloqueia demais perfis", () => {
  assert.match(guardOriginal, /guard_funcionarios_salario_update/);
  assert.match(guardOriginal, /BEFORE UPDATE ON public\.funcionarios/);
  assert.match(guardOriginal, /can_view_salario\(auth\.uid\(\)\)/);
  assert.match(canViewSalario, /role IN \('gerente', 'diretor'\)/);
  for (const role of ["assistente", "supervisor", "coordenador"]) {
    assert.doesNotMatch(canViewSalario, new RegExp(`role IN \\([^)]*'${role}'`));
  }
});

test("manutenção administrativa é fechada, canônica e sem parâmetros", () => {
  assert.match(migration, /FUNCTION public\.obras_corrigir_salarios_placeholder\(\)/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog, public/);
  assert.match(migration, /f\.salario = 1::numeric/);
  assert.match(migration, /f\.visivel_obras_control IS TRUE/);
  assert.match(migration, /c\.correspondencias = 1/);
  assert.match(migration, /c\.salario_esperado > 0/);
  assert.doesNotMatch(migration, /obras_corrigir_salarios_placeholder\([^)]*[a-z_]+/);
  assert.match(scriptCorrecao, /SELECT \* FROM public\.obras_corrigir_salarios_placeholder\(\)/);
  assert.doesNotMatch(scriptCorrecao, /UPDATE public\.funcionarios/i);
});

test("ACL da manutenção nega aplicação, PUBLIC, anon, authenticated e service_role", () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.obras_corrigir_salarios_placeholder\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/s,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.obras_corrigir_salarios_placeholder\(\) TO postgres;/,
  );
  assert.match(dryRunCompleto, /acl\.grantee = 0/);
  assert.match(dryRunCompleto, /authenticated_possui_execute/);
  assert.match(dryRunCompleto, /TESTE_FALHOU: authenticated alterou salario arbitrariamente/);
});

test("bypass interno permanece restrito ao valor canônico do placeholder", () => {
  assert.match(migration, /auth\.uid\(\) IS NULL/);
  assert.match(migration, /session_user = current_user/);
  assert.match(migration, /OLD\.salario = 1::numeric/);
  assert.match(migration, /NEW\.salario IS NOT DISTINCT FROM v_salario/);
  assert.match(migration, /NEW\.encargos IS NOT DISTINCT FROM v_encargos/);
  assert.match(migration, /v_total_correspondencias = 1/);
});

test("datas futuras são identificadas sem bloquear hoje ou passado", () => {
  assert.equal(dataLancamentoFutura("2026-08-15", "2026-08-14"), true);
  assert.equal(dataLancamentoFutura("2026-08-14", "2026-08-14"), false);
  assert.equal(dataLancamentoFutura("2026-08-13", "2026-08-14"), false);
  assert.match(migration, /NEW\.data > current_date/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF data ON public\.alocacoes/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF data ON public\.registros_horas/);
});

test("coordenador recebe relatório sem alocação operacional via servidor", () => {
  assert.match(relatorios, /getRelatorioSemAlocacao/);
  assert.match(relatorios, /<TabsTrigger value="sem-alocacao">/);
  assert.match(dto, /requireSupabaseAuth/);
  assert.match(dto, /role === "coordenador"/);
  assert.match(dto, /buscarTodasPaginas/);
  for (const campo of ["salario", "encargos", "beneficios", "seguro_vida", "custo_total"]) {
    assert.doesNotMatch(dto, new RegExp(`select\\([^)]*${campo}`, "s"));
  }
});
