import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTO_ALOJADO_DIA_CORRIDO,
  CUSTO_LOCAL_DIA_TRABALHADO,
  apurarCustosRegime,
  regimeNaData,
  ultimaAlocacaoNaData,
  type RegimeVigencia,
} from "./regimes.ts";

const funcionarioId = "00000000-0000-4000-8000-000000000001";
const obraA = "00000000-0000-4000-8000-000000000101";
const obraB = "00000000-0000-4000-8000-000000000102";

test("local custa R$ 45 uma vez por data efetivamente trabalhada", () => {
  const resultado = apurarCustosRegime({
    vigencias: [
      { funcionarioId, regime: "local", vigenciaInicio: "2026-08-01", vigenciaFim: null },
    ],
    alocacoes: [],
    diasTrabalhados: [
      { funcionarioId, obraId: obraA, data: "2026-08-03" },
      { funcionarioId, obraId: obraA, data: "2026-08-03" },
      { funcionarioId, obraId: obraA, data: "2026-08-04" },
    ],
    inicio: "2026-08-01",
    fim: "2026-08-04",
  });
  assert.equal(
    resultado.lancamentos.reduce((total, item) => total + item.valor, 0),
    2 * CUSTO_LOCAL_DIA_TRABALHADO,
  );
});

test("alojado custa R$ 77 em todo dia corrido mesmo sem jornada", () => {
  const resultado = apurarCustosRegime({
    vigencias: [
      { funcionarioId, regime: "alojado", vigenciaInicio: "2026-08-08", vigenciaFim: null },
    ],
    alocacoes: [{ funcionarioId, obraId: obraA, data: "2026-08-07" }],
    diasTrabalhados: [],
    inicio: "2026-08-08",
    fim: "2026-08-10",
  });
  assert.deepEqual(
    resultado.lancamentos.map((item) => [item.data, item.obraId, item.valor]),
    [
      ["2026-08-08", obraA, CUSTO_ALOJADO_DIA_CORRIDO],
      ["2026-08-09", obraA, CUSTO_ALOJADO_DIA_CORRIDO],
      ["2026-08-10", obraA, CUSTO_ALOJADO_DIA_CORRIDO],
    ],
  );
});

test("novo CC passa a valer somente na data da nova alocacao", () => {
  const alocacoes = [
    { funcionarioId, obraId: obraA, data: "2026-08-07" },
    { funcionarioId, obraId: obraB, data: "2026-08-10" },
  ];
  assert.equal(ultimaAlocacaoNaData(alocacoes, funcionarioId, "2026-08-09")?.obraId, obraA);
  assert.equal(ultimaAlocacaoNaData(alocacoes, funcionarioId, "2026-08-10")?.obraId, obraB);
});

test("alojado sem alocacao anterior fica sem CC e gera sinalizacao", () => {
  const resultado = apurarCustosRegime({
    vigencias: [
      { funcionarioId, regime: "alojado", vigenciaInicio: "2026-08-01", vigenciaFim: null },
    ],
    alocacoes: [{ funcionarioId, obraId: obraA, data: "2026-08-03" }],
    diasTrabalhados: [],
    inicio: "2026-08-01",
    fim: "2026-08-03",
  });
  assert.equal(resultado.existeAlojadoSemCc, true);
  assert.deepEqual(
    resultado.lancamentos.map((item) => item.obraId),
    [null, null, obraA],
  );
});

test("regime nao informado em dia trabalhado permanece sinalizado", () => {
  const resultado = apurarCustosRegime({
    vigencias: [],
    alocacoes: [],
    diasTrabalhados: [{ funcionarioId, obraId: obraA, data: "2026-08-03" }],
    inicio: "2026-08-03",
    fim: "2026-08-03",
  });
  assert.equal(resultado.existeRegimeNaoInformado, true);
});

test("troca de regime respeita a vigencia de cada data", () => {
  const vigencias: RegimeVigencia[] = [
    { funcionarioId, regime: "local", vigenciaInicio: "2026-08-01", vigenciaFim: "2026-08-07" },
    { funcionarioId, regime: "alojado", vigenciaInicio: "2026-08-08", vigenciaFim: null },
  ];
  assert.equal(regimeNaData(vigencias, funcionarioId, "2026-08-07")?.regime, "local");
  assert.equal(regimeNaData(vigencias, funcionarioId, "2026-08-08")?.regime, "alojado");
});
