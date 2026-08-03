import assert from "node:assert/strict";
import test from "node:test";

import { formatDecimalHours, formatExtraHours } from "./formatacao-horas.ts";
import { calcularHorasJornada } from "./jornada-horas.ts";

for (const [entrada, esperado] of [
  [8.219999999999999, "8,22"],
  [11.12, "11,12"],
  [8, "8"],
  [8.2, "8,2"],
  [1.5, "1,5"],
  [0, "0"],
] as const) {
  test(`${entrada} é exibido como ${esperado}`, () => {
    assert.equal(formatDecimalHours(entrada), esperado);
  });
}

test("soma 0,1 + 0,2 não expõe resíduo binário", () => {
  assert.equal(formatDecimalHours(0.1 + 0.2), "0,3");
});

test("badge de horas extras preserva o sinal positivo", () => {
  assert.equal(formatExtraHours(8.219999999999999), "+8,22h");
});

test("formatação não altera a regra de jornada de fim de semana", () => {
  assert.deepEqual(calcularHorasJornada("07:00", "16:00", "2026-08-01"), {
    total: 8,
    horasNormais: 0,
    horasExtras: 8,
  });
});
