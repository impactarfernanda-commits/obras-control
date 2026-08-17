import assert from "node:assert/strict";
import test from "node:test";

import {
  calcularCustoHorasExtras,
  classificarHorasPorData,
  formatarHorasDecimais,
  podeVisualizarDetalhamentoFinanceiro,
} from "./horas-extras.ts";

test("classifica dias uteis, fim de semana e feriado sem alterar o total", () => {
  const casos = [
    ["segunda", { data: "2026-08-03", horasNormais: 9, horasExtras: 0 }, [9, 0, 0]],
    ["sexta", { data: "2026-08-07", horasNormais: 8, horasExtras: 0 }, [8, 0, 0]],
    ["sabado", { data: "2026-08-08", horasNormais: 8, horasExtras: 0 }, [0, 8, 0]],
    ["domingo", { data: "2026-08-09", horasNormais: 8, horasExtras: 0 }, [0, 0, 8]],
    [
      "feriado na quarta",
      { data: "2026-08-05", horasNormais: 8, horasExtras: 0, feriado: true },
      [0, 0, 8],
    ],
    [
      "feriado no sabado",
      { data: "2026-08-08", horasNormais: 8, horasExtras: 0, feriado: true },
      [0, 0, 8],
    ],
  ] as const;

  for (const [nome, entrada, esperado] of casos) {
    const apurado = classificarHorasPorData(entrada);
    assert.deepEqual(
      [apurado.horasNormaisApuradas, apurado.horasExtra50Apuradas, apurado.horasExtra100Apuradas],
      esperado,
      nome,
    );
    assert.equal(
      Number(entrada.horasNormais) + Number(entrada.horasExtras),
      apurado.horasNormaisApuradas + apurado.horasExtra50Apuradas + apurado.horasExtra100Apuradas,
      nome,
    );
  }
});

test("natureza do fim de semana e feriado prevalece sobre buckets mistos", () => {
  assert.deepEqual(
    classificarHorasPorData({ data: "2026-08-08", horasNormais: 8, horasExtras: 2 }),
    { horasNormaisApuradas: 0, horasExtra50Apuradas: 10, horasExtra100Apuradas: 0 },
  );
  assert.deepEqual(
    classificarHorasPorData({ data: "2026-08-09", horasNormais: 8, horasExtras: 2 }),
    { horasNormaisApuradas: 0, horasExtra50Apuradas: 0, horasExtra100Apuradas: 10 },
  );
  assert.deepEqual(
    classificarHorasPorData({
      data: "2026-08-05",
      horasNormais: 8,
      horasExtras: 2,
      feriado: true,
    }),
    { horasNormaisApuradas: 0, horasExtra50Apuradas: 0, horasExtra100Apuradas: 10 },
  );
});

const custoBase = {
  salario: 2200,
  encargos: 809.6,
  prov13: 250.8,
  provAvisoPrevio: 250.8,
  provFerias: 334.4,
};

test("engine de HE inclui a hora-base completa e permite zerar o custo base do fim de semana", () => {
  const custoHoraCem = {
    salario: 22_000,
    encargos: 0,
    prov13: 0,
    provAvisoPrevio: 0,
    provFerias: 0,
  };
  const sabado = classificarHorasPorData({
    data: "2026-08-08",
    horasNormais: 8,
    horasExtras: 0,
  });
  const domingo = classificarHorasPorData({
    data: "2026-08-09",
    horasNormais: 8,
    horasExtras: 0,
  });
  const custoSabado = calcularCustoHorasExtras(custoHoraCem, [
    { data: "2026-08-08", horasExtras: sabado.horasExtra50Apuradas },
  ]);
  const custoDomingo = calcularCustoHorasExtras(custoHoraCem, [
    { data: "2026-08-09", horasExtras: domingo.horasExtra100Apuradas },
  ]);

  assert.equal(custoHoraCem.salario / 220, 100);
  assert.equal(sabado.horasNormaisApuradas, 0);
  assert.equal(custoSabado.remuneracao50, 8 * 100 * 1.5);
  assert.equal(0 + custoSabado.custoTotal, 1_200);
  assert.equal(domingo.horasNormaisApuradas, 0);
  assert.equal(custoDomingo.remuneracao100, 8 * 100 * 2);
  assert.equal(0 + custoDomingo.custoTotal, 1_600);
  assert.equal(
    8,
    sabado.horasNormaisApuradas + sabado.horasExtra50Apuradas + sabado.horasExtra100Apuradas,
  );
  assert.equal(
    8,
    domingo.horasNormaisApuradas + domingo.horasExtra50Apuradas + domingo.horasExtra100Apuradas,
  );
});

