import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPERVISOR_CC_DATA_CORTE,
  categoriaEhSupervisor,
  supervisorPodeRegistrarTipoNoPeriodo,
  ratearSupervisorPorVigencias,
} from "./supervisor-cc.ts";
import { consolidarCustosCentros } from "./relatorio-centro-custo.ts";

test("Supervisor apos o corte registra somente ferias e folga de campo", () => {
  for (const tipoRegistro of ["ferias", "folga_campo"] as const) {
    assert.equal(
      supervisorPodeRegistrarTipoNoPeriodo({
        categoria: "Supervisor I",
        tipoRegistro,
        dataFim: "2026-08-25",
      }),
      true,
    );
  }
  for (const tipoRegistro of ["horas", "falta"] as const) {
    assert.equal(
      supervisorPodeRegistrarTipoNoPeriodo({
        categoria: "Supervisor I",
        tipoRegistro,
        dataFim: "2026-08-25",
      }),
      false,
    );
  }
});

test("regra de Supervisor preserva historico anterior e demais funcionarios", () => {
  assert.equal(
    supervisorPodeRegistrarTipoNoPeriodo({
      categoria: "Supervisor II",
      tipoRegistro: "falta",
      dataFim: "2026-08-24",
    }),
    true,
  );
  assert.equal(
    supervisorPodeRegistrarTipoNoPeriodo({
      categoria: "Eletricista",
      tipoRegistro: "horas",
      dataFim: "2026-08-25",
    }),
    true,
  );
});

test("identifica Supervisor pela categoria normalizada, nunca por role", () => {
  for (const categoria of [
    "Supervisor I",
    "SUPERVISOR II",
    " supervisor iii ",
    "Supervisor Obra",
    "Supervisor-Regional",
  ])
    assert.equal(categoriaEhSupervisor(categoria), true);
  for (const categoria of ["Montador", "Coordenador", "Assistente de Supervisor"])
    assert.equal(categoriaEhSupervisor(categoria), false);
});

function ratear(overrides: Partial<Parameters<typeof ratearSupervisorPorVigencias>[0]> = {}) {
  return ratearSupervisorPorVigencias({
    funcionarioId: "f1",
    competenciaInicio: SUPERVISOR_CC_DATA_CORTE,
    competenciaFim: "2026-09-24",
    custoMensal: 3100,
    regime: "alojado",
    vigencias: [
      {
        funcionarioId: "f1",
        obraId: "230",
        vigenciaInicio: SUPERVISOR_CC_DATA_CORTE,
        vigenciaFim: null,
      },
    ],
    ...overrides,
  });
}

test("uma vigencia cobre 100% dos dias corridos, incluindo fim de semana e feriado", () => {
  const resultado = ratear();
  assert.equal(resultado.diasAtivos, 31);
  assert.equal(resultado.parcelas[0].dias, 31);
  assert.equal(resultado.parcelas[0].peso, 1);
  assert.equal(resultado.parcelas[0].custoMensal, 3100);
  assert.equal(resultado.parcelas[0].custoRefeicaoAlojado, 31 * 77);
});

test("transferencia no meio, primeiro e ultimo dia rateiam deterministicamente", () => {
  const meio = ratear({
    vigencias: [
      {
        funcionarioId: "f1",
        obraId: "230",
        vigenciaInicio: "2026-08-25",
        vigenciaFim: "2026-09-12",
      },
      { funcionarioId: "f1", obraId: "250", vigenciaInicio: "2026-09-13", vigenciaFim: null },
    ],
  });
  assert.deepEqual(
    meio.parcelas.map((p) => p.dias),
    [19, 12],
  );
  assert.equal(
    meio.parcelas.reduce((s, p) => s + p.custoMensal, 0),
    3100,
  );
  const primeiro = ratear({
    vigencias: [
      { funcionarioId: "f1", obraId: "250", vigenciaInicio: "2026-08-25", vigenciaFim: null },
    ],
  });
  assert.equal(primeiro.parcelas[0].custoMensal, 3100);
  const ultimo = ratear({
    vigencias: [
      {
        funcionarioId: "f1",
        obraId: "230",
        vigenciaInicio: "2026-08-25",
        vigenciaFim: "2026-09-23",
      },
      { funcionarioId: "f1", obraId: "250", vigenciaInicio: "2026-09-24", vigenciaFim: null },
    ],
  });
  assert.deepEqual(
    ultimo.parcelas.map((p) => p.dias),
    [30, 1],
  );
});

test("admissao, desligamento e lacuna consideram somente periodo ativo", () => {
  const resultado = ratear({
    dataAdmissao: "2026-09-04",
    dataDesligamento: "2026-09-20",
    vigencias: [
      {
        funcionarioId: "f1",
        obraId: "230",
        vigenciaInicio: "2026-09-04",
        vigenciaFim: "2026-09-10",
      },
      {
        funcionarioId: "f1",
        obraId: "250",
        vigenciaInicio: "2026-09-12",
        vigenciaFim: "2026-09-20",
      },
    ],
  });
  assert.equal(resultado.diasAtivos, 17);
  assert.deepEqual(resultado.datasSemVigencia, ["2026-09-11"]);
  assert.equal(
    resultado.parcelas.reduce((s, p) => s + p.custoMensal, 0),
    2917.65,
  );
});

test("regime nao alojado nao recebe refeicao presumida", () => {
  const resultado = ratear({ regime: "local" });
  assert.equal(resultado.parcelas[0].custoRefeicaoAlojado, 0);
});

test("relatorio usa vigencia como MOI e ignora alocacao diaria duplicada apos o corte", () => {
  const custo = {
    salario: 1000,
    encargos: 0,
    prov13: 0,
    provAvisoPrevio: 0,
    provFerias: 0,
    beneficios: 0,
    seguroVida: 0,
    total: 3100,
  };
  const resultado = consolidarCustosCentros({
    alocacoes: [
      { funcionario_id: "f1", obra_id: "diario", data: "2026-08-25", tipo_mao_obra: "civil" },
    ],
    registros: [
      {
        funcionario_id: "f1",
        obra_id: "diario",
        data: "2026-08-25",
        horas_normais: 9,
        horas_extras: 0,
        ausencia: false,
      },
    ],
    funcionarios: [{ id: "f1", nome: "Supervisor", categoria_mo: "Supervisor I" }],
    custos: new Map([["f1", custo]]),
    obras: new Map([
      ["vigente", "CC vigente"],
      ["diario", "CC diário"],
    ]),
    diasUteis: 23,
    resolverTipo: () => "MOD",
    calcularCustoBase: () => 999,
    horasNormaisPadrao: () => 9,
    periodoInicial: "2026-08-25",
    periodoFinal: "2026-09-24",
    vigenciasCentroCusto: [
      { funcionarioId: "f1", obraId: "vigente", vigenciaInicio: "2026-08-25", vigenciaFim: null },
    ],
    vigenciasRegime: [
      { funcionarioId: "f1", regime: "alojado", vigenciaInicio: "2026-08-25", vigenciaFim: null },
    ],
  });
  assert.equal(resultado.centros.length, 1);
  assert.equal(resultado.centros[0].id, "vigente");
  assert.equal(resultado.centros[0].mod, 0);
  assert.equal(resultado.centros[0].moi, 3100 + 31 * 77);
  assert.equal(resultado.centros[0].linhas[0].custoBase, 3100);
});
