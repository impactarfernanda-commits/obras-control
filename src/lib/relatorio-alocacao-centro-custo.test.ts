import assert from "node:assert/strict";
import test from "node:test";

import {
  filtrarFuncionariosAlocacaoCc,
  montarRelatorioAlocacaoCentroCusto,
  separarCentroCustoObra,
  type LinhaDiariaAlocacaoCc,
} from "./relatorio-alocacao-centro-custo.ts";

function linha(overrides: Partial<LinhaDiariaAlocacaoCc> = {}): LinhaDiariaAlocacaoCc {
  return {
    competencia: "2026-10",
    periodo_inicio: "2026-09-25",
    periodo_fim: "2026-10-24",
    funcionario_id: "f1",
    funcionario_nome: "João Silva",
    categoria: "Montador",
    data: "2026-10-01",
    data_inicio: "2026-10-01",
    data_saida: "2026-10-01",
    hora_entrada: "07:00",
    hora_saida: "17:00",
    situacao: "alocado",
    tipo_registro: "horas",
    falta_tipo: null,
    obra_id: "o1",
    obra_nome: "230 - ETE Sul",
    minutos_normais: 480,
    minutos_he_50: 60,
    minutos_he_100: 0,
    minutos_sem_adicional_he: 0,
    minutos_noturnos: 0,
    observacoes: null,
    possui_inconsistencia: false,
    tipo_inconsistencia: null,
    origem_horas: "detalhe",
    dia_esperado: true,
    dias_esperados_funcionario: 20,
    ...overrides,
  };
}

test("separa código e obra com fallback seguro", () => {
  assert.deepEqual(separarCentroCustoObra("230 - ETE Sul"), {
    centroCusto: "230",
    obra: "ETE Sul",
    nomeCompleto: "230 - ETE Sul",
    formatoReconhecido: true,
  });
  assert.equal(separarCentroCustoObra("SEDE").centroCusto, "SEDE");
  assert.equal(separarCentroCustoObra("SEDE").formatoReconhecido, false);
});

test("consolida um funcionário em uma linha, ordena três CCs e usa dias disponíveis", () => {
  const dados = [
    ...Array.from({ length: 15 }, (_, i) =>
      linha({
        data: `2026-10-${String(i + 1).padStart(2, "0")}`,
        obra_id: "o246",
        obra_nome: "246 - Sanepar ETE Chopinzinho",
        dias_esperados_funcionario: 23,
      }),
    ),
    ...Array.from({ length: 7 }, (_, i) =>
      linha({
        data: `2026-10-${String(i + 16).padStart(2, "0")}`,
        obra_id: "o253",
        obra_nome: "253 - Sanepar Toledo 3",
        minutos_he_100: 600,
        dias_esperados_funcionario: 23,
      }),
    ),
    linha({
      data: "2026-10-23",
      obra_id: "o230",
      obra_nome: "230 - Iguá ETE Sul",
      dias_esperados_funcionario: 23,
    }),
  ];
  dados.push({ ...dados[0] });
  const relatorio = montarRelatorioAlocacaoCentroCusto(dados);
  assert.equal(relatorio.funcionarios.length, 1);
  assert.equal(relatorio.funcionarios[0].totalDiasAlocados, 23);
  assert.deepEqual(
    relatorio.funcionarios[0].centros.map((centro) => centro.centroCusto),
    ["230", "246", "253"],
  );
  assert.equal(relatorio.funcionarios[0].centros[1].diasAlocados, 15);
  assert.equal(relatorio.funcionarios[0].centros[2].diasAlocados, 7);
  assert.equal(relatorio.funcionarios[0].totalDiasDisponiveis, 23);
  assert.equal(relatorio.funcionarios[0].centros[1].percentualDiasAlocados, (15 / 23) * 100);
});

test("calcula 15/7 como 68,18%/31,82% sobre 22 dias disponíveis", () => {
  const dados = [
    ...Array.from({ length: 15 }, (_, i) =>
      linha({
        data: `2026-10-${String(i + 1).padStart(2, "0")}`,
        dias_esperados_funcionario: 22,
      }),
    ),
    ...Array.from({ length: 7 }, (_, i) =>
      linha({
        data: `2026-10-${String(i + 16).padStart(2, "0")}`,
        obra_id: "o2",
        obra_nome: "253 - Toledo 3",
        dias_esperados_funcionario: 22,
      }),
    ),
  ];
  const centros = montarRelatorioAlocacaoCentroCusto(dados).funcionarios[0].centros;
  assert.deepEqual(
    centros.map((centro) => Number(centro.percentualDiasAlocados.toFixed(2))),
    [68.18, 31.82],
  );
});

