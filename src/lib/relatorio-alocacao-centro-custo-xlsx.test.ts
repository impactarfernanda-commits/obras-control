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

test("gera arquivo e duas abas com a mesma agregação", () => {
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
  assert.equal(detalhes[0][16], "Pendência/Inconsistência");
  assert.equal(
    nomeArquivoAlocacaoCentroCusto("2026-10"),
    "Alocacao_por_Centro_de_Custo_2026-10.xlsx",
  );
});
