import assert from "node:assert/strict";
import test from "node:test";

import {
  dadosOperacionaisKeys,
  datasDoEventoRealtime,
  derivarPeriodoCompleto,
  identificarQueriesOperacionaisAfetadas,
  periodoContemPeriodo,
  periodosSobrepoem,
  devePreservarEdicaoLocal,
  resultadoPertenceAVersaoAtual,
  type PeriodoOperacional,
} from "./dados-operacionais-query.ts";

const competenciaOutubro: PeriodoOperacional = {
  inicio: "2026-09-25",
  fim: "2026-10-24",
};

test("semana interna reutiliza somente dados completos da competencia", () => {
  const semana = { inicio: "2026-10-05", fim: "2026-10-11" };
  const dados = [
    { id: "antes", data: "2026-10-04", ausencia: false },
    { id: "inicio", data: "2026-10-05", ausencia: true },
    { id: "fim", data: "2026-10-11", ausencia: false },
    { id: "depois", data: "2026-10-12", ausencia: false },
  ];

  assert.equal(periodoContemPeriodo(competenciaOutubro, semana), true);
  assert.deepEqual(
    derivarPeriodoCompleto(dados, competenciaOutubro, semana)?.map((item) => item.id),
    ["inicio", "fim"],
  );
});

test("carregamento parcial nunca e tratado como semana vazia", () => {
  const semana = { inicio: "2026-10-05", fim: "2026-10-11" };
  assert.equal(derivarPeriodoCompleto(undefined, competenciaOutubro, semana), undefined);
});

test("semana no corte 24/25 nao pode ser derivada da competencia", () => {
  const semana = { inicio: "2026-10-19", fim: "2026-10-25" };
  assert.equal(periodoContemPeriodo(competenciaOutubro, semana), false);
  assert.equal(derivarPeriodoCompleto([], competenciaOutubro, semana), undefined);
  assert.equal(periodosSobrepoem(competenciaOutubro, semana), true);
});

test("virada de ano preserva comparacao ISO do ciclo 25-24", () => {
  const competencia = { inicio: "2026-12-25", fim: "2027-01-24" };
  const semanaInterna = { inicio: "2027-01-04", fim: "2027-01-10" };
  const semanaCorte = { inicio: "2027-01-18", fim: "2027-01-24" };
  assert.equal(periodoContemPeriodo(competencia, semanaInterna), true);
  assert.equal(periodoContemPeriodo(competencia, semanaCorte), true);
});

test("UPDATE com mudanca de data afeta origem e destino", () => {
  const evento = datasDoEventoRealtime({
    eventType: "UPDATE",
    old: { data: "2026-10-10" },
    new: { data: "2026-10-26" },
  });
  assert.deepEqual(evento, {
    conservador: false,
    datas: ["2026-10-10", "2026-10-26"],
  });
  assert.deepEqual(
    identificarQueriesOperacionaisAfetadas(
      evento,
      { inicio: "2026-10-05", fim: "2026-10-11" },
      competenciaOutubro,
    ),
    { semana: true, competencia: true },
  );
});

test("evento fora dos periodos visiveis nao invalida consultas", () => {
  const evento = datasDoEventoRealtime({
    eventType: "INSERT",
    new: { data: "2027-02-01" },
  });
  assert.deepEqual(
    identificarQueriesOperacionaisAfetadas(
      evento,
      { inicio: "2026-10-05", fim: "2026-10-11" },
      competenciaOutubro,
    ),
    { semana: false, competencia: false },
  );
});

test("DELETE sem data e payload incompleto mantem fallback conservador", () => {
  for (const payload of [
    { eventType: "DELETE", old: { id: "registro" } },
    { eventType: "UPDATE", old: { data: "2026-10-10" }, new: {} },
    { eventType: "desconhecido" },
  ]) {
    const evento = datasDoEventoRealtime(payload);
    assert.equal(evento.conservador, true);
    assert.deepEqual(
      identificarQueriesOperacionaisAfetadas(
        evento,
        { inicio: "2026-10-05", fim: "2026-10-11" },
        competenciaOutubro,
      ),
      { semana: true, competencia: true },
    );
  }
});

test("chaves isolam usuario, obra e intervalo", () => {
  const periodo = { inicio: "2026-10-05", fim: "2026-10-11" };
  assert.notDeepEqual(
    dadosOperacionaisKeys.registrosSemana("usuario-a", "obra-1", periodo),
    dadosOperacionaisKeys.registrosSemana("usuario-b", "obra-1", periodo),
  );
  assert.notDeepEqual(
    dadosOperacionaisKeys.registrosSemana("usuario-a", "obra-1", periodo),
    dadosOperacionaisKeys.registrosSemana("usuario-a", "obra-2", periodo),
  );
});

test("derivacao preserva todos os campos de jornada e ausencia", () => {
  const semana = { inicio: "2026-10-05", fim: "2026-10-11" };
  const registro = {
    id: "registro-1",
    data: "2026-10-06",
    horas_normais: 8,
    horas_extras: 2,
    ausencia: true,
    motivo_ausencia: "Ferias",
    observacoes: "Observacao preservada",
    hora_entrada: "07:00",
    hora_saida: "18:00",
  };
  const derivado = derivarPeriodoCompleto([registro], competenciaOutubro, semana);
  assert.deepEqual(derivado, [registro]);
  assert.equal(derivado?.[0], registro);
});

test("hidratacao remota preserva edicoes dirty, saving e error", () => {
  assert.equal(devePreservarEdicaoLocal("dirty"), true);
  assert.equal(devePreservarEdicaoLocal("saving"), true);
  assert.equal(devePreservarEdicaoLocal("error"), true);
  assert.equal(devePreservarEdicaoLocal("saved"), false);
  assert.equal(devePreservarEdicaoLocal("idle"), false);
});

test("resposta concorrente antiga nao pertence a edicao mais recente", () => {
  assert.equal(resultadoPertenceAVersaoAtual(2, 1), false);
  assert.equal(resultadoPertenceAVersaoAtual(2, 2), true);
});
