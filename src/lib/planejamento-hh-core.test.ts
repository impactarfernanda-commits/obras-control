import test from "node:test";
import assert from "node:assert/strict";
import {
  classificarRegistroGerencial,
  custoAusenciaDoDia,
  custoRegistroNaVigencia,
  indicadores,
  normalizarFuncaoOrcamento,
  vigenciaNaData,
  type CustoVigencia,
} from "./planejamento-hh-core.ts";

test("HH realizado soma horas normais e extras", () => {
  assert.equal(
    classificarRegistroGerencial({
      data: "2026-08-10",
      tipo_registro: "horas",
      horas_normais: 8,
      horas_extras: 2,
    }).hhRealizado,
    10,
  );
});

test("jornada teorica de ausencias e preservada", () => {
  const esperado = [
    ["2026-08-10", 9],
    ["2026-08-11", 9],
    ["2026-08-12", 9],
    ["2026-08-13", 9],
    ["2026-08-14", 8],
    ["2026-08-15", 0],
    ["2026-08-16", 0],
  ] as const;
  for (const [data, horas] of esperado) {
    assert.equal(
      classificarRegistroGerencial({ data, tipo_registro: "ferias" }).horasAusencia,
      horas,
    );
  }
});

test("ausencias tem HH zero e custo conforme classificacao", () => {
  const casos = [
    ["ferias", null, true],
    ["folga_campo", null, true],
    ["falta", "nao_justificada", false],
    ["falta", "justificada", true],
    ["falta", "atestado", true],
    ["falta", "suspensao", false],
    ["falta", "afastamento", true],
    ["falta", "outro", false],
  ] as const;
  for (const [tipo_registro, falta_tipo, remunerada] of casos) {
    const registro = { data: "2026-08-10", tipo_registro, falta_tipo };
    const resultado = classificarRegistroGerencial(registro);
    assert.equal(resultado.hhRealizado, 0);
    assert.equal(resultado.horasAusencia, 9);
    assert.equal(
      custoAusenciaDoDia({ custoMensal: 2200, diasUteis: 22, registro }),
      remunerada ? 100 : 0,
    );
  }
});

test("indicadores permitem consumo acima de 100%", () => {
  assert.deepEqual(indicadores(1000, 250), { saldo: 750, percentual: 25 });
  assert.deepEqual(indicadores(100000, 40000), { saldo: 60000, percentual: 40 });
  assert.deepEqual(indicadores(1000, 1100), { saldo: -100, percentual: 110 });
});

test("normalizacao preserva nome original fora da chave tecnica", () => {
  assert.equal(normalizarFuncaoOrcamento("  Auxiliar de Engenharia  "), "auxiliar de engenharia");
});

test("custo realizado usa a vigencia valida na data e preserva o passado", () => {
  const vigencias: CustoVigencia[] = [
    {
      funcionarioId: "f1",
      vigenciaInicio: "2026-01-01",
      vigenciaFim: "2026-09-30",
      categoriaMo: "SUPERVISOR III",
      custoMensalTotal: 8000,
      statusHistorico: "estimado_inicial",
    },
    {
      funcionarioId: "f1",
      vigenciaInicio: "2026-10-01",
      vigenciaFim: null,
      categoriaMo: "SUPERVISOR III",
      custoMensalTotal: 8700,
      statusHistorico: "apurado_por_vigencia",
    },
  ];
  assert.equal(vigenciaNaData(vigencias, "f1", "2026-08-15")?.custoMensalTotal, 8000);
  assert.equal(vigenciaNaData(vigencias, "f1", "2026-11-15")?.custoMensalTotal, 8700);
  vigencias.push({ ...vigencias[1]!, vigenciaInicio: "2027-01-01", custoMensalTotal: 9200 });
  assert.equal(vigenciaNaData(vigencias, "f1", "2026-08-15")?.custoMensalTotal, 8000);
});

test("ausencias e HE usam o custo mensal da vigencia selecionada", () => {
  const vigencia: CustoVigencia = {
    funcionarioId: "f1",
    vigenciaInicio: "2026-01-01",
    vigenciaFim: null,
    categoriaMo: "AJUDANTE",
    custoMensalTotal: 8000,
    statusHistorico: "estimado_inicial",
  };
  for (const [tipo_registro, falta_tipo, esperado] of [
    ["ferias", null, 400],
    ["folga_campo", null, 400],
    ["falta", "justificada", 400],
    ["falta", "atestado", 400],
    ["falta", "afastamento", 400],
    ["falta", "nao_justificada", 0],
    ["falta", "suspensao", 0],
    ["falta", "outro", 0],
  ] as const)
    assert.equal(
      custoRegistroNaVigencia({
        vigencia,
        diasUteis: 20,
        registro: { data: "2026-08-10", tipo_registro, falta_tipo },
      }),
      esperado,
    );
  assert.ok(
    Math.abs(
      custoRegistroNaVigencia({
        vigencia,
        diasUteis: 20,
        registro: {
          data: "2026-08-10",
          tipo_registro: "horas",
          horas_normais: 9,
          horas_extras: 2,
        },
      }) - 533.3333333333333,
    ) < 1e-9,
  );
});
