import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  montarRelatorioAlocacaoCentroCusto,
  type LinhaDiariaAlocacaoCc,
} from "./relatorio-alocacao-centro-custo.ts";
import {
  buildAlocacaoCentroCustoWorkbook,
  nomeArquivoAlocacaoCentroCusto,
} from "./relatorio-alocacao-centro-custo-xlsx.ts";

const base: LinhaDiariaAlocacaoCc = {
  competencia: "2026-10",
  periodo_inicio: "2026-09-25",
  periodo_fim: "2026-10-24",
  funcionario_id: "f1",
  funcionario_nome: "Ana",
  categoria: "Montadora",
  data: "2026-10-01",
  data_inicio: "2026-10-01",
  data_saida: "2026-10-02",
  hora_entrada: "22:00",
  hora_saida: "06:00",
  situacao: "alocado",
  tipo_registro: "horas",
  falta_tipo: null,
  obra_id: "o1",
  obra_nome: "230 - ETE Sul",
  minutos_normais: 420,
  minutos_he_50: 60,
  minutos_he_100: 0,
  minutos_sem_adicional_he: 0,
  minutos_noturnos: 420,
  observacoes: null,
  possui_inconsistencia: false,
  tipo_inconsistencia: null,
  origem_horas: "detalhe",
  dia_esperado: true,
  dias_esperados_funcionario: 20,
};

test("gera resumo enxuto e detalhamento somente com alocações", () => {
  const relatorio = montarRelatorioAlocacaoCentroCusto([
    base,
    {
      ...base,
      data: "2026-10-02",
      situacao: "ausencia",
      tipo_registro: "falta",
      falta_tipo: "atestado",
      obra_id: null,
      obra_nome: null,
      minutos_normais: 0,
      minutos_he_50: 0,
    },
    {
      ...base,
      data: "2026-10-03",
      situacao: "sem_alocacao",
      tipo_registro: null,
      obra_id: null,
      obra_nome: null,
      minutos_normais: 0,
      minutos_he_50: 0,
    },
  ]);
  const workbook = buildAlocacaoCentroCustoWorkbook(relatorio);
  assert.deepEqual(workbook.SheetNames, ["RESUMO", "DETALHAMENTO"]);
  const resumo = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.RESUMO, { header: 1 });
  const detalhes = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.DETALHAMENTO, { header: 1 });
  assert.equal(resumo.length, relatorio.resumo.length + 1);
  assert.equal(detalhes.length, relatorio.detalhes.length + 1);
  assert.deepEqual(resumo[0], [
    "Funcionário",
    "Categoria/Função",
    "Centro de custo",
    "Obra",
    "Dias alocados",
    "Percentual",
  ]);
  assert.deepEqual(detalhes[0], [
    "Funcionário",
    "Categoria/Função",
    "Data",
    "Centro de custo",
    "Obra",
  ]);
  assert.equal(detalhes.length, 2);
  assert.equal(resumo[1][5], 1);
  assert.equal(
    nomeArquivoAlocacaoCentroCusto("2026-10"),
    "Alocacao_por_Centro_de_Custo_2026-10.xlsx",
  );
});

test("Excel usa a mesma distribuição percentual 15/7 do relatório", () => {
  const entradas = [
    ...Array.from({ length: 15 }, (_, indice) => ({
      ...base,
      data: `2026-10-${String(indice + 1).padStart(2, "0")}`,
    })),
    ...Array.from({ length: 7 }, (_, indice) => ({
      ...base,
      data: `2026-10-${String(indice + 16).padStart(2, "0")}`,
      obra_id: "o2",
      obra_nome: "253 - Toledo 3",
    })),
  ];
  const relatorio = montarRelatorioAlocacaoCentroCusto(entradas);
  const workbook = buildAlocacaoCentroCustoWorkbook(relatorio);
  const resumo = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.RESUMO, { header: 1 });
  assert.deepEqual(
    resumo.slice(1).map((linha) => Number((Number(linha[5]) * 100).toFixed(2))),
    [68.18, 31.82],
  );
});