test("salário de R$ 2.200 produz valor-hora de R$ 10 e HE 50% de R$ 30", () => {
  const custo = calcularCustoHorasExtras(custoBase, [{ data: "2026-07-27", horasExtras: 2 }]);
  assert.equal(custo.horas50, 2);
  assert.equal(custo.remuneracao50, 30);
});

test("duas horas extras no domingo são remuneradas a 100%", () => {
  const custo = calcularCustoHorasExtras(custoBase, [{ data: "2026-07-26", horasExtras: 2 }]);
  assert.equal(custo.horas100, 2);
  assert.equal(custo.remuneracao100, 40);
});

test("sábado é 50% e feriado fornecido por fonte confiável é 100%", () => {
  const feriados = new Set(["2026-07-27"]);
  const custo = calcularCustoHorasExtras(
    custoBase,
    [
      { data: "2026-07-25", horasExtras: 1 },
      { data: "2026-07-27", horasExtras: 1 },
    ],
    feriados,
  );
  assert.equal(custo.horas50, 1);
  assert.equal(custo.horas100, 1);
});

test("consolida horas normais e domingos na mesma competência", () => {
  const custo = calcularCustoHorasExtras(custoBase, [
    { data: "2026-07-25", horasExtras: 1.5 },
    { data: "2026-07-26", horasExtras: 1 },
  ]);
  assert.equal(custo.horas50, 1.5);
  assert.equal(custo.horas100, 1);
  assert.equal(custo.remuneracao, 42.5);
});

test("funcionário sem hora extra não recebe custo adicional", () => {
  assert.deepEqual(calcularCustoHorasExtras(custoBase, []), {
    horas50: 0,
    horas100: 0,
    remuneracao50: 0,
    remuneracao100: 0,
    remuneracao: 0,
    encargos: 0,
    provisao13: 0,
    provisaoAviso: 0,
    provisaoFerias: 0,
    custoTotal: 0,
  });
});

test("encargos e provisões são proporcionais sem duplicar benefícios e seguro", () => {
  const custo = calcularCustoHorasExtras(custoBase, [{ data: "2026-07-27", horasExtras: 2 }]);
  assert.equal(custo.encargos, 30 * (809.6 / 2200));
  assert.equal(custo.provisao13, 30 * (250.8 / 2200));
  assert.equal(
    custo.custoTotal,
    custo.remuneracao +
      custo.encargos +
      custo.provisao13 +
      custo.provisaoAviso +
      custo.provisaoFerias,
  );
  assert.equal("beneficios" in custo, false);
  assert.equal("seguroVida" in custo, false);
});

test("horas decimais são formatadas como duração real", () => {
  assert.equal(formatarHorasDecimais(1.5), "1h30");
  assert.equal(formatarHorasDecimais(1.43), "1h26");
});

test("registros históricos sem horas não quebram", () => {
  const custo = calcularCustoHorasExtras(custoBase, [{ data: "2026-07-27", horasExtras: null }]);
  assert.equal(custo.custoTotal, 0);
});

test("custos de HE por funcionário e centro de custo conciliam", () => {
  const registros = [
    { data: "2026-07-26", horasExtras: 1 },
    { data: "2026-07-27", horasExtras: 2 },
  ];
  const totalFuncionario = calcularCustoHorasExtras(custoBase, registros).custoTotal;
  const totalCentros = registros.reduce(
    (total, registro) => total + calcularCustoHorasExtras(custoBase, [registro]).custoTotal,
    0,
  );
  assert.ok(Math.abs(totalFuncionario - totalCentros) < 1e-10);
});

test("usuário sem permissão salarial não pode abrir detalhes financeiros", () => {
  assert.equal(podeVisualizarDetalhamentoFinanceiro(false), false);
  assert.equal(podeVisualizarDetalhamentoFinanceiro(true), true);
});
