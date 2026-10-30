import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calcularCusto } from "./custos-core.ts";
import {
  executarProcessamentoFinanceiroAutorizado,
  processarFinanceiroRelatoriosInterno,
  type EntradaProcessamentoFinanceiroInterno,
} from "./relatorio-financeiro-interno.server.ts";

const servidor = readFileSync(
  new URL("./relatorio-centro-custo.functions.ts", import.meta.url),
  "utf8",
);
const tela = readFileSync(
  new URL("../routes/_authenticated/relatorios.tsx", import.meta.url),
  "utf8",
);
const processamentoInterno = readFileSync(
  new URL("./relatorio-financeiro-interno.server.ts", import.meta.url),
  "utf8",
);

function entradaMinima(): EntradaProcessamentoFinanceiroInterno {
  return {
    competencia: "2026-10-01",
    periodo: {
      start: "2026-09-25",
      end: "2026-10-24",
      startDate: new Date(2026, 8, 25),
      endDate: new Date(2026, 9, 24),
    },
    funcionarios: [
      {
        id: "funcionario-1",
        nome: "Funcionário Teste",
        categoria_mo: "MONTADOR",
        ativo: true,
        salario: 3000,
        deleted_at: null,
        visivel_obras_control: true,
        data_admissao: "2026-01-01",
        data_desligamento: null,
      },
    ],
    beneficios: {
      assistencia_medica: 100,
      assistencia_odontologica: 20,
      vale_alimentacao: 400,
      multibeneficio: 80,
    },
    seguros: [{ categoria: "MONTADOR", seguro_vida: 15 }],
    categorias: [{ nome: "MONTADOR", tipo: "MOD" }],
    obras: [{ id: "obra-1", nome: "Obra Teste" }],
    alocacoes: [
      {
        id: "alocacao-1",
        funcionario_id: "funcionario-1",
        obra_id: "obra-1",
        data: "2026-10-01",
        tipo_mao_obra: "montagem",
        hora_entrada: "07:00:00",
        hora_saida: "18:00:00",
      },
    ],
    registros: [
      {
        id: "registro-1",
        funcionario_id: "funcionario-1",
        obra_id: "obra-1",
        data: "2026-10-01",
        horas_normais: 9,
        horas_extras: 2,
        ausencia: false,
        tipo_registro: "horas",
        falta_tipo: null,
        observacoes: "Atividade noturna",
      },
    ],
    detalhes: [
      {
        registro_horas_id: "registro-1",
        minutos_normais: 540,
        minutos_he_50: 120,
        minutos_he_100: 0,
        minutos_sem_adicional_he: 0,
        minutos_noturnos_reais: 60,
        minutos_noturnos_remuneraveis: 60,
        jornada_excepcional: false,
      },
    ],
    feriados: [],
  };
}

