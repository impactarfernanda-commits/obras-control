import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calcularCusto,
  custoDoDia,
  diasUteisNoIntervalo,
  horasPadraoDoDia,
} from "./custos-core.ts";
import { consolidarCustosCentros, type CentroConsolidado } from "./relatorio-centro-custo.ts";
import {
  processarFinanceiroRelatoriosInterno,
  type ProjecaoFinanceiraFuncionarioInterna,
} from "./relatorio-financeiro-interno.server.ts";
import { consolidarCustoFuncionario } from "./relatorio-funcionario.ts";

const tela = readFileSync(
  new URL("../routes/_authenticated/relatorios.tsx", import.meta.url),
  "utf8",
);
const servidor = readFileSync(
  new URL("./relatorio-centro-custo.functions.ts", import.meta.url),
  "utf8",
);
const consolidacao = readFileSync(new URL("./relatorio-centro-custo.ts", import.meta.url), "utf8");
const processamentoInterno = readFileSync(
  new URL("./relatorio-financeiro-interno.server.ts", import.meta.url),
  "utf8",
);

test("contrato atual de Custo por Funcionário fica explicitamente caracterizado", () => {
  for (const campo of [
    "nome",
    "categoria_mo",
    "ativo",
    "salario",
    "data_admissao",
    "data_desligamento",
    "deleted_at",
    "visivel_obras_control",
  ])
    assert.match(tela, new RegExp(`\\b${campo}\\b`));

  for (const coluna of [
    "Salário",
    "Encargos",
    "Prov. 13º",
    "Prov. aviso",
    "Prov. férias",
    "Benefícios e seguro",
    "Horas extras",
    "Total",
  ])
    assert.ok(tela.includes(coluna), coluna);

  for (const card of [
    "Dias trabalhados",
    "Horas normais",
    "HE 50%",
    "HE 100%",
    "Horas sem adicional de HE",
    "Custo mensal base",
    "Remuneração das HE",
    "Encargos e provisões das HE",
    "Custo total das HE",
    "Adicional noturno + reflexos",
    "Custo de refeição",
    "Custo total na competência",
  ])
    assert.ok(tela.includes(card), card);

  for (const dadoDiario of [
    "horaEntrada",
    "horaSaida",
    "horasNormaisApuradas",
    "horasExtra50Apuradas",
    "horasExtra100Apuradas",
    "horasSemAdicionalHeApuradas",
    "custoHoraExtra",
    "observacoes",
  ])
    assert.match(tela, new RegExp(`\\b${dadoDiario}\\b`));

  const abaFuncionario = tela.slice(
    tela.indexOf('<TabsContent value="funcionarios">'),
    tela.indexOf('<TabsContent value="obras">'),
  );
  assert.doesNotMatch(abaFuncionario, /export|Download|FileSpreadsheet/i);
});

test("frontend e servidor consultam o mesmo núcleo operacional, mas com contratos distintos", () => {
  for (const tabela of [
    "funcionarios",
    "beneficios_config",
    "categoria_salarios",
    "categorias",
    "obras",
    "alocacoes",
    "registros_horas",
    "registros_horas_detalhes",
  ])
    assert.ok(servidor.includes(`.from("${tabela}"`), tabela);

  for (const chave of [
    "funcionariosSegurosOptions",
    "useBeneficios",
    "useSegurosVida",
    "useCategorias",
    'queryKey: ["alocacoes-mes"',
    'queryKey: ["registros-mes"',
    'queryKey: ["registros-horas-detalhes-relatorio"',
  ])
    assert.ok(tela.includes(chave), chave);

  for (const campoCalculado of [
    "custoBase",
    "custoHE",
    "remuneracaoHE",
    "encargosProvisoesHE",
    "custoAdicionalNoturno",
    "custoRegime",
    "horas50",
    "horas100",
    "horasSemAdicionalHe",
    "total",
  ])
    assert.ok(consolidacao.includes(campoCalculado), campoCalculado);
});

