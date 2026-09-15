import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { consolidarCustosCentros } from "./relatorio-centro-custo.ts";
import { calcularCustoHorasExtras } from "./horas-extras.ts";
import { calcularCustoJornadaDetalhada } from "./horas-extras.ts";
import type { RegistroRelatorio } from "./relatorio-centro-custo.ts";
import {
  consolidarCustoFuncionario,
  custoRefeicaoFuncionario,
  custoTotalCompetenciaFuncionario,
} from "./relatorio-funcionario.ts";

const custo = {
  salario: 2200,
  encargos: 809.6,
  prov13: 250.8,
  provAvisoPrevio: 250.8,
  provFerias: 334.4,
  beneficios: 500,
  seguroVida: 50,
  total: 4344.8,
};
function apurar(regime: "local" | "alojado" | null) {
  return consolidarCustosCentros({
    funcionarios: [{ id: "f", nome: "Ana", categoria_mo: "MONTADOR" }],
    obras: new Map([
      ["a", "A"],
      ["b", "B"],
    ]),
    custos: new Map([["f", custo]]),
    alocacoes: [
      { funcionario_id: "f", obra_id: "a", data: "2026-08-07", tipo_mao_obra: "montagem" },
      { funcionario_id: "f", obra_id: "b", data: "2026-08-11", tipo_mao_obra: "montagem" },
    ],
    registros: [
      {
        funcionario_id: "f",
        obra_id: "a",
        data: "2026-08-07",
        horas_normais: 9,
        horas_extras: 2,
        ausencia: false,
      },
      {
        funcionario_id: "f",
        obra_id: "b",
        data: "2026-08-11",
        horas_normais: 9,
        horas_extras: 0,
        ausencia: false,
      },
    ],
    vigenciasRegime: regime
      ? [{ funcionarioId: "f", regime, vigenciaInicio: "2026-07-25", vigenciaFim: null }]
      : [],
    periodoInicial: "2026-08-07",
    periodoFinal: "2026-08-11",
    diasUteis: 22,
    resolverTipo: () => "MOD",
    calcularCustoBase: () => custo.total / 22,
    horasNormaisPadrao: () => 9,
  }).centros;
}

for (const [regime, esperado] of [
  ["local", 90],
  ["alojado", 385],
  [null, 0],
] as const) {
  test(`refeição individual concilia com CC: ${regime ?? "sem regime"}`, () => {
    const centros = apurar(regime);
    assert.equal(custoRefeicaoFuncionario(centros, "f"), esperado);
    assert.equal(custoRefeicaoFuncionario(centros, "outro"), 0);
    for (const centro of centros) {
      const refeicao = custoRefeicaoFuncionario(centros, "f", centro.id);
      assert.equal(
        refeicao,
        centro.linhas.reduce((s, l) => s + l.custoRegime, 0),
      );
      const base = centro.linhas.reduce((s, l) => s + l.custoBase, 0);
      const extras = centro.linhas.reduce((s, l) => s + l.custoHE + l.custoAdicionalNoturno, 0);
      assert.equal(custoTotalCompetenciaFuncionario(base, extras, refeicao), centro.total);
    }
  });
}

test("mudança de CC atribui dias corridos uma vez e consolida parcelas", () => {
  const centros = apurar("alojado");
  assert.equal(custoRefeicaoFuncionario(centros, "f", "a"), 308);
  assert.equal(custoRefeicaoFuncionario(centros, "f", "b"), 77);
  assert.equal(custoRefeicaoFuncionario(centros, "f", "inexistente"), 0);
  assert.equal(custoRefeicaoFuncionario(centros, "f"), 385);
  assert.equal(custoRefeicaoFuncionario([], "f"), 0);
});

test("HE e base permanecem iguais entre regimes; total acrescenta somente refeição", () => {
  const sem = apurar(null).flatMap((c) => c.linhas);
  for (const regime of ["local", "alojado"] as const) {
    const linhas = apurar(regime).flatMap((c) => c.linhas);
    for (const linha of linhas) {
      const original = sem.find(
        (l) => l.funcionarioId === linha.funcionarioId && l.horas50 === linha.horas50,
      )!;
      const {
        custoRegimeLocal: _a,
        custoRegimeAlojado: _b,
        custoRegime: _c,
        regime: _d,
        total: _e,
        tipoInferido: _k,
        ...resto
      } = linha;
      const {
        custoRegimeLocal: _f,
        custoRegimeAlojado: _g,
        custoRegime: _h,
        regime: _i,
        total: _j,
        tipoInferido: _l,
        ...restoOriginal
      } = original;
      assert.deepEqual(resto, restoOriginal);
    }
  }
  const he = calcularCustoHorasExtras(custo, [{ data: "2026-08-07", horasExtras: 2 }]);
  assert.equal(
    sem.reduce((s, l) => s + l.custoHE, 0),
    he.custoTotal,
  );
  assert.equal(
    custoTotalCompetenciaFuncionario(custo.total, he.custoTotal, 385),
    custo.total + he.custoTotal + 385,
  );
});

