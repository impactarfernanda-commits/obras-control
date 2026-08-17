import assert from "node:assert/strict";
import test from "node:test";

import {
  consolidarCustosCentros,
  type AlocacaoRelatorio,
  type RegistroRelatorio,
} from "./relatorio-centro-custo.ts";

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
  registros: RegistroRelatorio[],
  listaFuncionarios = funcionarios,
  segmentarMod = true,
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
    segmentarMod,
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

test("historico preserva MOD, MOI e Total sem exigir segmentacao", () => {
  const centro = consolidar(
    [
      alocacao("f1", "o1", "2026-07-24", "montagem"),
      alocacao("f2", "o1", "2026-07-24", "indireta"),
    ],
    [registro("f1", "o1", "2026-07-24"), registro("f2", "o1", "2026-07-24")],
    funcionarios,
    false,
  ).centros[0];
  assert.equal(centro.mod + centro.moi, centro.total);
  assert.equal(centro.linhas.find((linha) => linha.tipo === "MOD")?.tipoMod, null);
});

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

test("segmenta o cenÃ¡rio controlado sem alterar o total financeiro", () => {
  const lista = [
    { id: "pedreiro", nome: "Pedreiro", categoria_mo: "PEDREIRO", valor: 1000 },
    { id: "montador", nome: "Montador", categoria_mo: "MONTADOR I", valor: 2000 },
    { id: "aj-c", nome: "Ajudante C", categoria_mo: "AJUDANTE", valor: 500 },
    { id: "aj-m", nome: "Ajudante M", categoria_mo: "AJUDANTE", valor: 700 },
    { id: "aj-p", nome: "Ajudante P", categoria_mo: "AJUDANTE", valor: 300 },
    { id: "moi", nome: "MOI", categoria_mo: "ADMINISTRATIVO", valor: 800 },
  ];
  const data = "2026-08-03";
  const resultado = consolidarCustosCentros({
    alocacoes: lista.map((item) => ({
      funcionario_id: item.id,
      obra_id: "o1",
      data,
      tipo_mao_obra: item.id === "moi" ? "indireta" : "civil",
      especialidade_ajudante: item.id === "aj-c" ? "civil" : item.id === "aj-m" ? "montagem" : null,
    })),
    registros: lista.map((item) => registro(item.id, "o1", data)),
    funcionarios: lista,
    custos: new Map(
      lista.map((item) => [item.id, { ...custo, total: item.valor, salario: item.valor }]),
    ),
    obras: new Map([["o1", "Centro"]]),
    diasUteis: 1,
    resolverTipo: (item) => (item?.tipo_mao_obra === "indireta" ? "MOI" : "MOD"),
    calcularCustoBase: ({ custoMensal }) => custoMensal,
    horasNormaisPadrao: () => 9,
  });
  const centro = resultado.centros[0];
  assert.equal(centro.modCivil, 1500);
  assert.equal(centro.modMontagem, 2700);
  assert.equal(centro.modAClassificar, 300);
  assert.equal(centro.moi, 800);
  assert.equal(centro.total, 5300);
  assert.equal(
    centro.total,
    centro.modCivil + centro.modMontagem + centro.modAClassificar + centro.moi,
  );
});

test("relatorio integra MONTADOR, MESTRE DE OBRAS e OPERADOR DE RETROESCAVADEIRA", () => {
  const lista = [
    { id: "montador-generico", nome: "Montador", categoria_mo: "MONTADOR" },
    { id: "mestre-generico", nome: "Mestre", categoria_mo: "MESTRE DE OBRAS" },
    {
      id: "retroescavadeira",
      nome: "Operador",
      categoria_mo: "OPERADOR DE RETROESCAVADEIRA",
    },
  ];
  const data = "2026-08-04";
  const centro = consolidar(
    lista.map((item) => alocacao(item.id, "o1", data, "civil")),
    lista.map((item) => registro(item.id, "o1", data)),
    lista,
  ).centros[0];

  assert.equal(
    centro.modMontagem,
    centro.linhas.find((linha) => linha.funcionarioId === "montador-generico")?.total,
  );
  assert.equal(
    centro.modCivil,
    centro.linhas
      .filter((linha) => ["mestre-generico", "retroescavadeira"].includes(linha.funcionarioId))
      .reduce((total, linha) => total + linha.total, 0),
  );
  assert.equal(
    centro.total,
    centro.modCivil + centro.modMontagem + centro.modAClassificar + centro.moi,
  );
});

test("classificar AJUDANTE migra o valor sem alterar o total financeiro", () => {
  const ajudante = [{ id: "ajudante", nome: "Ajudante", categoria_mo: "AJUDANTE" }];
  const executar = (especialidade_ajudante: "civil" | "montagem" | null) =>
    consolidar(
      [
        {
          ...alocacao("ajudante", "o1", "2026-07-26", "civil"),
          especialidade_ajudante,
        },
      ],
      [registro("ajudante", "o1", "2026-07-26")],
      ajudante,
    ).centros[0];

  const pendente = executar(null);
  const civil = executar("civil");
  const montagem = executar("montagem");
  assert.equal(pendente.modAClassificar, pendente.total);
  assert.equal(civil.modCivil, civil.total);
  assert.equal(montagem.modMontagem, montagem.total);
  assert.equal(pendente.total, civil.total);
  assert.equal(pendente.total, montagem.total);
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

test("falta integral não soma horas, produtividade ou custo de jornada", () => {
  const resultado = consolidar(
    [alocacao("f1", "o1", "2026-08-03", "montagem")],
    [
      {
        ...registro("f1", "o1", "2026-08-03", 0, 0),
        tipo_registro: "falta" as const,
        falta_tipo: "justificada",
        horas_normais: 0,
        horas_extras: 0,
        ausencia: true,
      },
    ],
  );
  assert.equal(resultado.centros.length, 0);
});
