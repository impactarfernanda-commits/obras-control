import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { comporHorasParaVisualizacao } from "./horas-visualizacao.ts";
import { calcularJornadaDetalhada } from "./jornada-horas.ts";

const textos = (entrada: Parameters<typeof comporHorasParaVisualizacao>[0]) =>
  comporHorasParaVisualizacao(entrada).linhas.map((linha) => linha.texto);

test("07/09 07:00–16:00 com intervalo 60 mantém a engine canônica em 8h HE 100%", () => {
  const resultado = calcularJornadaDetalhada({
    data: "2026-09-07",
    horaEntrada: "07:00",
    horaSaida: "16:00",
    intervaloMinutos: 60,
    funcao: "Montador",
    feriados: new Set(["2026-09-07"]),
  });
  assert.equal(resultado.minutosNormais, 0);
  assert.equal(resultado.minutosHe50, 0);
  assert.equal(resultado.minutosHe100, 480);
});

test("Supervisor mantém 8h sem adicional de HE em sábado, domingo e feriado", () => {
  for (const data of ["2026-09-05", "2026-09-06", "2026-09-07"]) {
    const resultado = calcularJornadaDetalhada({
      data,
      horaEntrada: "07:00",
      horaSaida: "16:00",
      intervaloMinutos: 60,
      funcao: "Supervisor",
      feriados: new Set(["2026-09-07"]),
    });
    assert.equal(resultado.minutosHe50 + resultado.minutosHe100, 0);
    assert.equal(resultado.minutosSemAdicionalHe, 480);
  }
});

test("segunda feriado com zero normais e oito extras sem detalhe exibe HE 100%", () => {
  assert.deepEqual(textos({ data: "2026-09-07", horasNormais: 0, horasExtras: 8, feriado: true }), [
    "8h HE 100%",
  ]);
});

test("detalhe canônico de HE 100% e exceção do supervisor prevalecem sobre fallback", () => {
  const detalhe = {
    minutos_normais: 0,
    minutos_he_50: 0,
    minutos_he_100: 480,
    minutos_sem_adicional_he: 0,
    minutos_noturnos_reais: 0,
    minutos_noturnos_remuneraveis: 0,
  };
  assert.deepEqual(textos({ data: "2026-09-07", horasNormais: 0, horasExtras: 8, detalhe }), [
    "8h HE 100%",
  ]);
  assert.deepEqual(
    textos({
      data: "2026-09-07",
      horasNormais: 8,
      horasExtras: 0,
      feriado: true,
      detalhe: { ...detalhe, minutos_he_100: 0, minutos_sem_adicional_he: 480 },
    }),
    ["8h trabalhadas sem adicional de HE"],
  );
});

test("Alocações passa feriado em todas as composições e recalcula resumo quando o Set carrega", () => {
  const tela = readFileSync("src/routes/_authenticated/alocacoes.tsx", "utf8");
  const chamadas = [...tela.matchAll(/comporHorasParaVisualizacao\(\{([\s\S]*?)\}\)/g)];
  assert.equal(chamadas.length, 3);
  for (const chamada of chamadas) assert.match(chamada[1], /feriado: feriados.has\(a.data\)/);
  assert.match(tela, /\[alocacoes, registros, horasMap, infoHistoricoById, obras, feriados\]/);
});

test("salvar e editar jornada invalidam cache de detalhes", () => {
  const tela = readFileSync("src/routes/_authenticated/alocacoes.tsx", "utf8");
  for (const inicio of [
    "onSuccess: ({ tipoRegistro, faltaTipo, hn, he })",
    "onSuccess: ({ total, tipoRegistro })",
  ]) {
    const handler = tela.slice(tela.indexOf(inicio)).split("onError:")[0];
    assert.match(handler, /invalidateQueries\(\{ queryKey: \["registros-horas-detalhes"\] \}\)/);
  }
});

test("sábado com 10h brutas exibe somente HE 50%", () => {
  assert.deepEqual(textos({ data: "2026-08-08", horasNormais: 10, horasExtras: 0 }), [
    "10h HE 50%",
  ]);
});

test("domingo com 8h exibe somente HE 100%", () => {
  assert.deepEqual(textos({ data: "2026-08-09", horasNormais: 8, horasExtras: 0 }), ["8h HE 100%"]);
});

test("dia comum com 9h normais não cria parcela extra", () => {
  assert.deepEqual(textos({ data: "2026-08-10", horasNormais: 9, horasExtras: 0 }), ["9h normais"]);
});

test("dia comum misto mostra as parcelas sem repetir o total", () => {
  assert.deepEqual(textos({ data: "2026-08-10", horasNormais: 9, horasExtras: 1.5 }), [
    "9h normais",
    "1,5h HE 50%",
  ]);
});

test("sexta com 10,5h mostra 8h normais e 2,5h HE 50%", () => {
  assert.deepEqual(textos({ data: "2026-08-07", horasNormais: 8, horasExtras: 2.5 }), [
    "8h normais",
    "2,5h HE 50%",
  ]);
});

test("classificação visual conserva o total bruto", () => {
  const casos = [
    { data: "2026-08-07", horasNormais: 8, horasExtras: 2.5 },
    { data: "2026-08-08", horasNormais: 10, horasExtras: 0 },
    { data: "2026-08-09", horasNormais: 6, horasExtras: 2 },
  ];
  for (const caso of casos) {
    const composicao = comporHorasParaVisualizacao(caso);
    assert.equal(
      composicao.horasNormaisApuradas +
        composicao.horasExtra50Apuradas +
        composicao.horasExtra100Apuradas,
      caso.horasNormais + caso.horasExtras,
    );
  }
});

test("nenhuma composição repete o total bruto como uma parcela extra", () => {
  for (const caso of [
    { data: "2026-08-10", horasNormais: 9, horasExtras: 1.5 },
    { data: "2026-08-08", horasNormais: 10, horasExtras: 0 },
    { data: "2026-08-09", horasNormais: 8, horasExtras: 0 },
  ]) {
    const composicao = comporHorasParaVisualizacao(caso);
    assert.equal(
      composicao.linhas.some((linha) => linha.texto === `${composicao.total}h`),
      false,
    );
    assert.equal(
      composicao.linhas.reduce((soma, linha) => soma + linha.horas, 0),
      composicao.total,
    );
  }
});