for (const role of ["gerente", "diretor"] as const) {
  test(`${role} carrega uma vez e recebe consolidado e projeção completos`, async () => {
    let carregamentos = 0;
    const entrada = entradaMinima();
    const resultado = await executarProcessamentoFinanceiroAutorizado({
      roles: [role],
      rolesPermitidas: ["gerente", "diretor"],
      mensagemProibido: "Forbidden",
      incluirProjecaoFolha: true,
      carregarEntrada: async () => {
        carregamentos += 1;
        return entrada;
      },
    });
    assert.equal(carregamentos, 1);
    assert.ok(resultado.processamento.consolidacao.centros.length > 0);
    assert.equal(resultado.processamento.projecaoFolha?.length, 1);
    const funcionario = resultado.processamento.projecaoFolha?.[0];
    assert.ok(funcionario);
    assert.deepEqual(
      funcionario.custoMensal,
      calcularCusto(3000, entrada.beneficios, entrada.seguros[0]?.seguro_vida),
    );
    assert.equal(
      funcionario.totalMensalIntegral,
      funcionario.custoMensal.total + funcionario.proporcionalCompetencia.custoHE,
    );
    assert.equal(
      funcionario.totalProporcionalCompetencia,
      funcionario.proporcionalCompetencia.total,
    );
    assert.equal(funcionario.alocacoes[0]?.hora_entrada, "07:00:00");
    assert.equal(funcionario.alocacoes[0]?.hora_saida, "18:00:00");
    assert.equal(funcionario.registros[0]?.observacoes, "Atividade noturna");
    assert.equal(funcionario.registros[0]?.detalhe?.minutos_noturnos_remuneraveis, 60);
    assert.deepEqual(funcionario.alocacoes, [
      {
        obra_id: "obra-1",
        data: "2026-10-01",
        hora_entrada: "07:00:00",
        hora_saida: "18:00:00",
      },
    ]);
    assert.deepEqual(funcionario.registros, [
      {
        id: "registro-1",
        obra_id: "obra-1",
        data: "2026-10-01",
        horas_normais: 9,
        horas_extras: 2,
        ausencia: false,
        tipo_registro: "horas",
        falta_tipo: null,
        observacoes: "Atividade noturna",
        detalhe: {
          minutos_normais: 540,
          minutos_he_50: 120,
          minutos_he_100: 0,
          minutos_sem_adicional_he: 0,
          minutos_noturnos_reais: 60,
          minutos_noturnos_remuneraveis: 60,
          jornada_excepcional: false,
        },
      },
    ]);
    const serializado = JSON.stringify(funcionario);
    for (const campoRemovido of [
      "funcionario_id",
      "tipo_mao_obra",
      "especialidade_ajudante",
      "minutos_noturnos_normais_remuneraveis",
      "minutos_noturnos_he_50_remuneraveis",
      "minutos_noturnos_he_100_remuneraveis",
      "minutos_noturnos_sem_adicional_he_remuneraveis",
    ])
      assert.doesNotMatch(serializado, new RegExp(campoRemovido));
  });
}

test("lançamentos diários são agrupados uma vez e nunca cruzam funcionários", () => {
  const entrada = entradaMinima();
  entrada.funcionarios.push({
    ...entrada.funcionarios[0],
    id: "funcionario-2",
    nome: "Segundo Funcionário",
  });
  entrada.alocacoes.push({
    ...entrada.alocacoes[0],
    funcionario_id: "funcionario-2",
    hora_entrada: "08:00:00",
  });
  entrada.registros.push({
    ...entrada.registros[0],
    id: "registro-2",
    funcionario_id: "funcionario-2",
    observacoes: "Segundo lançamento",
  });
  entrada.detalhes?.push({
    ...entrada.detalhes[0],
    registro_horas_id: "registro-2",
  });

  const processamento = processarFinanceiroRelatoriosInterno(entrada, {
    incluirProjecaoFolha: true,
  });
  assert.ok(processamento.projecaoFolha);
  assert.equal(
    processamento.projecaoFolha.reduce((total, item) => total + item.alocacoes.length, 0),
    entrada.alocacoes.length,
  );
  assert.equal(
    processamento.projecaoFolha.reduce((total, item) => total + item.registros.length, 0),
    entrada.registros.length,
  );
  const primeiro = processamento.projecaoFolha.find(
    (funcionario) => funcionario.funcionarioId === "funcionario-1",
  );
  const segundo = processamento.projecaoFolha.find(
    (funcionario) => funcionario.funcionarioId === "funcionario-2",
  );
  assert.deepEqual(
    primeiro?.alocacoes.map((alocacao) => alocacao.hora_entrada),
    ["07:00:00"],
  );
  assert.deepEqual(
    segundo?.alocacoes.map((alocacao) => alocacao.hora_entrada),
    ["08:00:00"],
  );
  assert.deepEqual(
    primeiro?.registros.map((registro) => registro.id),
    ["registro-1"],
  );
  assert.deepEqual(
    segundo?.registros.map((registro) => registro.id),
    ["registro-2"],
  );
  const idsRetornados = processamento.projecaoFolha.flatMap((funcionario) =>
    funcionario.registros.map((registro) => registro.id),
  );
  assert.equal(new Set(idsRetornados).size, entrada.registros.length);
});

