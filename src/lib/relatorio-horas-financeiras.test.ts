import assert from "node:assert/strict";
import test from "node:test";
import { normalizarApuracaoHorasFinanceiras } from "./relatorio-horas-financeiras.ts";

test("SUPERVISOR II transfere HE50 histórica para horas sem adicional", () => {
  assert.deepEqual(
    normalizarApuracaoHorasFinanceiras("SUPERVISOR II", {
      horasNormaisApuradas: 8,
      horasExtra50Apuradas: 2,
      horasExtra100Apuradas: 0,
      horasSemAdicionalHeApuradas: 1,
    }),
    {
      horasNormaisApuradas: 8,
      horasExtra50Apuradas: 0,
      horasExtra100Apuradas: 0,
      horasSemAdicionalHeApuradas: 3,
    },
  );
});

test("SUPERVISOR DE MONTAGEM transfere HE100 histórica para horas sem adicional", () => {
  const apuracao = normalizarApuracaoHorasFinanceiras("Supervisor de Montagem", {
    horasNormaisApuradas: 0,
    horasExtra50Apuradas: 0,
    horasExtra100Apuradas: 9,
  });
  assert.equal(apuracao.horasExtra50Apuradas, 0);
  assert.equal(apuracao.horasExtra100Apuradas, 0);
  assert.equal(apuracao.horasSemAdicionalHeApuradas, 9);
});

for (const categoria of [
  "SUPERVISOR",
  "SUPERVISOR I",
  "SUPERVISOR III",
  "SUPERVISOR OBRA",
  "  supervisor   ii  ",
]) {
  test(`${categoria} reutiliza a identificação canônica`, () => {
    const apuracao = normalizarApuracaoHorasFinanceiras(categoria, {
      horasNormaisApuradas: 0,
      horasExtra50Apuradas: 8,
      horasExtra100Apuradas: 8,
    });
    assert.equal(apuracao.horasExtra50Apuradas, 0);
    assert.equal(apuracao.horasExtra100Apuradas, 0);
    assert.equal(apuracao.horasSemAdicionalHeApuradas, 16);
  });
}

test("funcionário comum preserva HE50 e HE100", () => {
  assert.deepEqual(
    normalizarApuracaoHorasFinanceiras("MONTADOR", {
      horasNormaisApuradas: 8,
      horasExtra50Apuradas: 2,
      horasExtra100Apuradas: 3,
    }),
    {
      horasNormaisApuradas: 8,
      horasExtra50Apuradas: 2,
      horasExtra100Apuradas: 3,
      horasSemAdicionalHeApuradas: 0,
    },
  );
});
