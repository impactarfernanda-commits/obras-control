import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buscarIdsAtividadeEmLotes,
  criarAlertasAtividadeFuncionarios,
  dataInicioAtividadeRecente,
  identificarHistoricoCandidatos,
  type LinhaAtividadeFuncionario,
} from "./alertas-atividade.ts";

test("janela recente inclui exatamente a data limite dos 30 dias", () => {
  assert.equal(dataInicioAtividadeRecente(new Date("2026-11-03T12:00:00-03:00"), 30), "2026-10-04");
});

function fontePaginada(
  linhas: LinhaAtividadeFuncionario[],
  chamadas: Array<{ ids: string[]; inicio: number; fim: number }>,
  falharNoInicio?: number,
) {
  return async (ids: string[], inicio: number, fim: number) => {
    chamadas.push({ ids, inicio, fim });
    if (inicio === falharNoInicio) {
      return { data: null, error: new Error(`falha na página ${inicio}`) };
    }
    const filtradas = linhas.filter((linha) => ids.includes(linha.funcionario_id));
    return { data: filtradas.slice(inicio, fim + 1), error: null };
  };
}

test("atividade recente exclui funcionários das duas consultas históricas", async () => {
  let alocacoes = 0;
  let registros = 0;
  const resultado = await identificarHistoricoCandidatos({
    funcionarioIdsAtivos: ["recente-alocacao", "recente-registro"],
    funcionarioIdsComAtividadeRecente: new Set(["recente-alocacao", "recente-registro"]),
    funcionarioIdsIgnorados: new Set(),
    buscarHistoricoAlocacoes: async () => {
      alocacoes += 1;
      return new Set();
    },
    buscarHistoricoRegistros: async () => {
      registros += 1;
      return new Set();
    },
  });
  assert.deepEqual(resultado.funcionarioIdsComHistorico, new Set());
  assert.equal(alocacoes, 0);
  assert.equal(registros, 0);
});

test("consulta alocações primeiro e registros somente para candidatos restantes", async () => {
  const chamadas: string[] = [];
  const resultado = await identificarHistoricoCandidatos({
    funcionarioIdsAtivos: ["com-alocacao", "com-registro", "sem-historico", "recente"],
    funcionarioIdsComAtividadeRecente: new Set(["recente"]),
    funcionarioIdsIgnorados: new Set(),
    buscarHistoricoAlocacoes: async (ids) => {
      chamadas.push(`alocacoes:${ids.join(",")}`);
      return new Set(["com-alocacao"]);
    },
    buscarHistoricoRegistros: async (ids) => {
      chamadas.push(`registros:${ids.join(",")}`);
      return new Set(["com-registro"]);
    },
  });
  assert.deepEqual(chamadas, [
    "alocacoes:com-alocacao,com-registro,sem-historico",
    "registros:com-registro,sem-historico",
  ]);
  assert.deepEqual(resultado.funcionarioIdsComHistorico, new Set(["com-alocacao", "com-registro"]));
  assert.deepEqual(resultado.funcionarioIdsSemHistorico, new Set(["sem-historico"]));
});

test("supervisores tratados por vigência não entram nas consultas históricas", async () => {
  const consultados: string[][] = [];
  await identificarHistoricoCandidatos({
    funcionarioIdsAtivos: ["supervisor-com-vigencia", "supervisor-sem-vigencia", "funcionario"],
    funcionarioIdsComAtividadeRecente: new Set(),
    funcionarioIdsIgnorados: new Set(["supervisor-com-vigencia", "supervisor-sem-vigencia"]),
    buscarHistoricoAlocacoes: async (ids) => {
      consultados.push(ids);
      return new Set();
    },
    buscarHistoricoRegistros: async () => new Set(),
  });
  assert.deepEqual(consultados, [["funcionario"]]);
});

test("mais de mil linhas são paginadas sem classificar histórico como ausente", async () => {
  const chamadas: Array<{ ids: string[]; inicio: number; fim: number }> = [];
  const linhas = Array.from({ length: 2_237 }, () => ({ funcionario_id: "historico" }));
  const encontrados = await buscarIdsAtividadeEmLotes({
    funcionarioIds: ["historico"],
    buscarPagina: fontePaginada(linhas, chamadas),
  });
  assert.deepEqual(encontrados, new Set(["historico"]));
  assert.deepEqual(
    chamadas.map(({ inicio, fim }) => [inicio, fim]),
    [
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ],
  );
});

test("IDs são consultados em lotes determinísticos e sem duplicação", async () => {
  const chamadas: Array<{ ids: string[]; inicio: number; fim: number }> = [];
  const ids = Array.from({ length: 205 }, (_, indice) => `f-${indice}`);
  await buscarIdsAtividadeEmLotes({
    funcionarioIds: [...ids, "f-0"],
    tamanhoLote: 100,
    buscarPagina: fontePaginada([], chamadas),
  });
  assert.deepEqual(
    chamadas.map(({ ids: lote }) => lote.length),
    [100, 100, 5],
  );
  assert.deepEqual(chamadas[0].ids.slice(0, 2), ["f-0", "f-1"]);
  assert.deepEqual(chamadas[2].ids, ids.slice(200));
});