test("modal preserva demais cards e tabela diária sem refeição", () => {
  const tela = readFileSync(
    new URL("../routes/_authenticated/relatorios.tsx", import.meta.url),
    "utf8",
  );
  const modal = tela.slice(tela.indexOf("<DialogTitle>Detalhamento do funcionário"));
  for (const label of [
    "Dias trabalhados",
    "Horas normais",
    "HE 50%",
    "HE 100%",
    "Total de horas",
    "Custo mensal base",
    "Remuneração das HE",
    "Encargos e provisões das HE",
    "Custo total das HE",
    "Custo de refeição",
  ])
    assert.ok(modal.includes(label));
  assert.match(modal, /valorCustoDetalhe\(custoConsolidadoDetalhe\?\.custoBase\)/);
  assert.match(modal, /valorCustoDetalhe\(custoConsolidadoDetalhe\?\.custoHE\)/);
  assert.match(modal, /valorCustoDetalhe\(custoConsolidadoDetalhe\?\.remuneracaoHE\)/);
  assert.match(modal, /valorCustoDetalhe\(custoConsolidadoDetalhe\?\.encargosProvisoesHE\)/);
  assert.ok(modal.includes("Adicional noturno + reflexos"));
  assert.doesNotMatch(modal, /horasExtrasDetalhe\.(remuneracao|encargos|provisao)/);
  assert.doesNotMatch(modal.slice(modal.indexOf("<Table>")), /refeição|custoRefeicao/i);
  assert.match(tela, /consolidarCustoFuncionario\(obrasComCusto, funcionarioDetalhe.id\)/);
});

function apurarHE(registros: RegistroRelatorio[], feriados: string[] = []) {
  return consolidarCustosCentros({
    funcionarios: [{ id: "f", nome: "Ana", categoria_mo: "MONTADOR" }],
    obras: new Map([
      ["a", "A"],
      ["b", "B"],
    ]),
    custos: new Map([["f", custo]]),
    alocacoes: registros.map((r) => ({
      funcionario_id: r.funcionario_id,
      obra_id: r.obra_id,
      data: r.data,
      tipo_mao_obra: "montagem" as const,
    })),
    registros,
    feriados: new Set(feriados),
    periodoInicial: "2026-08-01",
    periodoFinal: "2026-08-31",
    vigenciasRegime: [
      { funcionarioId: "f", regime: "local", vigenciaInicio: "2026-07-25", vigenciaFim: null },
    ],
    diasUteis: 22,
    resolverTipo: () => "MOD",
    calcularCustoBase: () => 0,
    horasNormaisPadrao: () => 9,
  }).centros;
}
const registroHE: RegistroRelatorio = {
  funcionario_id: "f",
  obra_id: "a",
  data: "2026-08-07",
  horas_normais: 0,
  horas_extras: 2,
  ausencia: false,
  tipo_registro: "horas",
};
function identidade(remuneracao: number, reflexos: number, total: number) {
  assert.ok(Math.abs(remuneracao + reflexos - total) < 1e-10);
}

for (const [nome, data, feriados, multiplicador] of [
  ["diurna", "2026-08-07", [], 1.5],
  ["feriado útil", "2026-08-07", ["2026-08-07"], 2],
  ["domingo", "2026-08-09", [], 2],
] as const) {
  test(`decomposição canônica HE ${nome} concilia por linha e consolidado`, () => {
    const centros = apurarHE([{ ...registroHE, data }], [...feriados]);
    const linha = centros[0].linhas[0];
    assert.equal(linha.remuneracaoHE, ((2 * custo.salario) / 220) * multiplicador);
    assert.equal(linha.encargosProvisoesHE, linha.custoHE - linha.remuneracaoHE);
    identidade(linha.remuneracaoHE, linha.encargosProvisoesHE, linha.custoHE);
    assert.equal(
      linha.custoHE,
      calcularCustoHorasExtras(custo, [{ data, horasExtras: 2 }], new Set(feriados)).custoTotal,
    );
    const resumo = consolidarCustoFuncionario(centros, "f");
    identidade(resumo.remuneracaoHE, resumo.encargosProvisoesHE, resumo.custoHE);
  });
}

