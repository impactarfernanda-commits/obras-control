import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calcularJornadaDetalhada } from "./jornada-horas.ts";
import { exigeJustificativaExtras, justificativaExtrasValida } from "./extras-justificativa.ts";

const tela = readFileSync(
  new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url),
  "utf8",
);
function regra(calculo: ReturnType<typeof calcularJornadaDetalhada>) {
  return {
    horasExtras: (calculo.minutosHe50 + calculo.minutosHe100) / 60,
    totalTrabalhadoMinutos: calculo.totalTrabalhadoMinutos,
  };
}

test("regra canônica exige justificativa a partir de 2 horas extras", () => {
  assert.equal(exigeJustificativaExtras({ horasExtras: 1.99, totalTrabalhadoMinutos: 600 }), false);
  assert.equal(exigeJustificativaExtras({ horasExtras: 2, totalTrabalhadoMinutos: 600 }), true);
  assert.equal(
    justificativaExtrasValida({ horasExtras: 2, totalTrabalhadoMinutos: 600 }, "   "),
    false,
  );
});

test("jornada exige justificativa somente quando ultrapassa 12 horas", () => {
  assert.equal(exigeJustificativaExtras({ horasExtras: 0, totalTrabalhadoMinutos: 720 }), false);
  assert.equal(exigeJustificativaExtras({ horasExtras: 0, totalTrabalhadoMinutos: 721 }), true);
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