for (const role of ["coordenador", "assistente", "supervisor"] as const) {
  test(`chamada direta de ${role} é bloqueada antes do carregamento financeiro`, async () => {
    let carregamentos = 0;
    await assert.rejects(
      executarProcessamentoFinanceiroAutorizado({
        roles: [role],
        rolesPermitidas: ["gerente", "diretor"],
        mensagemProibido: "Forbidden: relatório financeiro restrito a gerente e diretor",
        incluirProjecaoFolha: true,
        carregarEntrada: async () => {
          carregamentos += 1;
          return entradaMinima();
        },
      }),
      /Forbidden: relatório financeiro restrito a gerente e diretor/,
    );
    assert.equal(carregamentos, 0);
  });
}

test("retorno completo mantém paridade com uma única consolidação do processador", async () => {
  const entrada = entradaMinima();
  const esperado = processarFinanceiroRelatoriosInterno(entrada, {
    incluirProjecaoFolha: true,
  });
  const resultado = await executarProcessamentoFinanceiroAutorizado({
    roles: ["gerente"],
    rolesPermitidas: ["gerente", "diretor"],
    mensagemProibido: "Forbidden",
    incluirProjecaoFolha: true,
    carregarEntrada: async () => entrada,
  });
  assert.deepEqual(resultado.processamento, esperado);
  assert.deepEqual(resultado.entrada, entrada);
});

test("endpoint de coordenadores preserva DTO restrito e não habilita projeção", () => {
  const inicioCentro = servidor.indexOf("export const getRelatorioCentrosCusto");
  const inicioCompleto = servidor.indexOf("export const getRelatorioFinanceiroCompleto");
  const endpointCentro = servidor.slice(inicioCentro, inicioCompleto);
  const dtoCentro = servidor.slice(
    servidor.indexOf("export type RelatorioCentrosCustoDTO"),
    servidor.indexOf("export type RelatorioFinanceiroCompletoDTO"),
  );
  assert.match(endpointCentro, /rolesPermitidas: ROLES_CENTRO_CUSTO/);
  assert.match(endpointCentro, /incluirProjecaoFolha: false/);
  assert.doesNotMatch(dtoCentro, /funcionarios|salario|custoMensal|totalMensalIntegral/);
});

test("endpoint completo autoriza antes de carregar e consolida uma única vez", () => {
  assert.match(servidor, /const ROLES_FINANCEIRO_COMPLETO = \["gerente", "diretor"\]/);
  assert.match(
    processamentoInterno,
    /if \(!input\.roles\.some[\s\S]*?throw new Error\(input\.mensagemProibido\);[\s\S]*?await input\.carregarEntrada\(\)/,
  );
  assert.equal(
    (processamentoInterno.match(/processarFinanceiroRelatoriosInterno\(entrada,/g) ?? []).length,
    1,
  );
  const endpointCompleto = servidor.slice(
    servidor.indexOf("export const getRelatorioFinanceiroCompleto"),
  );
  assert.match(endpointCompleto, /rolesPermitidas: ROLES_FINANCEIRO_COMPLETO/);
  assert.match(endpointCompleto, /incluirProjecaoFolha: true/);
  assert.doesNotMatch(tela, /getRelatorioFinanceiroCompleto/);
});

test("plano compartilhado não duplica consultas para produzir as duas projeções", () => {
  const carregador = servidor.slice(
    servidor.indexOf("async function carregarEntradaRelatorioFinanceiro"),
    servidor.indexOf("async function executarRelatorioAutorizado"),
  );
  for (const tabela of [
    "funcionarios",
    "beneficios_config",
    "categoria_salarios",
    "categorias",
    "obras",
    "registros_horas",
    "registros_horas_detalhes",
    "feriados_obras_control",
    "funcionario_regime_vigencias",
  ])
    assert.equal(
      (carregador.match(new RegExp(`\\.from\\("${tabela}"`, "g")) ?? []).length,
      1,
      tabela,
    );
  assert.equal(
    (carregador.match(/\.rpc\("obras_control_alocacoes_referencia_regime"/g) ?? []).length,
    1,
  );
  assert.equal((carregador.match(/\.from\("alocacoes"\)/g) ?? []).length, 2);
  assert.match(carregador, /hora_entrada,hora_saida/);
  assert.match(carregador, /falta_tipo,observacoes/);
});
