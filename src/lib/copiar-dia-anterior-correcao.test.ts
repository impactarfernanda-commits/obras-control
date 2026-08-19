import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260813121928_corrige_copia_dia_anterior_funcionarios.sql",
    import.meta.url,
  ),
  "utf8",
);
const historica = readFileSync(
  new URL(
    "../../supabase/migrations/20260813114059_copia_dia_anterior_alocacoes.sql",
    import.meta.url,
  ),
  "utf8",
);
const copiar = readFileSync(
  new URL("../components/CopiarDiaAnteriorDialog.tsx", import.meta.url),
  "utf8",
);
const alocar = readFileSync(
  new URL("../components/AlocarPeriodoDialog.tsx", import.meta.url),
  "utf8",
);
const runtime = readFileSync(new URL("./alocacoes-runtime.ts", import.meta.url), "utf8");

test("correção preserva assinatura, retorno e SECURITY INVOKER", () => {
  assert.match(
    migration,
    /obras_copiar_dia_anterior\(\s*p_obra_id uuid,\s*p_data_origem date,\s*p_data_destino date,\s*p_aplicar boolean/s,
  );
  assert.match(migration, /RETURNS jsonb[\s\S]*SECURITY INVOKER/);
  assert.doesNotMatch(migration, /SECURITY DEFINER/);
});

test("RPC corrigida não lê diretamente public.funcionarios", () => {
  assert.doesNotMatch(migration, /FROM public\.funcionarios(?:\s|;)/);
  assert.match(migration, /obras_control_funcionarios_por_ids\(v_origem\)/);
  assert.match(migration, /obras_control_funcionarios_safe\(\)/);
  assert.doesNotMatch(migration, /GRANT SELECT[\s\S]*ON public\.funcionarios/);
});

test("preview preserva contrato e aplicação transporta a especialidade no cliente", () => {
  assert.match(migration, /IF p_aplicar THEN/);
  assert.match(copiar, /p_aplicar: false/);
  assert.doesNotMatch(copiar, /p_aplicar: true/);
  assert.match(copiar, /resolverEspecialidadeAjudante/);
  assert.match(copiar, /especialidadeOrigem: alocacaoOrigem\?\.especialidade_ajudante/);
  assert.match(copiar, /especialidadeAjudante: especialidadeNovaAlocacao/);
  assert.match(copiar, /obras_copiar_jornadas_v2/);
});

test("grants da RPC permanecem mínimos", () => {
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test("elegibilidade e conflitos continuam preservados", () => {
  assert.match(
    migration,
    /data_desligamento IS NOT NULL AND f\.data_desligamento < p_data_destino/,
  );
  assert.match(migration, /s\.data_admissao IS NOT NULL AND s\.data_admissao > p_data_destino/);
  assert.match(migration, /a\.data = p_data_destino/);
  assert.match(migration, /ON CONFLICT DO NOTHING/);
});

test("horas e atomicidade continuam preservadas", () => {
  assert.match(migration, /r\.horas_normais/);
  assert.match(migration, /0, false, NULL, NULL, NULL, 'horas', NULL/);
  assert.doesNotMatch(migration, /\bCOMMIT\b/);
});

test("migration histórica continua com a implementação publicada", () => {
  assert.match(historica, /FROM public\.funcionarios f/);
  assert.doesNotMatch(historica, /corrige_copia_dia_anterior_funcionarios/);
});

test("botões compartilham size, variant e largura responsiva", () => {
  assert.match(runtime, /ALOCACAO_ACTION_BUTTON_CLASS = "w-full justify-center sm:w-44"/);
  for (const componente of [copiar, alocar]) {
    assert.match(
      componente,
      /variant="outline" size="sm" className=\{ALOCACAO_ACTION_BUTTON_CLASS\}/,
    );
  }
});

test("erros da RPC são registrados sem credenciais e continuam visíveis", () => {
  assert.match(copiar, /logErroCopiaDia\("previa", error\)/);
  assert.match(copiar, /logErroCopiaDia\("aplicacao", error\)/);
  assert.match(copiar, /toast\.error\(\(error as \{ message\?: string \}\)\.message/);
  const helper = readFileSync(new URL("./copiar-dia-anterior.ts", import.meta.url), "utf8");
  for (const campo of ["message", "code", "details", "hint"])
    assert.match(helper, new RegExp(campo));
  assert.doesNotMatch(helper, /token|jwt|session/i);
});

test("artefatos verificam ausência de SELECT geral", () => {
  for (const arquivo of [
    "diagnostico_pre_corrige_copia_dia_funcionarios.sql",
    "verificar_corrige_copia_dia_funcionarios.sql",
    "smoke_corrige_copia_dia_funcionarios.sql",
    "DRY_RUN_20260813121928_corrige_copia_dia_anterior_funcionarios.sql",
  ]) {
    const conteudo = readFileSync(
      new URL(`../../supabase/manual/${arquivo}`, import.meta.url),
      "utf8",
    );
    assert.match(
      conteudo,
      /has_table_privilege\('authenticated', 'public\.funcionarios', 'SELECT'\)/,
    );
    assert.doesNotMatch(conteudo, /\\(?:set|i|ir)\b/i);
  }
});
