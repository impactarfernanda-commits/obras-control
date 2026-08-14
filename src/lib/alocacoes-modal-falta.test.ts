import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calcularHorasJornada } from "./jornada-horas.ts";
import {
  CLASSIFICACOES_FALTA,
  mensagemErroRegistro,
  validarRegistroApontamento,
} from "./registro-falta.ts";

const arquivo = readFileSync("src/routes/_authenticated/alocacoes.tsx", "utf8");
const modal = arquivo.slice(
  arquivo.indexOf("<DialogTitle>Lançar dia trabalhado</DialogTitle>"),
  arquivo.indexOf(
    "</DialogContent>",
    arquivo.indexOf("<DialogTitle>Lançar dia trabalhado</DialogTitle>"),
  ),
);

test("modal real renderiza Tipo de registro", () => {
  assert.match(modal, /<FormLabel>Tipo de registro<\/FormLabel>/);
});

test("tipo padrão é Horas trabalhadas", () => {
  assert.match(arquivo, /tipo_registro: "horas"/);
  assert.match(modal, /<SelectItem value="horas">Horas trabalhadas<\/SelectItem>/);
});

test("horas mostra entrada e saída", () => {
  assert.match(modal, /watchTipoRegistro === "horas"/);
  assert.match(modal, /Hora de entrada/);
  assert.match(modal, /Hora de saída/);
});

test("falta mantém entrada e saída fora do ramo renderizado", () => {
  assert.match(modal, /watchTipoRegistro === "horas" \? \(/);
});

test("falta mantém cálculo automático fora do ramo renderizado", () => {
  assert.ok(modal.indexOf("Cálculo automático") > modal.indexOf('watchTipoRegistro === "horas"'));
});

test("falta mostra classificação", () => {
  assert.match(modal, /Classificação da falta \*/);
});

test("classificação é obrigatória", () => {
  assert.match(arquivo, /A classificação da falta é obrigatória/);
});

test("as seis classificações são reutilizadas", () => {
  assert.equal(CLASSIFICACOES_FALTA.length, 6);
  assert.match(modal, /CLASSIFICACOES_FALTA\.map/);
});

test("observação permanece opcional", () => {
  assert.match(modal, /Observações \(opcional\)/);
});

test("trocar para Falta limpa horários", () => {
  assert.match(modal, /setValue\("hora_entrada", ""\)/);
  assert.match(modal, /setValue\("hora_saida", ""\)/);
});

test("voltar para Horas não restaura horários", () => {
  assert.doesNotMatch(modal, /setValue\("hora_(entrada|saida)", "(07:00|17:00)"\)/);
});

test("submit de horas envia tipo_registro horas", () => {
  assert.match(arquivo, /p_tipo_registro: v\.tipo_registro/);
  assert.match(arquivo, /tipo_registro: "horas"/);
});

test("submit de falta envia tipo_registro falta", () => {
  assert.match(arquivo, /const falta = v\.tipo_registro === "falta"/);
});

test("submit de falta envia falta_tipo", () => {
  assert.match(arquivo, /p_falta_tipo: falta \? v\.falta_tipo : null/);
});

test("falta envia horas zeradas", () => {
  assert.match(arquivo, /p_horas_normais: falta \? 0 : hn/);
  assert.match(arquivo, /p_horas_extras: falta \? 0 : he/);
});

test("conflito com horas possui mensagem amigável", () => {
  assert.match(
    mensagemErroRegistro({ message: "REGISTRO_HORAS_JA_EXISTE" }),
    /horas trabalhadas lançadas/,
  );
});

test("falta duplicada possui mensagem amigável", () => {
  assert.match(mensagemErroRegistro({ message: "REGISTRO_FALTA_JA_EXISTE" }), /falta registrada/);
});

test("falta sem classificação não pode ser salva", () => {
  assert.ok(
    validarRegistroApontamento({ tipo_registro: "falta", horas_normais: 0, horas_extras: 0 }),
  );
});

test("horas zero continuam bloqueadas", () => {
  assert.ok(
    validarRegistroApontamento({ tipo_registro: "horas", horas_normais: 0, horas_extras: 0 }),
  );
});

test("fluxo antigo preserva cálculo de jornada", () => {
  assert.deepEqual(calcularHorasJornada("07:00", "16:00", "2026-08-07"), {
    total: 8,
    horasNormais: 8,
    horasExtras: 0,
  });
});

test("sábado continua calculando somente horas extras", () => {
  assert.deepEqual(calcularHorasJornada("07:00", "16:00", "2026-08-08"), {
    total: 8,
    horasNormais: 0,
    horasExtras: 8,
  });
});

test("lista mostra badge e classificação de falta", () => {
  assert.match(arquivo, /h\.tipoRegistro === "falta"/);
  assert.match(arquivo, />\s*Falta\s*</);
  assert.match(arquivo, /rotuloFalta\(h\.faltaTipo\)/);
});

test("modal reutiliza helpers e RPC sem criar lógica paralela", () => {
  assert.match(arquivo, /buscarConflitoRegistroDiario/);
  assert.match(arquivo, /validarRegistroApontamento/);
  assert.match(arquivo, /rpc\("obras_salvar_registro_horas"/);
  assert.doesNotMatch(modal, /from\("registros_horas"\)\.upsert/);
});
