import test from "node:test";
import assert from "node:assert/strict";
import {
  classificarRegistroGerencial,
  conflitosCategoriaEntreTipos,
  consolidarPrevistoPorCategoria,
  custoAusenciaDoDia,
  custoRegistroNaVigencia,
  indicadores,
  normalizarFuncaoOrcamento,
  pendenciasAtivacaoBaseline,
  tipoEfetivoMapeamento,
  vigenciaNaData,
  type CustoVigencia,
} from "./planejamento-hh-core.ts";

test("tipo efetivo usa categoria oficial e preserva origem separadamente", () => {
  const categorias = new Map([
    ["MESTRE DE OBRA I", "MOD" as const],
    ["ADMINISTRATIVO", "MOI" as const],
  ]);
  assert.equal(tipoEfetivoMapeamento("MOI", "MESTRE DE OBRA I", categorias), "MOD");
  assert.equal(tipoEfetivoMapeamento("MOD", "ADMINISTRATIVO", categorias), "MOI");
  assert.equal(tipoEfetivoMapeamento("MOI", null, categorias), "MOI");
});

test("pendências bloqueiam ativação sem impedir a representação do rascunho", () => {
  const aba = "Existem composicoes utilizadas no orcamento que nao puderam ser reconciliadas: ABA.";
  const pendencias = pendenciasAtivacaoBaseline(
    [aba],
    [
      { funcaoOrcamento: "Mestre de obras I", tipoMo: "MOD", categoriaMo: "MESTRE DE OBRA I" },
      { funcaoOrcamento: "Sem categoria", tipoMo: "MOI", categoriaMo: null },
    ],
  );
  assert.deepEqual(pendencias, [aba, "Função sem mapeamento: Sem categoria."]);
  assert.deepEqual(
    pendenciasAtivacaoBaseline(
      [],
      [{ funcaoOrcamento: "Mestre de obras I", tipoMo: "MOD", categoriaMo: "MESTRE DE OBRA I" }],
    ),
    [],
  );
});

test("conflito considera somente tipos efetivos persistidos", () => {
  assert.deepEqual(
    pendenciasAtivacaoBaseline(
      [],
      [
        { funcaoOrcamento: "Origem MOI", tipoMo: "MOD", categoriaMo: "MESTRE DE OBRA I" },
        { funcaoOrcamento: "Origem MOD", tipoMo: "MOD", categoriaMo: "MESTRE DE OBRA I" },
      ],
    ),
    [],
  );
  assert.equal(
    pendenciasAtivacaoBaseline(
      [],
      [
        { funcaoOrcamento: "Efetivo MOI", tipoMo: "MOI", categoriaMo: "CATEGORIA" },
        { funcaoOrcamento: "Efetivo MOD", tipoMo: "MOD", categoriaMo: "CATEGORIA" },
      ],
    ).length,
    1,
  );
});

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

test("mapeamento permite divergencia entre tipo orcamentario e operacional", () => {
  const mestre = {
    funcaoOrcamento: "Mestre de obras I",
    tipoMo: "MOI" as const,
    categoriaMo: "MESTRE DE OBRAS",
  };
  assert.deepEqual(conflitosCategoriaEntreTipos([mestre]), []);
  assert.equal(mestre.tipoMo, "MOI");
  assert.deepEqual(
    conflitosCategoriaEntreTipos([
      { funcaoOrcamento: "Equipe de apoio", tipoMo: "MOD", categoriaMo: "SUPERVISOR III" },
    ]),
    [],
  );
  assert.deepEqual(
    conflitosCategoriaEntreTipos([
      { funcaoOrcamento: "Supervisor", tipoMo: "MOI", categoriaMo: "SUPERVISOR III" },
      { funcaoOrcamento: "Montador", tipoMo: "MOD", categoriaMo: "SUPERVISOR III" },
    ]),
    ["SUPERVISOR III"],
  );
});

test("itens da mesma categoria e tipo consolidam previsto sem duplicar realizado", () => {
  const linhas = consolidarPrevistoPorCategoria([
    {
      funcaoOrcamento: "Ajudante civil",
      tipoMo: "MOD",
      categoriaMo: "AJUDANTE",
      hhPrevisto: 6772.83,
      custoPrevisto: 208684.34,
    },
    {
      funcaoOrcamento: "Servente",
      tipoMo: "MOD",
      categoriaMo: "AJUDANTE",
      hhPrevisto: 779.3,
      custoPrevisto: 24016.12,
    },
    {
      funcaoOrcamento: "Ajudante de montagem",
      tipoMo: "MOD",
      categoriaMo: "AJUDANTE",
      hhPrevisto: 1540,
      custoPrevisto: 33702.41,
    },
  ]);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0]?.categoriaMo, "AJUDANTE");
  assert.equal(linhas[0]?.tipoMo, "MOD");
  assert.ok(Math.abs((linhas[0]?.hhPrevisto ?? 0) - 9092.13) < 1e-9);
  assert.deepEqual(linhas[0]?.funcoesOrcamento, [
    "Ajudante civil",
    "Servente",
    "Ajudante de montagem",
  ]);
  const hhRealizadoCategoria = 320;
  assert.equal(hhRealizadoCategoria, 320);
});

test("mesma categoria em MOI e MOD e ambigua e deve bloquear ativacao", () => {
  assert.deepEqual(
    conflitosCategoriaEntreTipos([
      { funcaoOrcamento: "Ajudante indireto", tipoMo: "MOI", categoriaMo: "AJUDANTE" },
      { funcaoOrcamento: "Ajudante civil", tipoMo: "MOD", categoriaMo: "AJUDANTE" },
    ]),
    ["AJUDANTE"],
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