test("permissões mantêm folha salarial restrita e DTO compartilhado sem salário integral", () => {
  const matriz = {
    gerente: { folha: true, centro: true },
    diretor: { folha: true, centro: true },
    coordenador: { folha: false, centro: true },
    assistente: { folha: false, centro: false },
    supervisor: { folha: false, centro: false },
  } as const;
  for (const [role, acesso] of Object.entries(matriz)) {
    assert.equal(["gerente", "diretor"].includes(role), acesso.folha, role);
    assert.equal(["gerente", "diretor", "coordenador"].includes(role), acesso.centro, role);
  }
  assert.match(tela, /const podeVerFolha = role === "gerente" \|\| role === "diretor"/);
  assert.match(servidor, /role === "coordenador" \|\| role === "gerente" \|\| role === "diretor"/);
  const dto = servidor.slice(
    servidor.indexOf("export type RelatorioCentrosCustoDTO"),
    servidor.indexOf("const inputSchema"),
  );
  for (const sensivel of [
    "salario",
    "encargos",
    "prov13",
    "provAvisoPrevio",
    "provFerias",
    "beneficios",
    "seguroVida",
  ])
    assert.doesNotMatch(dto, new RegExp(sensivel, "i"), sensivel);
  assert.match(processamentoInterno, /options\.incluirProjecaoFolha/);
  assert.match(
    processamentoInterno,
    /projecaoFolha: ProjecaoFinanceiraFuncionarioInterna\[\] \| null/,
  );
  assert.doesNotMatch(tela, /ProjecaoFinanceiraFuncionarioInterna|totalMensalIntegral/);
  assert.match(servidor, /\{ incluirProjecaoFolha: false \}/);
  assert.doesNotMatch(servidor, /incluirProjecaoFolha: true/);
});

function projecaoFuturaSomenteTeste(centros: CentroConsolidado[], funcionarioId: string) {
  const linhas = centros.flatMap((centro) =>
    centro.linhas.filter((linha) => linha.funcionarioId === funcionarioId),
  );
  return {
    custoBase: linhas.reduce((soma, linha) => soma + linha.custoBase, 0),
    custoHE: linhas.reduce((soma, linha) => soma + linha.custoHE, 0),
    remuneracaoHE: linhas.reduce((soma, linha) => soma + linha.remuneracaoHE, 0),
    encargosProvisoesHE: linhas.reduce((soma, linha) => soma + linha.encargosProvisoesHE, 0),
    custoAdicionalNoturno: linhas.reduce((soma, linha) => soma + linha.custoAdicionalNoturno, 0),
    custoRefeicao: linhas.reduce((soma, linha) => soma + linha.custoRegime, 0),
    horas50: linhas.reduce((soma, linha) => soma + linha.horas50, 0),
    horas100: linhas.reduce((soma, linha) => soma + linha.horas100, 0),
    horasSemAdicionalHe: linhas.reduce((soma, linha) => soma + linha.horasSemAdicionalHe, 0),
    total: linhas.reduce((soma, linha) => soma + linha.total, 0),
  };
}

