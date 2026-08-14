import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  enumerarDiasCorridos,
  mensagemErroRegistro,
  TIPOS_REGISTRO,
  validarRegistroApontamento,
} from "./registro-falta.ts";

const tela = readFileSync("src/routes/_authenticated/alocacoes.tsx", "utf8");
const grade = readFileSync("src/components/RegistrosGrid.tsx", "utf8");
const alocarPeriodo = readFileSync("src/components/AlocarPeriodoDialog.tsx", "utf8");
const relatorioSemAlocacao = readFileSync("src/lib/relatorio-sem-alocacao.functions.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260814110000_adiciona_ferias_folga_campo.sql",
  "utf8",
);
const migrationDatas = readFileSync(
  "supabase/migrations/20260814080000_corrige_salario_e_bloqueia_datas_futuras.sql",
  "utf8",
);

test("tipo de registro preserva Horas e Falta e adiciona Ferias e Folga de campo", () => {
  assert.deepEqual(TIPOS_REGISTRO, ["horas", "falta", "ferias", "folga_campo"]);
  for (const label of ["Horas trabalhadas", "Falta", "Férias", "Folga de campo"]) {
    assert.match(tela, new RegExp(label));
  }
});

test("ausencias planejadas usam De/Ate, ocultam horas e aceitam futuro", () => {
  assert.match(tela, /ausenciaPlanejada \? "De" : "Data"/);
  assert.match(tela, /<FormLabel>Até<\/FormLabel>/);
  assert.match(tela, /max=\{ausenciaPlanejada \? undefined : today\}/);
  assert.match(tela, /watchTipoRegistro === "horas"/);
  assert.match(tela, /obras_salvar_ausencia_planejada_periodo/);
  assert.match(alocarPeriodo, /obras_salvar_ausencia_planejada_periodo/);
  assert.match(alocarPeriodo, /enumerarDiasCorridos/);
});

test("periodo corrido inclui sabado e domingo e aceita um unico dia", () => {
  assert.deepEqual(enumerarDiasCorridos("2026-09-04", "2026-09-07"), [
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
    "2026-09-07",
  ]);
  assert.deepEqual(enumerarDiasCorridos("2026-09-05", "2026-09-05"), ["2026-09-05"]);
  assert.deepEqual(enumerarDiasCorridos("2026-09-06", "2026-09-05"), []);
});

test("ferias e folga nunca carregam horas", () => {
  for (const tipo_registro of ["ferias", "folga_campo"] as const) {
    assert.equal(
      validarRegistroApontamento({ tipo_registro, horas_normais: 0, horas_extras: 0 }),
      null,
    );
    assert.match(
      validarRegistroApontamento({ tipo_registro, horas_normais: 1, horas_extras: 0 })!,
      /não pode conter horas/,
    );
  }
});

test("conflitos possuem mensagens objetivas e backend atomico", () => {
  assert.equal(
    mensagemErroRegistro({ message: "REGISTRO_FERIAS_JA_EXISTE" }),
    "Funcionário está de férias neste período.",
  );
  assert.equal(
    mensagemErroRegistro({ message: "REGISTRO_FOLGA_CAMPO_JA_EXISTE" }),
    "Funcionário está em folga de campo neste período.",
  );
  assert.equal(
    mensagemErroRegistro({ message: "REGISTRO_HORAS_JA_EXISTE" }),
    "Existem horas trabalhadas lançadas para este funcionário no período selecionado.",
  );
  assert.match(migration, /generate_series\(p_data_inicio, p_data_fim, interval '1 day'\)/);
  assert.match(migration, /obras_validar_conflito_apontamento_diario/);
  assert.doesNotMatch(tela, /for \([^)]*\)[\s\S]{0,200}\.rpc\(/);
});

test("horas futuras continuam bloqueadas e a grade exibe ausencias por texto", () => {
  assert.match(migrationDatas, /DATA_FUTURA_HORAS/);
  assert.match(migration, /NEW\.tipo_registro IN \('ferias', 'folga_campo'\)/);
  assert.match(migration, /RAISE EXCEPTION 'DATA_FUTURA_HORAS/);
  assert.match(grade, /rotuloTipoRegistro\(registro\.tipo_registro\)/);
  assert.match(grade, /registroEhAusenciaPlanejada/);
  assert.match(grade, /\.\.\.\(registrosRemote \?\? \[\]\)\.map/);
});

test("ausencia planejada nao cria alocacao futura e continua visivel", () => {
  assert.doesNotMatch(migration, /INSERT INTO public\.alocacoes/);
  assert.match(
    migration,
    /IF TG_TABLE_NAME = 'alocacoes' THEN[\s\S]*?RETURN NEW;[\s\S]*?IF TG_TABLE_NAME = 'registros_horas' THEN/,
  );
  assert.match(tela, /registroOnly: true/);
  assert.match(tela, /\.\.\.\(registros \?\? \[\]\)\.map/);
  assert.match(relatorioSemAlocacao, /\.in\("tipo_registro", \["ferias", "folga_campo"\]\)/);
});

test("migration nao amplia execucao publica da RPC", () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.obras_salvar_ausencia_planejada_periodo[\s\S]*FROM PUBLIC, anon;/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.obras_salvar_ausencia_planejada_periodo[\s\S]*TO authenticated;/,
  );
  assert.match(migration, /SECURITY INVOKER/);
});