test("HE noturna e bucket detalhado preservam cálculo e adicional separado em dois CCs", () => {
  const detalhe = {
    minutos_normais: 0,
    minutos_he_50: 120,
    minutos_he_100: 0,
    minutos_sem_adicional_he: 0,
    minutos_noturnos_reais: 120,
    minutos_noturnos_remuneraveis: (120 * 60) / 52.5,
    minutos_noturnos_he_50_remuneraveis: (120 * 60) / 52.5,
  };
  const registros = [
    { ...registroHE, detalhe },
    {
      ...registroHE,
      obra_id: "b",
      data: "2026-08-10",
      detalhe: {
        ...detalhe,
        minutos_he_50: 0,
        minutos_he_100: 120,
        minutos_noturnos_reais: 0,
        minutos_noturnos_remuneraveis: 0,
        minutos_noturnos_he_50_remuneraveis: 0,
      },
    },
  ];
  const centros = apurarHE(registros, ["2026-08-10"]);
  const noturno = calcularCustoJornadaDetalhada(custo, {
    horas50: 2,
    horas100: 0,
    horasNoturnasNormaisRemuneraveis: 0,
    horasNoturnas50Remuneraveis: (2 * 60) / 52.5,
    horasNoturnas100Remuneraveis: 0,
    horasNoturnasSemHeRemuneraveis: 0,
  });
  const fator = noturno.custoTotal / noturno.remuneracao;
  const linha = centros.find((c) => c.id === "a")!.linhas[0];
  assert.equal(linha.remuneracaoHE, noturno.remuneracao50 + noturno.remuneracao100);
  assert.equal(linha.custoHE, linha.remuneracaoHE * fator);
  assert.equal(linha.custoAdicionalNoturno, noturno.adicionalNoturno * fator);
  assert.ok(Math.abs(linha.custoHE + linha.custoAdicionalNoturno - noturno.custoTotal) < 1e-10);
  assert.equal(centros.find((c) => c.id === "b")!.linhas[0].remuneracaoHE, 40);
  const resumo = consolidarCustoFuncionario(centros, "f");
  for (const campo of ["remuneracaoHE", "encargosProvisoesHE", "custoHE"] as const) {
    assert.equal(
      resumo[campo],
      centros.flatMap((c) => c.linhas).reduce((s, l) => s + l[campo], 0),
    );
  }
  identidade(resumo.remuneracaoHE, resumo.encargosProvisoesHE, resumo.custoHE);
  assert.equal(
    resumo.total,
    resumo.custoBase + resumo.custoHE + resumo.custoAdicionalNoturno + resumo.custoRefeicao,
  );
});

test("ausência com horas anômalas permanece excluída da decomposição financeira", () => {
  const centros = apurarHE([{ ...registroHE, tipo_registro: "falta", ausencia: true }]);
  assert.equal(centros.length, 0);
  const resumo = consolidarCustoFuncionario(centros, "f");
  assert.equal(resumo.remuneracaoHE, 0);
  assert.equal(resumo.encargosProvisoesHE, 0);
  assert.equal(resumo.total, 0);
});

test("resumo consolidado soma base, HE, refeição e total de todos os CCs", () => {
  for (const regime of ["local", "alojado", null] as const) {
    const centros = apurar(regime);
    const resumo = consolidarCustoFuncionario(centros, "f");
    assert.equal(
      resumo.total,
      centros.reduce((s, c) => s + c.total, 0),
    );
    assert.equal(resumo.custoBase, (2 * custo.total) / 22);
    assert.equal(resumo.custoRefeicao, custoRefeicaoFuncionario(centros, "f"));
    assert.equal(
      resumo.custoHE,
      centros.reduce((s, c) => s + c.custoHE, 0),
    );
    assert.equal(
      resumo.total,
      resumo.custoBase + resumo.custoHE + resumo.custoAdicionalNoturno + resumo.custoRefeicao,
    );
  }
});

test("resumo preserva adicional noturno e linhas distintas do mesmo funcionário", () => {
  const centros = apurar("local");
  const linha = centros[0].linhas[0];
  centros[0].linhas.push({
    ...linha,
    tipo: "MOI",
    custoBase: 0,
    custoHE: 0,
    remuneracaoHE: 0,
    encargosProvisoesHE: 0,
    custoRegime: 0,
    custoAdicionalNoturno: 25,
    total: 25,
  });
  const resumo = consolidarCustoFuncionario(centros, "f");
  assert.equal(resumo.custoAdicionalNoturno, 25);
  assert.equal(resumo.custoRefeicao, 90);
  assert.equal(
    resumo.total,
    centros.flatMap((c) => c.linhas).reduce((s, l) => s + l.total, 0),
  );
  assert.deepEqual(consolidarCustoFuncionario(centros, "outro"), {
    custoBase: 0,
    custoHE: 0,
    remuneracaoHE: 0,
    encargosProvisoesHE: 0,
    custoAdicionalNoturno: 0,
    custoRefeicao: 0,
    total: 0,
  });
});
