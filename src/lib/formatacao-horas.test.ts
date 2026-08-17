import assert from "node:assert/strict";
import test from "node:test";

import { formatDecimalHours, formatExtraHours, roundHours, sumHours } from "./formatacao-horas.ts";
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

test("somas de jornadas são normalizadas somente depois da agregação", () => {
  assert.equal(sumHours([9, 9, 9, 9, 8]), 44);
  assert.equal(sumHours([8.97, 8.97, 8.97, 8.97, 8.96]), 44.84);
  assert.equal(sumHours([8.9, 8.9, 8.9]), 26.7);
  assert.equal(roundHours(0.1 + 0.2), 0.3);
});

test("resíduos reais de ponto flutuante são limitados a duas casas", () => {
  assert.equal(formatDecimalHours(26.799999999999997), "26,8");
  assert.equal(formatDecimalHours(44.739999999999995), "44,74");
  assert.equal(formatExtraHours(44.739999999999995), "+44,74h");
});

test("resumo simulado de cinco dias fecha horas normais e extras", () => {
  const registros = [
    { data: "2026-08-03", normais: 8.97, extras: 0.5 },
    { data: "2026-08-04", normais: 8.97, extras: 0 },
    { data: "2026-08-05", normais: 8.97, extras: 1.25 },
    { data: "2026-08-06", normais: 8.97, extras: 0.1 },
    { data: "2026-08-07", normais: 8.96, extras: 0.2 },
  ];

  assert.equal(new Set(registros.map((registro) => registro.data)).size, 5);
  assert.equal(sumHours(registros.map((registro) => registro.normais)), 44.84);
  assert.equal(sumHours(registros.map((registro) => registro.extras)), 2.05);
  assert.equal(
    formatDecimalHours(sumHours(registros.map((registro) => registro.normais))),
    "44,84",
  );
  assert.equal(formatExtraHours(sumHours(registros.map((registro) => registro.extras))), "+2,05h");
});