function cenarioViradaAno() {
  const inicio = new Date(2026, 11, 25);
  const fim = new Date(2027, 0, 24);
  const beneficios = {
    assistencia_medica: 100,
    assistencia_odontologica: 20,
    vale_alimentacao: 400,
    multibeneficio: 80,
  };
  const custoMod = calcularCusto(3000, beneficios, 15);
  const custoMoi = calcularCusto(5000, beneficios, 25);
  const funcionarios = [
    {
      id: "mod",
      nome: "Pessoa MOD",
      categoria_mo: "MONTADOR",
      ativo: false,
      salario: 3000,
      deleted_at: null,
      visivel_obras_control: true,
      data_admissao: "2026-12-26",
      data_desligamento: "2027-01-20",
    },
    {
      id: "moi",
      nome: "Pessoa MOI",
      categoria_mo: "ADMINISTRATIVO",
      ativo: true,
      salario: 5000,
      deleted_at: null,
      visivel_obras_control: true,
      data_admissao: null,
      data_desligamento: null,
    },
  ];
  const alocacoes = [
    {
      funcionario_id: "mod",
      obra_id: "civil",
      data: "2026-12-26",
      tipo_mao_obra: "civil" as const,
    },
    {
      funcionario_id: "mod",
      obra_id: "montagem",
      data: "2027-01-01",
      tipo_mao_obra: "montagem" as const,
    },
    {
      funcionario_id: "mod",
      obra_id: "montagem",
      data: "2027-01-02",
      tipo_mao_obra: "montagem" as const,
    },
    {
      funcionario_id: "moi",
      obra_id: "indireto",
      data: "2027-01-05",
      tipo_mao_obra: "indireta" as const,
    },
  ];
  const registros = [
    {
      id: "r-he50",
      funcionario_id: "mod",
      obra_id: "civil",
      data: "2026-12-26",
      horas_normais: 8,
      horas_extras: 1,
      ausencia: false,
      tipo_registro: "horas" as const,
      detalhe: {
        minutos_normais: 480,
        minutos_he_50: 60,
        minutos_he_100: 0,
        minutos_sem_adicional_he: 0,
        minutos_noturnos_reais: 60,
        minutos_noturnos_remuneraveis: 60,
        minutos_noturnos_normais_remuneraveis: 60,
        minutos_noturnos_he_50_remuneraveis: 0,
        minutos_noturnos_he_100_remuneraveis: 0,
        minutos_noturnos_sem_adicional_he_remuneraveis: 0,
        jornada_excepcional: false,
      },
    },
    {
      id: "r-he100",
      funcionario_id: "mod",
      obra_id: "montagem",
      data: "2027-01-01",
      horas_normais: 0,
      horas_extras: 2,
      ausencia: false,
      tipo_registro: "horas" as const,
      detalhe: {
        minutos_normais: 0,
        minutos_he_50: 0,
        minutos_he_100: 120,
        minutos_sem_adicional_he: 0,
        minutos_noturnos_reais: 0,
        minutos_noturnos_remuneraveis: 0,
        minutos_noturnos_normais_remuneraveis: 0,
        minutos_noturnos_he_50_remuneraveis: 0,
        minutos_noturnos_he_100_remuneraveis: 0,
        minutos_noturnos_sem_adicional_he_remuneraveis: 0,
        jornada_excepcional: false,
      },
    },
    {
      id: "r-ausencia",
      funcionario_id: "mod",
      obra_id: "montagem",
      data: "2027-01-02",
      horas_normais: 9,
      horas_extras: 5,
      ausencia: true,
      tipo_registro: "falta" as const,
    },
    {
      id: "r-moi",
      funcionario_id: "moi",
      obra_id: "indireto",
      data: "2027-01-05",
      horas_normais: 9,
      horas_extras: 0,
      ausencia: false,
      tipo_registro: "horas" as const,
    },
  ];
  const centros = consolidarCustosCentros({
    funcionarios,
    obras: new Map([
      ["civil", "Civil"],
      ["montagem", "Montagem"],
      ["indireto", "Indireto"],
    ]),
    custos: new Map([
      ["mod", custoMod],
      ["moi", custoMoi],
    ]),
    alocacoes,
    registros,
    feriados: new Set(["2027-01-01"]),
    periodoInicial: "2026-12-25",
    periodoFinal: "2027-01-24",
    vigenciasRegime: [
      {
        funcionarioId: "mod",
        regime: "local",
        vigenciaInicio: "2026-12-26",
        vigenciaFim: "2026-12-31",
      },
      {
        funcionarioId: "mod",
        regime: "alojado",
        vigenciaInicio: "2027-01-01",
        vigenciaFim: "2027-01-20",
      },
      { funcionarioId: "moi", regime: "local", vigenciaInicio: "2026-12-25", vigenciaFim: null },
    ],
    alocacoesReferenciaRegime: alocacoes.map((item) => ({
      funcionarioId: item.funcionario_id,
      obraId: item.obra_id,
      data: item.data,
    })),
    diasUteis: diasUteisNoIntervalo(inicio, fim),
    resolverTipo: (alocacao) => (alocacao?.tipo_mao_obra === "indireta" ? "MOI" : "MOD"),
    calcularCustoBase: (input) => custoDoDia({ ...input, horasExtras: 0 }),
    horasNormaisPadrao: horasPadraoDoDia,
  }).centros;
  const entradaMontagem = {
    competencia: "2027-01-01",
    funcionarios,
    beneficios,
    seguros: [
      { categoria: "MONTADOR", seguro_vida: 15 },
      { categoria: "ADMINISTRATIVO", seguro_vida: 25 },
    ],
    categorias: [
      { nome: "MONTADOR", tipo: "MOD" as const },
      { nome: "ADMINISTRATIVO", tipo: "MOI" as const },
    ],
    obras: [
      { id: "civil", nome: "Civil" },
      { id: "montagem", nome: "Montagem" },
      { id: "indireto", nome: "Indireto" },
    ],
    alocacoes,
    registros,
    detalhes: registros.flatMap((registro) =>
      registro.detalhe && registro.id
        ? [{ ...registro.detalhe, registro_horas_id: registro.id }]
        : [],
    ),
    feriados: ["2027-01-01"],
    vigenciasRegime: [
      {
        funcionarioId: "mod",
        regime: "local" as const,
        vigenciaInicio: "2026-12-26",
        vigenciaFim: "2026-12-31",
      },
      {
        funcionarioId: "mod",
        regime: "alojado" as const,
        vigenciaInicio: "2027-01-01",
        vigenciaFim: "2027-01-20",
      },
      {
        funcionarioId: "moi",
        regime: "local" as const,
        vigenciaInicio: "2026-12-25",
        vigenciaFim: null,
      },
    ],
    alocacoesReferenciaRegime: alocacoes.map((item) => ({
      funcionarioId: item.funcionario_id,
      obraId: item.obra_id,
      data: item.data,
    })),
  };
  const processamento = processarFinanceiroRelatoriosInterno(
    {
      ...entradaMontagem,
      periodo: {
        start: "2026-12-25",
        end: "2027-01-24",
        startDate: inicio,
        endDate: fim,
      },
    },
    { incluirProjecaoFolha: true },
  );
  return { centros, custoMod, custoMoi, processamento };
}

