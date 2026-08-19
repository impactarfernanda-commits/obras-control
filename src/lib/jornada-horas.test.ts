import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calcularJornadaDetalhada,
  calcularHorasJornada,
  funcaoEhSupervisor,
  justificativaExtrasObrigatoria,
  payloadHorasPermitido,
} from "./jornada-horas.ts";
import { calcularCustoHorasExtras } from "./horas-extras.ts";

function afirmarInvariantesRateio(
  input: Parameters<typeof calcularJornadaDetalhada>[0],
  repeticoes = 20,
) {
  const referencia = calcularJornadaDetalhada(input);
  assert.equal(
    referencia.segmentos.reduce((total, segmento) => total + segmento.minutosIntervalo, 0),
    referencia.intervaloMinutos,
  );
  assert.equal(
    referencia.segmentos.reduce((total, segmento) => total + segmento.minutosLiquidos, 0),
    referencia.totalTrabalhadoMinutos,
  );
  for (const segmento of referencia.segmentos) {
    assert.equal(segmento.minutosIntervalo + segmento.minutosLiquidos, segmento.minutosBrutos);
    assert.equal(
      segmento.minutosNormais +
        segmento.minutosHe50 +
        segmento.minutosHe100 +
        segmento.minutosSemAdicionalHe,
      segmento.minutosLiquidos,
    );
  }
  const rateio = referencia.segmentos.map((segmento) => segmento.minutosIntervalo);
  for (let i = 0; i < repeticoes; i += 1) {
    assert.deepEqual(
      calcularJornadaDetalhada(input).segmentos.map((segmento) => segmento.minutosIntervalo),
      rateio,
    );
  }
  return referencia;
}

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

test("jornadas com virada, limites e validações usam minutos reais", () => {
  const calcular = (horaEntrada: string, horaSaida: string, intervaloMinutos = 60) =>
    calcularJornadaDetalhada({ data: "2026-08-17", horaEntrada, horaSaida, intervaloMinutos });
  assert.equal(calcular("07:00", "17:00").totalTrabalhadoMinutos, 540);
  assert.equal(calcular("22:00", "06:00").totalTrabalhadoMinutos, 420);
  assert.equal(calcular("18:00", "06:00").exigeJustificativa, false);
  assert.equal(calcular("14:00", "03:00").totalTrabalhadoMinutos, 720);
  assert.equal(calcular("14:00", "06:00").excepcionalAcima12h, true);
  assert.equal(calcular("14:00", "06:00").valido, true);
  assert.equal(calcular("07:00", "07:00").valido, false);
  assert.equal(calcular("07:00", "08:00", 60).valido, false);
});

test("justificativa de jornada é obrigatória somente acima de 12 horas", () => {
  const calcular = (horaSaida: string) =>
    calcularJornadaDetalhada({
      data: "2026-08-17",
      horaEntrada: "00:00",
      horaSaida,
      intervaloMinutos: 0,
    });
  const podeSalvar = (horaSaida: string, justificativa = "") => {
    const jornada = calcular(horaSaida);
    return jornada.valido && (!jornada.exigeJustificativa || justificativa.trim().length > 0);
  };

  assert.equal(calcular("10:00").totalTrabalhadoMinutos, 600);
  assert.equal(podeSalvar("10:00"), true);
  assert.equal(calcular("11:59").totalTrabalhadoMinutos, 719);
  assert.equal(podeSalvar("11:59"), true);
  assert.equal(calcular("12:00").totalTrabalhadoMinutos, 720);
  assert.equal(podeSalvar("12:00"), true);
  assert.equal(calcular("12:01").totalTrabalhadoMinutos, 721);
  assert.equal(podeSalvar("12:01"), false);
  assert.equal(podeSalvar("12:01", "Regime excepcional autorizado"), true);
});

