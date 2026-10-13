import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("agrupa CCs, conta datas distintas e calcula 60/40 sem usar HE", () => {
  const dados = [
    ...Array.from({ length: 12 }, (_, i) =>
      linha({ data: `2026-10-${String(i + 1).padStart(2, "0")}` }),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      linha({
        data: `2026-10-${String(i + 13).padStart(2, "0")}`,
        obra_id: "o2",
        obra_nome: "237 - PM Várzea Grande",
        minutos_he_100: 600,
      }),
    ),
  ];
  dados.push({ ...dados[0] });
  const relatorio = montarRelatorioAlocacaoCentroCusto(dados);
  assert.equal(relatorio.resumo.length, 2);
  assert.equal(relatorio.resumo[0].diasAlocados, 12);
  assert.equal(relatorio.resumo[0].percentualDiasAlocados, 60);
  assert.equal(relatorio.resumo[1].diasAlocados, 8);
  assert.equal(relatorio.resumo[1].percentualDiasAlocados, 40);
  assert.equal(
    relatorio.resumo.reduce((s, item) => s + item.percentualDiasAlocados, 0),
    100,
  );
});

test("ausência e sem alocação não entram em CC e reduzem cobertura", () => {
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
  ]);
  assert.equal(relatorio.resumo.length, 1);
  assert.equal(relatorio.resumo[0].diasAlocados, 2);
  assert.equal(relatorio.resumo[0].diasAusencia, 1);
  assert.equal(relatorio.resumo[0].diasSemAlocacao, 1);
  assert.equal(relatorio.resumo[0].percentualCobertura, 50);
  assert.equal(relatorio.detalhes.length, 4);
});

test("soma minutos detalhados, preserva virada e sinaliza legado/inconsistência", () => {
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
  assert.equal(relatorio.resumo[0].totalHoras, 18.75);
  assert.equal(relatorio.detalhes[0].data_saida, "2026-10-02");
  assert.equal(relatorio.inconsistencias, 1);
});
