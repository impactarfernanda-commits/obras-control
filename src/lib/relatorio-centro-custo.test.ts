import assert from "node:assert/strict";
import test from "node:test";

import { consolidarCustosCentros, type AlocacaoRelatorio } from "./relatorio-centro-custo.ts";

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

const funcionarios = [
  { id: "f1", nome: "Ana", categoria_mo: "Montador" },
  { id: "f2", nome: "Bruno", categoria_mo: "Administrativo" },
];

function alocacao(
  funcionario_id: string,
  obra_id: string,
  data: string,
  tipo_mao_obra: AlocacaoRelatorio["tipo_mao_obra"],
) {
  return { funcionario_id, obra_id, data, tipo_mao_obra };
}

function registro(
  funcionario_id: string,
  obra_id: string,
  data: string,
  horas_normais = 9,
  horas_extras = 0,
) {
  return { funcionario_id, obra_id, data, horas_normais, horas_extras, ausencia: false };
}

function consolidar(
  alocacoes: AlocacaoRelatorio[],
  registros: ReturnType<typeof registro>[],
  listaFuncionarios = funcionarios,
) {
  return consolidarCustosCentros({
    alocacoes,
    registros,
    funcionarios: listaFuncionarios,
    custos: new Map(listaFuncionarios.map((funcionario) => [funcionario.id, custo])),
    obras: new Map([
      ["o1", "001 - Centro A"],
      ["o2", "002 - Centro B"],
    ]),
    diasUteis: 22,
    resolverTipo: (item, funcionario) =>
      item?.tipo_mao_obra === "indireta" ||
      (!item?.tipo_mao_obra && funcionario.categoria_mo === "Administrativo")
        ? "MOI"
        : "MOD",
    calcularCustoBase: ({ custoMensal, diasUteis, horasNormais, ausencia }) =>
      ausencia ? 0 : (custoMensal / diasUteis) * ((horasNormais ?? 9) / 9),
    horasNormaisPadrao: () => 9,
  });
}

test("centro somente MOD mantém resumo e composição conciliados", () => {
  const resultado = consolidar(
    [alocacao("f1", "o1", "2026-07-27", "montagem")],
    [registro("f1", "o1", "2026-07-27")],
  );
  const centro = resultado.centros[0];
  assert.equal(centro.linhas.length, 1);
  assert.equal(centro.mod, centro.linhas[0].total);
  assert.equal(centro.moi, 0);
  assert.equal(centro.total, centro.mod + centro.moi);
});

test("centro somente MOI mantém resumo e composição conciliados", () => {
  const centro = consolidar(
    [alocacao("f2", "o1", "2026-07-27", "indireta")],
    [registro("f2", "o1", "2026-07-27")],
  ).centros[0];
  assert.equal(centro.mod, 0);
  assert.equal(centro.moi, centro.linhas[0].total);
});

test("centro com MOD e MOI soma os dois tipos no total geral", () => {
  const centro = consolidar(
    [
      alocacao("f1", "o1", "2026-07-27", "montagem"),
      alocacao("f2", "o1", "2026-07-27", "indireta"),
    ],
    [registro("f1", "o1", "2026-07-27"), registro("f2", "o1", "2026-07-27")],
  ).centros[0];
  assert.equal(centro.total, centro.mod + centro.moi);
  assert.equal(
    centro.total,
    centro.linhas.reduce((total, linha) => total + linha.total, 0),
  );
});

test("várias alocações do funcionário no mesmo centro são consolidadas", () => {
  const centro = consolidar(
    [
      alocacao("f1", "o1", "2026-07-27", "montagem"),
      alocacao("f1", "o1", "2026-07-28", "montagem"),
    ],
    [registro("f1", "o1", "2026-07-27"), registro("f1", "o1", "2026-07-28", 8)],
  ).centros[0];
  assert.equal(centro.linhas.length, 1);
  assert.equal(centro.linhas[0].dias, 2);
  assert.equal(centro.linhas[0].horasNormais, 17);
});

test("funcionário em dois centros tem somente sua parcela em cada centro", () => {
  const centros = consolidar(
    [
      alocacao("f1", "o1", "2026-07-27", "montagem"),
      alocacao("f1", "o2", "2026-07-28", "montagem"),
    ],
    [registro("f1", "o1", "2026-07-27"), registro("f1", "o2", "2026-07-28")],
  ).centros;
  assert.equal(centros.length, 2);
  assert.ok(centros.every((centro) => centro.linhas.length === 1));
  assert.ok(centros.every((centro) => centro.linhas[0].dias === 1));
});

test("HE 50%, HE 100% e ausência de HE são classificadas no centro", () => {
  const centro = consolidar(
    [
      alocacao("f1", "o1", "2026-07-25", "montagem"),
      alocacao("f1", "o1", "2026-07-26", "montagem"),
      alocacao("f1", "o1", "2026-07-27", "montagem"),
    ],
    [
      registro("f1", "o1", "2026-07-25", 9, 1),
      registro("f1", "o1", "2026-07-26", 9, 2),
      registro("f1", "o1", "2026-07-27", 9, 0),
    ],
  ).centros[0];
  assert.equal(centro.linhas[0].horas50, 1);
  assert.equal(centro.linhas[0].horas100, 2);
  assert.ok(centro.custoHE > 0);
});

test("tipo ausente é inferido e marcado discretamente", () => {
  const centro = consolidar(
    [alocacao("f2", "o1", "2026-07-27", null)],
    [registro("f2", "o1", "2026-07-27")],
  ).centros[0];
  assert.equal(centro.linhas[0].tipo, "MOI");
  assert.equal(centro.linhas[0].tipoInferido, true);
});

test("mesmo funcionário com MOD e MOI permanece em duas linhas conciliáveis", () => {
  const centro = consolidar(
    [
      alocacao("f1", "o1", "2026-07-27", "montagem"),
      alocacao("f1", "o1", "2026-07-28", "indireta"),
    ],
    [registro("f1", "o1", "2026-07-27"), registro("f1", "o1", "2026-07-28")],
  ).centros[0];
  assert.equal(centro.linhas.length, 2);
  assert.deepEqual(
    centro.linhas.map((linha) => linha.tipo),
    ["MOD", "MOI"],
  );
  assert.equal(
    centro.total,
    centro.linhas.reduce((total, linha) => total + linha.total, 0),
  );
});

test("custo de HE não contém nova parcela de benefícios ou seguro", () => {
  const centro = consolidar(
    [alocacao("f1", "o1", "2026-07-27", "montagem")],
    [registro("f1", "o1", "2026-07-27", 9, 2)],
  ).centros[0];
  const remuneracaoHE = 2 * (2200 / 220) * 1.5;
  assert.ok(centro.custoHE > remuneracaoHE);
  assert.ok(centro.custoHE < remuneracaoHE + custo.beneficios + custo.seguroVida);
});

test("registro histórico e centro sem dados não quebram", () => {
  const historico = consolidar([alocacao("f1", "o1", "2026-07-27", "montagem")], []).centros[0];
  assert.equal(historico.dias, 1);
  assert.deepEqual(consolidar([], []).centros, []);
});
