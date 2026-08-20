import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calcularJornadaDetalhada } from "./jornada-horas.ts";
import { exigeJustificativaExtras, justificativaExtrasValida } from "./extras-justificativa.ts";

const tela = readFileSync(
  new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url),
  "utf8",
);
const schemaInicial = readFileSync(
  new URL(
    "../../supabase/migrations/20260611122851_3eb6e0e9-452b-4bc4-aab4-a3524a1e5ead.sql",
    import.meta.url,
  ),
  "utf8",
);

function regra(calculo: ReturnType<typeof calcularJornadaDetalhada>) {
  return {
    horasExtras: (calculo.minutosHe50 + calculo.minutosHe100) / 60,
    totalTrabalhadoMinutos: calculo.totalTrabalhadoMinutos,
  };
}

test("constraint real exige justificativa somente acima de 2 horas extras e texto não vazio", () => {
  assert.match(
    schemaInicial,
    /CONSTRAINT extras_justificativa CHECK \(horas_extras <= 2 OR \(justificativa_extras IS NOT NULL AND length\(btrim\(justificativa_extras\)\) > 0\)\)/,
  );
  assert.equal(exigeJustificativaExtras({ horasExtras: 2, totalTrabalhadoMinutos: 600 }), false);
  assert.equal(exigeJustificativaExtras({ horasExtras: 2.01, totalTrabalhadoMinutos: 600 }), true);
});

test("jornada normal salva sem justificativa", () => {
  const calculo = calcularJornadaDetalhada({
    data: "2026-08-20",
    horaEntrada: "07:00",
    horaSaida: "17:00",
    intervaloMinutos: 60,
  });
  assert.equal(calculo.valido, true);
  assert.equal(justificativaExtrasValida(regra(calculo), ""), true);
});

test("caso real 06:54–19:08 preserva cálculo e exige justificativa amigável", () => {
  const calculo = calcularJornadaDetalhada({
    data: "2026-08-20",
    horaEntrada: "06:54",
    horaSaida: "19:08",
    intervaloMinutos: 60,
  });
  assert.equal(calculo.permanenciaMinutos, 734);
  assert.equal(calculo.totalTrabalhadoMinutos, 674);
  assert.equal(calculo.minutosNormais, 540);
  assert.equal(calculo.minutosHe50, 134);
  assert.equal(justificativaExtrasValida(regra(calculo), ""), false);
  assert.equal(justificativaExtrasValida(regra(calculo), " Necessidade operacional "), true);
});

test("frontend usa campo canônico, mantém observações independentes e cobre edição", () => {
  assert.match(tela, /Justificativa da hora extra \*/);
  assert.match(tela, /Informe a justificativa para a jornada extraordinária\./);
  assert.match(tela, /p_justificativa: v\.justificativa_extras\?\.trim\(\) \|\| null/);
  assert.match(tela, /setEditJustificativa\(registro\?\.justificativaExtras \?\? ""\)/);
  assert.match(tela, /p_justificativa: editJustificativa\.trim\(\) \|\| null/);
  assert.match(tela, /Observações \(opcional\)/);
  assert.doesNotMatch(tela, /p_justificativa: v\.observacoes/);
});
