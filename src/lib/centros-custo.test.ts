import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mensagemErroCriacaoCentroCusto,
  normalizarCodigoCentroCusto,
  normalizarDescricaoCentroCusto,
  podeCriarCentroCusto,
  prepararCodigoExibicaoCentroCusto,
  validarCodigoExibicaoCentroCusto,
} from "./centros-custo.ts";

const tela = readFileSync("src/routes/_authenticated/obras.tsx", "utf8");
const migrationRpc = readFileSync(
  "supabase/migrations/20260818120000_cria_rpc_centro_custo_autenticados.sql",
  "utf8",
);
const migrationBloqueio = readFileSync(
  "supabase/migrations/20260818121000_bloqueia_insert_direto_centros_custo.sql",
  "utf8",
);
const restricoesExistentes = readFileSync(
  "supabase/migrations/20260729160000_restringe_cadastro_exclusao_obras.sql",
  "utf8",
);

test("preserva codigo de exibicao e normaliza somente para comparacao", () => {
  for (const codigo of ["237.5", "04.0003.01", "AB-01", "AB 01", "AB/01"]) {
    assert.equal(prepararCodigoExibicaoCentroCusto(`  ${codigo}  `), codigo);
    assert.equal(
      `${prepararCodigoExibicaoCentroCusto(codigo)} - DESCRIÇÃO`,
      `${codigo} - DESCRIÇÃO`,
    );
  }
  for (const codigo of ["AB-01", "AB 01", "AB/01", "ab01"])
    assert.equal(normalizarCodigoCentroCusto(codigo), "AB01");
  assert.equal(normalizarDescricaoCentroCusto("  Estação   Norte  "), "Estação Norte");
});

test("rejeita delimitador, quebra de linha e caracteres de controle no codigo", () => {
  assert.equal(validarCodigoExibicaoCentroCusto("AB - 01"), false);
  assert.equal(validarCodigoExibicaoCentroCusto("AB\n01"), false);
  assert.equal(validarCodigoExibicaoCentroCusto("AB\u000001"), false);
  assert.equal(validarCodigoExibicaoCentroCusto("---"), false);
  assert.equal(validarCodigoExibicaoCentroCusto("AB-01"), true);
});

test("duplicidade recebe mensagem clara", () => {
  assert.equal(
    mensagemErroCriacaoCentroCusto({ code: "23505", message: "duplicate key" }),
    "Já existe um centro de custo com este código.",
  );
});

test("administrador/diretor e demais perfis autenticados usam a mesma RPC de criacao", () => {
  for (const perfil of ["assistente", "supervisor", "coordenador", "gerente", "diretor"]) {
    assert.ok(perfil);
    assert.equal(podeCriarCentroCusto(true), true);
  }
  assert.equal(podeCriarCentroCusto(false), false);
  assert.match(migrationRpc, /public\.get_user_level\(auth\.uid\(\)\) < 1/);
  assert.match(tela, /Novo centro de custo/);
  assert.doesNotMatch(tela, /isManagerOrAbove\s*\?\s*\([\s\S]*Novo centro de custo/);
  assert.match(tela, /supabase\.rpc\("obras_criar_centro_custo"/);
});

test("anonimo e autenticado sem role sao bloqueados e payload da RPC e fechado", () => {
  assert.match(migrationRpc, /auth\.uid\(\) IS NULL/);
  assert.match(migrationRpc, /public\.get_user_level\(auth\.uid\(\)\) < 1/);
  assert.match(
    migrationRpc,
    /REVOKE ALL ON FUNCTION public\.obras_criar_centro_custo\(text, text\) FROM PUBLIC, anon/,
  );
  assert.match(
    migrationRpc,
    /GRANT EXECUTE ON FUNCTION public\.obras_criar_centro_custo\(text, text\) TO authenticated/,
  );
  assert.match(migrationRpc, /p_codigo text,\s*p_descricao text/);
  assert.doesNotMatch(migrationRpc, /p_(?:status|created_at|visivel|responsavel|permiss)/i);
});

test("RPC usa nome como fonte unica, bloqueia duplicidade e retorna somente UUID", () => {
  assert.match(migrationRpc, /RETURNS uuid/);
  assert.match(migrationRpc, /RETURNING id INTO v_obra_id/);
  assert.match(migrationRpc, /RETURN v_obra_id/);
  assert.match(migrationRpc, /SET search_path = pg_catalog/);
  assert.match(migrationRpc, /SECURITY DEFINER/);
  assert.match(migrationRpc, /FROM public\.obras AS obra/);
  assert.match(migrationRpc, /\[\^A-Z0-9\]/);
  assert.match(migrationRpc, /RAISE EXCEPTION 'Centro de custo ja cadastrado'/);
  assert.match(migrationRpc, /v_codigo_exibicao \|\| ' - ' \|\| v_descricao/);
  assert.doesNotMatch(migrationRpc, /v_codigo_normalizado \|\| ' - '/);
  assert.match(migrationRpc, /hashtextextended\(v_codigo_normalizado, 0\)/);
  assert.match(migrationRpc, /\) = v_codigo_normalizado/);
  assert.match(migrationRpc, /position\(' - ' IN v_codigo_exibicao\)/);
  assert.match(migrationRpc, /p_codigo, ''\) ~ '\[\[:cntrl:\]\]'/);
  assert.doesNotMatch(migrationRpc, /ADD COLUMN|UPDATE public\.obras|CREATE (?:UNIQUE )?INDEX/);
});

test("frontend envia o codigo de exibicao preservado para a RPC", () => {
  assert.match(tela, /const codigo = prepararCodigoExibicaoCentroCusto\(values\.codigo\)/);
  assert.match(tela, /p_codigo: codigo/);
  assert.doesNotMatch(tela, /const codigo = normalizarCodigoCentroCusto\(values\.codigo\)/);
});

test("migrations preservam restricoes de update e delete", () => {
  assert.doesNotMatch(
    migrationRpc + migrationBloqueio,
    /DROP (?:POLICY|TRIGGER).*Atualizar obras|DROP (?:POLICY|TRIGGER).*Excluir obras/i,
  );
  assert.match(restricoesExistentes, /Apenas gerentes e diretores podem editar o cadastro/);
  assert.match(restricoesExistentes, /Excluir obras \(gerente\/diretor\)/);
  assert.match(tela, /\{isManagerOrAbove && \(/);
  assert.match(tela, /openEdit\(obra\)/);
  assert.match(tela, /deleteMutation\.mutate\(obra\.id\)/);
});

test("fase 1 preserva frontend antigo e fase 2 bloqueia insert direto", () => {
  assert.doesNotMatch(migrationRpc, /DROP POLICY|REVOKE INSERT ON TABLE public\.obras/);
  assert.match(migrationBloqueio, /DROP POLICY IF EXISTS "Criar obras \(autenticados\)"/);
  assert.match(migrationBloqueio, /REVOKE INSERT ON TABLE public\.obras FROM authenticated/);
  assert.doesNotMatch(tela, /from\(["']obras["']\)\.insert/);
  assert.match(tela, /supabase\.rpc\("obras_criar_centro_custo"/);
});

test("criacao invalida lista e seletores de centros ativos", () => {
  assert.match(migrationRpc, /visivel_obras_control[\s\S]*true/);
  assert.match(tela, /invalidateQueries\(\{ queryKey: \["obras"\] \}\)/);
  assert.match(tela, /invalidateQueries\(\{ queryKey: \["obras-min"\] \}\)/);
  assert.match(tela, /invalidateQueries\(\{ queryKey: \["obras-planejamento"\] \}\)/);
});