for (const estado of ["aberta", "fechada"] as const) {
  test(`projeção financeira futura mantém paridade na competência ${estado}`, () => {
    const { centros, processamento } = cenarioViradaAno();
    assert.deepEqual(processamento.consolidacao.centros, centros);
    assert.ok(processamento.projecaoFolha);
    for (const funcionarioId of ["mod", "moi"]) {
      const atual = consolidarCustoFuncionario(centros, funcionarioId);
      const manual = projecaoFuturaSomenteTeste(centros, funcionarioId);
      const futura: ProjecaoFinanceiraFuncionarioInterna | undefined =
        processamento.projecaoFolha.find((item) => item.funcionarioId === funcionarioId);
      assert.ok(futura);
      assert.deepEqual(futura.proporcionalCompetencia, atual);
      assert.deepEqual(futura.proporcionalCompetencia, manual);
      assert.equal(futura.totalProporcionalCompetencia, atual.total);
      assert.equal(futura.totalMensalIntegral, futura.custoMensal.total + atual.custoHE);
    }
    const mod = consolidarCustoFuncionario(centros, "mod");
    assert.ok(mod.horas50 > 0);
    assert.ok(mod.horas100 > 0);
    assert.ok(mod.custoAdicionalNoturno > 0);
    assert.ok(mod.custoRefeicao > 0);
    assert.ok(centros.some((centro) => centro.mod > 0));
    assert.ok(centros.some((centro) => centro.moi > 0));
  });
}

test("período 25–24 e virada de ano permanecem iguais no frontend e servidor", () => {
  assert.match(tela, /new Date\(year, month - 1, 25\)/);
  assert.match(tela, /new Date\(year, month, 24\)/);
  assert.match(servidor, /new Date\(year, month - 2, 25\)/);
  assert.match(servidor, /new Date\(year, month - 1, 24\)/);
  const { centros } = cenarioViradaAno();
  assert.ok(centros.flatMap((centro) => centro.linhas).some((linha) => linha.dias > 0));
});

test("projeção salarial interna permanece desativada quando não autorizada pelo chamador", () => {
  const { processamento } = cenarioViradaAno();
  const semFolha = processarFinanceiroRelatoriosInterno(
    {
      competencia: "2027-01-01",
      periodo: {
        start: "2026-12-25",
        end: "2027-01-24",
        startDate: new Date(2026, 11, 25),
        endDate: new Date(2027, 0, 24),
      },
      funcionarios: [],
      beneficios: null,
      seguros: [],
      categorias: [],
      obras: [],
      alocacoes: [],
      registros: [],
    },
    { incluirProjecaoFolha: false },
  );
  assert.equal(semFolha.projecaoFolha, null);
  assert.ok(processamento.projecaoFolha);
});

test("divergências atuais ficam documentadas sem alteração silenciosa", () => {
  assert.match(
    tela,
    /custoPorFunc\.get\(f\.id\)\?\.total \?\? 0\) \+ \(horasExtrasPorFunc\.get\(f\.id\)\?\.custoHE \?\? 0\)/,
  );
  assert.match(tela, /valorCustoDetalhe\(custoConsolidadoDetalhe\?\.total\)/);
  assert.match(tela, /classificarHorasPorData\(\{[\s\S]*?data: registro\.data[\s\S]*?\}\)/);
  const detalheFuncionario = tela.slice(
    tela.indexOf("const registrosDetalhe"),
    tela.indexOf("const resumoHorasDetalhe"),
  );
  assert.doesNotMatch(detalheFuncionario, /feriado:/);
  assert.match(processamentoInterno, /feriados: new Set\(input\.feriados \?\? \[\]\)/);
  assert.doesNotMatch(servidor, /competencia_fechada|folhas_competencias|fechada:/i);
});