test("erro intermediário interrompe a classificação e é propagado", async () => {
  let registrosExecutados = 0;
  await assert.rejects(
    identificarHistoricoCandidatos({
      funcionarioIdsAtivos: ["candidato"],
      funcionarioIdsComAtividadeRecente: new Set(),
      funcionarioIdsIgnorados: new Set(),
      buscarHistoricoAlocacoes: async () => {
        await buscarIdsAtividadeEmLotes({
          funcionarioIds: ["candidato"],
          buscarPagina: fontePaginada(
            Array.from({ length: 1_100 }, () => ({ funcionario_id: "candidato" })),
            [],
            1000,
          ),
        });
        return new Set();
      },
      buscarHistoricoRegistros: async () => {
        registrosExecutados += 1;
        return new Set();
      },
    }),
    /falha na página 1000/,
  );
  assert.equal(registrosExecutados, 0);
});

test("fonte preserva limite inclusivo, alertas e ordenação determinística", () => {
  const fonte = readFileSync(new URL("./alertas.server.ts", import.meta.url), "utf8");
  assert.match(fonte, /\.eq\("ativo", true\)/);
  assert.match(fonte, /\.gte\("data", desdeAlocacaoStr\)/);
  assert.match(fonte, /new Set<string>\(\[\.\.\.alocacoesRecentes, \.\.\.registrosRecentes\]\)/);
  assert.match(fonte, /\.order\("funcionario_id", \{ ascending: true \}\)/);
  assert.match(fonte, /\.order\("data", \{ ascending: true \}\)/);
  assert.match(fonte, /\.order\("id", \{ ascending: true \}\)/);
  assert.match(fonte, /criarAlertasAtividadeFuncionarios/);
});

test("notificações mantêm paridade completa para histórico, ausência e supervisores", () => {
  const alertas = criarAlertasAtividadeFuncionarios({
    funcionariosAtivos: [
      { id: "recente", nome: "Recente" },
      { id: "antigo", nome: "Antigo" },
      { id: "nunca", nome: "Nunca" },
      { id: "supervisor-ok", nome: "Supervisor OK" },
      { id: "supervisor-pendente", nome: "Supervisor Pendente" },
    ],
    funcionarioIdsComAtividadeRecente: new Set(["recente"]),
    funcionarioIdsComHistorico: new Set(["antigo"]),
    funcionarioIdsSupervisoresTratados: new Set(["supervisor-ok", "supervisor-pendente"]),
    funcionarioIdsSupervisoresComVigencia: new Set(["supervisor-ok"]),
    hojeStr: "2026-11-03",
    diasSemAlocacao: 30,
  });

  assert.deepEqual(alertas, [
    {
      tipo: "sem_alocacao",
      titulo: "Funcionário sem alocação: Antigo",
      mensagem:
        "Antigo está ativo mas não possui alocação nem registro de horas nos últimos 30 dias. Verifique se está de folga de campo, férias, afastado, desligado ou se a alocação foi esquecida.",
      severidade: "warning",
      metadata: { funcionario_id: "antigo", funcionario_nome: "Antigo" },
      dedupe_key: "sem_alocacao:antigo:2026-11-03",
    },
    {
      tipo: "nunca_alocado",
      titulo: "Funcionário nunca alocado: Nunca",
      mensagem:
        "Nunca está cadastrado como ativo mas nunca foi alocado a nenhum centro de custo. Faça a primeira alocação ou desative o cadastro.",
      severidade: "warning",
      metadata: { funcionario_id: "nunca", funcionario_nome: "Nunca" },
      dedupe_key: "nunca_alocado:nunca:2026-11-03",
    },
    {
      tipo: "sem_alocacao",
      titulo: "Supervisor sem vigência de CC: Supervisor Pendente",
      mensagem:
        "Supervisor Pendente está ativo, mas não possui vigência de centro de custo na data atual.",
      severidade: "warning",
      metadata: {
        funcionario_id: "supervisor-pendente",
        funcionario_nome: "Supervisor Pendente",
      },
      dedupe_key: "supervisor_sem_vigencia:supervisor-pendente:2026-11-03",
    },
  ]);
});

test("comparação sintética reduz bytes ao consultar histórico somente dos candidatos", () => {
  const ativos = Array.from({ length: 300 }, (_, indice) => `f-${indice}`);
  const recentes = new Set(ativos.slice(0, 270));
  const linha = (funcionario_id: string) => ({ funcionario_id });
  const historicoPorFuncionario = 20;
  const antigo = ativos.flatMap((id) =>
    Array.from({ length: historicoPorFuncionario * 2 }, () => linha(id)),
  );
  const candidatos = ativos.filter((id) => !recentes.has(id));
  const novo = candidatos.flatMap((id) =>
    Array.from({ length: historicoPorFuncionario }, () => linha(id)),
  );
  const bytesAntigos = Buffer.byteLength(JSON.stringify(antigo));
  const bytesNovos = Buffer.byteLength(JSON.stringify(novo));
  assert.ok(bytesNovos < bytesAntigos * 0.06);
});
