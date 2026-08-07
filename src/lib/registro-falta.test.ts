import assert from "node:assert/strict";
import test from "node:test";

import {
  CLASSIFICACOES_FALTA,
  mensagemErroRegistro,
  registroEhFalta,
  rotuloFalta,
  validarRegistroApontamento,
} from "./registro-falta.ts";

test("oferece as seis classificações de falta integral", () => {
  assert.deepEqual(
    CLASSIFICACOES_FALTA.map(({ value }) => value),
    ["nao_justificada", "justificada", "atestado", "suspensao", "afastamento", "outro"],
  );
});

test("horas exigem total positivo e não aceitam classificação de falta", () => {
  assert.match(
    validarRegistroApontamento({ tipo_registro: "horas", horas_normais: 0, horas_extras: 0 })!,
    /maior que zero/,
  );
  assert.equal(
    validarRegistroApontamento({ tipo_registro: "horas", horas_normais: 8, horas_extras: 0 }),
    null,
  );
  assert.ok(
    validarRegistroApontamento({
      tipo_registro: "horas",
      falta_tipo: "atestado",
      horas_normais: 8,
    }),
  );
});

test("falta exige classificação e não aceita horas positivas", () => {
  assert.match(validarRegistroApontamento({ tipo_registro: "falta" })!, /classificação/);
  assert.match(
    validarRegistroApontamento({
      tipo_registro: "falta",
      falta_tipo: "atestado",
      horas_normais: 1,
    })!,
    /não pode conter horas/,
  );
  assert.equal(
    validarRegistroApontamento({ tipo_registro: "falta", falta_tipo: "justificada" }),
    null,
  );
});

test("falta explícita não confunde ausência legada com novo tipo", () => {
  assert.equal(registroEhFalta({ tipo_registro: "falta", ausencia: true }), true);
  assert.equal(registroEhFalta({ tipo_registro: "horas", ausencia: true }), false);
  assert.equal(rotuloFalta("nao_justificada"), "Falta não justificada");
});

test("erros transacionais são apresentados de forma amigável", () => {
  assert.match(mensagemErroRegistro({ message: "REGISTRO_FALTA_JA_EXISTE" }), /falta registrada/);
  assert.match(mensagemErroRegistro({ message: "REGISTRO_HORAS_JA_EXISTE" }), /horas registradas/);
});
