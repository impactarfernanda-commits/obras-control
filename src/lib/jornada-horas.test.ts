import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calcularHorasJornada,
  justificativaExtrasObrigatoria,
  payloadHorasPermitido,
} from "./jornada-horas.ts";
import { calcularCustoHorasExtras } from "./horas-extras.ts";

test("sábado 01/08/2026, 07:00–16:00 gera payload 0h normais e 8h extras", () => {
  assert.deepEqual(calcularHorasJornada("07:00", "16:00", "2026-08-01"), {
    total: 8,
    horasNormais: 0,
    horasExtras: 8,
  });
});

test("domingo 07:00–16:00 gera 8h extras", () => {
  assert.deepEqual(calcularHorasJornada("07:00", "16:00", "2026-08-02"), {
    total: 8,
    horasNormais: 0,
    horasExtras: 8,
  });
});

test("sexta-feira 07:00–16:00 gera 8h normais", () => {
  assert.deepEqual(calcularHorasJornada("07:00", "16:00", "2026-07-31"), {
    total: 8,
    horasNormais: 8,
    horasExtras: 0,
  });
});

test("segunda-feira 07:00–18:00 gera 9h normais e 1h extra", () => {
  assert.deepEqual(calcularHorasJornada("07:00", "18:00", "2026-08-03"), {
    total: 10,
    horasNormais: 9,
    horasExtras: 1,
  });
});

test("dia útil continua bloqueando extras sem horas normais", () => {
  assert.equal(payloadHorasPermitido("2026-08-03", 0, 8), false);
});

test("sábado e domingo permitem extras com zero horas normais", () => {
  assert.equal(payloadHorasPermitido("2026-08-01", 0, 8), true);
  assert.equal(payloadHorasPermitido("2026-08-02", 0, 8), true);
});

test("mais de 2h extras continua exigindo justificativa", () => {
  assert.equal(justificativaExtrasObrigatoria(2), false);
  assert.equal(justificativaExtrasObrigatoria(8), true);
});

test("zero horas normais permanece número no payload calculado", () => {
  const payload = calcularHorasJornada("07:00", "16:00", "2026-08-01");
  assert.equal(payload.horasNormais, 0);
  assert.equal(typeof payload.horasNormais, "number");
});

test("sábado é HE 50% e domingo é HE 100% nos custos", () => {
  const custo = calcularCustoHorasExtras(
    { salario: 2200, encargos: 0, prov13: 0, provAvisoPrevio: 0, provFerias: 0 },
    [
      { data: "2026-08-01", horasExtras: 8 },
      { data: "2026-08-02", horasExtras: 8 },
    ],
  );
  assert.equal(custo.horas50, 8);
  assert.equal(custo.horas100, 8);
});

test("migration preserva proteção útil e libera sábado/domingo sem horas fictícias", () => {
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260803113500_permite_extras_fim_semana.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /coalesce\(horas_extras, 0\) = 0/);
  assert.match(migration, /coalesce\(horas_normais, 0\) > 0/);
  assert.match(migration, /extract\(isodow FROM data\) IN \(6, 7\)/);
  assert.match(migration, /horas_extras >= 0 AND horas_extras <= 16/);
});