test("limite de 12 horas preserva virada e demais classificações da jornada", () => {
  const virada = calcularJornadaDetalhada({
    data: "2026-08-17",
    horaEntrada: "18:00",
    horaSaida: "06:00",
    intervaloMinutos: 0,
  });
  assert.equal(virada.atravessaMeiaNoite, true);
  assert.equal(virada.totalTrabalhadoMinutos, 720);
  assert.equal(virada.exigeJustificativa, false);
});

test("rateio proporcional fecha exatamente e limita adicional noturno a 22h–5h", () => {
  const calculo = afirmarInvariantesRateio({
    data: "2026-08-17",
    horaEntrada: "21:00",
    horaSaida: "06:00",
    intervaloMinutos: 60,
  });
  assert.equal(calculo.minutosNoturnosReais, 374);
  assert.equal(Math.round(calculo.minutosNoturnosRemuneraveis * 100) / 100, 427.43);
});

test("sábado para domingo separa HE 50% e HE 100%", () => {
  const calculo = calcularJornadaDetalhada({
    data: "2026-08-22",
    horaEntrada: "22:00",
    horaSaida: "06:00",
    intervaloMinutos: 60,
  });
  assert.equal(calculo.minutosHe50, 105);
  assert.equal(calculo.minutosHe100, 315);
});

test("feriado afeta apenas sua parcela e supervisor não gera HE", () => {
  const feriado = calcularJornadaDetalhada({
    data: "2026-08-17",
    horaEntrada: "22:00",
    horaSaida: "06:00",
    intervaloMinutos: 60,
    feriados: new Set(["2026-08-18"]),
  });
  assert.equal(feriado.minutosHe100, 315);
  const supervisorInput = {
    data: "2026-08-22",
    horaEntrada: "22:00",
    horaSaida: "06:00",
    intervaloMinutos: 60,
    funcao: "Supervisor II",
  } as const;
  const supervisor = afirmarInvariantesRateio(supervisorInput);
  const comum = calcularJornadaDetalhada({ ...supervisorInput, funcao: "Montador" });
  assert.equal(funcaoEhSupervisor("SUPERVISOR OBRA"), true);
  assert.equal(supervisor.minutosHe50 + supervisor.minutosHe100, 0);
  assert.equal(supervisor.minutosSemAdicionalHe, 420);
  assert.equal(supervisor.minutosNoturnosReais, 367);
  assert.deepEqual(
    supervisor.segmentos.map((segmento) => segmento.minutosIntervalo),
    comum.segmentos.map((segmento) => segmento.minutosIntervalo),
  );
});

test("maior resto usa inteiros e desempata pelo segmento cronologicamente anterior", () => {
  const input = {
    data: "2026-08-22",
    horaEntrada: "22:00",
    horaSaida: "06:00",
    intervaloMinutos: 60,
  } as const;
  const calculo = afirmarInvariantesRateio(input);
  // 00h–05h e 05h–06h têm resto inteiro 240; há um minuto residual.
  // O segmento 00h–05h, cronologicamente anterior, recebe esse minuto.
  assert.deepEqual(
    calculo.segmentos.map((segmento) => segmento.minutosIntervalo),
    [15, 38, 7],
  );
  const fonte = readFileSync(new URL("./jornada-horas.ts", import.meta.url), "utf8");
  assert.match(fonte, /restoInteiro:\s*produto % permanencia/);
  assert.match(fonte, /b\.restoInteiro - a\.restoInteiro \|\| a\.indice - b\.indice/);
  assert.doesNotMatch(fonte, /epsilon/i);
  assert.doesNotMatch(fonte, /resto:\s*exato - Math\.floor\(exato\)/);
});

test("supervisor preserva jornada normal útil e classifica somente excedente sem HE", () => {
  const calculo = calcularJornadaDetalhada({
    data: "2026-08-17",
    horaEntrada: "07:00",
    horaSaida: "19:00",
    intervaloMinutos: 60,
    funcao: "SUPERVISOR III",
  });
  assert.equal(calculo.minutosNormais, 540);
  assert.equal(calculo.minutosSemAdicionalHe, 120);
  assert.equal(calculo.minutosHe50 + calculo.minutosHe100, 0);
});