test("um único CC com 12 de 22 dias representa 54,55%", () => {
  const funcionario = montarRelatorioAlocacaoCentroCusto(
    Array.from({ length: 12 }, (_, indice) =>
      linha({
        data: `2026-10-${String(indice + 1).padStart(2, "0")}`,
        dias_esperados_funcionario: 22,
      }),
    ),
  ).funcionarios[0];
  assert.equal(funcionario.centros.length, 1);
  assert.equal(Number(funcionario.centros[0].percentualDiasAlocados.toFixed(2)), 54.55);
  assert.equal(funcionario.observacao, "Alocação incompleta");
});

test("disponibilidade parcial pode representar 100% e sinaliza admissão e desligamento", () => {
  const periodoCompleto = [
    linha({ funcionario_id: "f0", funcionario_nome: "Referência", data: "2026-10-01" }),
    linha({ funcionario_id: "f0", funcionario_nome: "Referência", data: "2026-10-24" }),
  ];
  const parcial = Array.from({ length: 12 }, (_, indice) =>
    linha({
      funcionario_id: "f1",
      data: `2026-10-${String(indice + 6).padStart(2, "0")}`,
      dias_esperados_funcionario: 12,
    }),
  );
  const funcionario = montarRelatorioAlocacaoCentroCusto([
    ...periodoCompleto,
    ...parcial,
  ]).funcionarios.find((item) => item.funcionarioId === "f1")!;
  assert.equal(funcionario.totalDiasDisponiveis, 12);
  assert.equal(funcionario.centros[0].percentualDiasAlocados, 100);
  assert.match(funcionario.observacao, /Admitido no período/);
  assert.match(funcionario.observacao, /Desligado no período/);
});

test("filtra por busca, funcionário, categoria e CC sem dividir a linha do funcionário", () => {
  const relatorio = montarRelatorioAlocacaoCentroCusto([
    linha(),
    linha({ obra_id: "o2", obra_nome: "253 - Toledo 3", data: "2026-10-02" }),
    linha({ funcionario_id: "f2", funcionario_nome: "Maria", categoria: "Pedreira" }),
  ]);
  const todos = { busca: "", funcionarioId: "all", obraId: "all", categoria: "all" };
  assert.deepEqual(
    filtrarFuncionariosAlocacaoCc(relatorio.funcionarios, { ...todos, busca: "joão" }).map(
      (item) => item.funcionarioId,
    ),
    ["f1"],
  );
  assert.equal(
    filtrarFuncionariosAlocacaoCc(relatorio.funcionarios, { ...todos, obraId: "o2" })[0].centros
      .length,
    2,
  );
  assert.deepEqual(
    filtrarFuncionariosAlocacaoCc(relatorio.funcionarios, {
      ...todos,
      funcionarioId: "f2",
      categoria: "Pedreira",
    }).map((item) => item.funcionarioNome),
    ["Maria"],
  );
});

test("ausência, falta, férias e sem alocação não aparecem no relatório", () => {
  const relatorio = montarRelatorioAlocacaoCentroCusto([
    linha({ dias_esperados_funcionario: 4 }),
    linha({ data: "2026-10-02", dias_esperados_funcionario: 4 }),
    linha({
      data: "2026-10-05",
      situacao: "ausencia",
      tipo_registro: "falta",
      falta_tipo: "atestado",
      obra_id: null,
      obra_nome: null,
      minutos_normais: 0,
      minutos_he_50: 0,
      dias_esperados_funcionario: 4,
    }),
    linha({
      data: "2026-10-06",
      situacao: "sem_alocacao",
      tipo_registro: null,
      obra_id: null,
      obra_nome: null,
      minutos_normais: 0,
      minutos_he_50: 0,
      dias_esperados_funcionario: 4,
    }),
    linha({
      data: "2026-10-07",
      situacao: "ausencia",
      tipo_registro: "ferias",
      obra_id: null,
      obra_nome: null,
    }),
  ]);
  assert.equal(relatorio.resumo.length, 1);
  assert.equal(relatorio.resumo[0].diasAlocados, 2);
  assert.equal(relatorio.detalhes.length, 2);
  assert.ok(relatorio.detalhes.every((item) => item.situacao === "alocado" && item.obra_id));
});

test("preserva somente os dias alocados no detalhamento", () => {
  const relatorio = montarRelatorioAlocacaoCentroCusto([
    linha({
      data_saida: "2026-10-02",
      minutos_normais: 480,
      minutos_he_50: 60,
      minutos_he_100: 30,
      minutos_sem_adicional_he: 15,
    }),
    linha({
      data: "2026-10-02",
      origem_horas: "legado",
      possui_inconsistencia: true,
      tipo_inconsistencia: "HORAS_SEM_DETALHE",
    }),
  ]);
  assert.equal(relatorio.detalhes[0].data_saida, "2026-10-02");
  assert.equal(relatorio.inconsistencias, 1);
});
