import assert from "node:assert/strict";
import test from "node:test";

import {
  alocacoesAposDesligamento,
  dataLocalISO,
  desligamentosParaAtualizar,
  planejarDesligamento,
  primeiraDataDesligamento,
  validarDesligamentosAplicados,
} from "./importacao-legado-desligamentos.ts";
import { datasUteisNoIntervalo, diaUtilAnterior } from "./relatorio-sem-alocacao.ts";

const colunas = [
  { index: 4, date: "2026-07-08" },
  { index: 5, date: "2026-07-09" },
  { index: 6, date: "2026-07-10" },
];
const ehD = (valor: unknown) => ["d", "desligado"].includes(String(valor).trim().toLowerCase());

test("D em 09/07 usa a própria data, sem adicionar um dia", () => {
  assert.equal(
    primeiraDataDesligamento([null, null, null, null, "237", "D", "D"], colunas, ehD),
    "2026-07-09",
  );
});

test("Date é convertido pelos componentes locais, sem UTC", () => {
  assert.equal(dataLocalISO(new Date(2026, 6, 9)), "2026-07-09");
});

test("ativo sem data torna-se atualização de desligamento", () => {
  const item = planejarDesligamento("ana", "Ana", "2026-07-09", {
    id: "1",
    nome: "Ana",
    ativo: true,
    data_desligamento: null,
    deleted_at: null,
  });
  assert.equal(item.acao, "aplicar");
  assert.equal(desligamentosParaAtualizar([item]).length, 1);
});

test("ativo com data errada é corrigido e desligado", () => {
  const item = planejarDesligamento("ana", "Ana", "2026-07-09", {
    id: "1",
    nome: "Ana",
    ativo: true,
    data_desligamento: "2026-07-10",
    deleted_at: null,
  });
  assert.equal(item.acao, "corrigir");
});

test("inativo com data +1 é corrigido para o primeiro D", () => {
  const item = planejarDesligamento("ana", "Ana", "2026-07-09", {
    id: "1",
    nome: "Ana",
    ativo: false,
    data_desligamento: "2026-07-10",
    deleted_at: null,
  });
  assert.equal(item.acao, "corrigir");
});

test("admissão igual não participa da decisão de desligamento", () => {
  assert.equal(
    planejarDesligamento("ana", "Ana", "2026-07-09", {
      id: "1",
      nome: "Ana",
      ativo: true,
      data_desligamento: null,
      deleted_at: null,
    }).acao,
    "aplicar",
  );
});

test("múltiplas células D usam somente a primeira", () => {
  assert.equal(
    primeiraDataDesligamento([null, null, null, null, "D", "D", "D"], colunas, ehD),
    "2026-07-08",
  );
});

test("células anteriores ao D permanecem anteriores e D/posteriores são excluíveis por corte", () => {
  const primeiroD = primeiraDataDesligamento(
    [null, null, null, null, "237", "D", "240"],
    colunas,
    ehD,
  )!;
  assert.deepEqual(
    colunas.filter((c) => c.date < primeiroD).map((c) => c.date),
    ["2026-07-08"],
  );
  assert.deepEqual(
    colunas.filter((c) => c.date >= primeiroD).map((c) => c.date),
    ["2026-07-09", "2026-07-10"],
  );
});

test("alocação existente após D vira aviso e permanece na entrada", () => {
  const desligamento = planejarDesligamento("ana", "Ana", "2026-07-09", {
    id: "1",
    nome: "Ana",
    ativo: true,
    data_desligamento: null,
    deleted_at: null,
  });
  const entrada = [{ id: "a", funcionario_id: "1", data: "2026-07-10" }];
  assert.deepEqual(alocacoesAposDesligamento([desligamento], entrada), entrada);
});

test("Sem alocação encerra no dia útil anterior ao desligamento", () => {
  assert.equal(diaUtilAnterior("2026-07-09"), "2026-07-08");
  const dias = datasUteisNoIntervalo("2026-07-06", diaUtilAnterior("2026-07-09"));
  assert.deepEqual(dias, ["2026-07-06", "2026-07-07", "2026-07-08"]);
  assert.equal(dias.includes("2026-07-09"), false);
});

test("funcionário ausente não gera desligamento", () => {
  assert.equal(primeiraDataDesligamento([], colunas, ehD), null);
});

test("revalidação detecta funcionário não atualizado", () => {
  const previsto = planejarDesligamento("ana", "Ana", "2026-07-09", {
    id: "1",
    nome: "Ana",
    ativo: true,
    data_desligamento: null,
    deleted_at: null,
  });
  assert.equal(
    validarDesligamentosAplicados(desligamentosParaAtualizar([previsto]), [
      { id: "1", ativo: true, data_desligamento: null },
    ]).length,
    1,
  );
});

for (const [nome, anterior, primeiroD] of [
  ["EVERTON FARIAS ALVES", "237", "2026-07-09"],
  ["BRENDSON CLEYTON DA SILVA FELIX", "240-M", "2026-07-16"],
  ["DENYS JACKSON RODRIGUES SILVA", "236-C", "2026-07-17"],
  ["EDIGLEISON MARINHO DA SILVA", "240-M", "2026-07-16"],
] as const) {
  test(`${nome}: centro anterior é preservado e primeiro D é ${primeiroD}`, () => {
    const datas = [
      {
        index: 4,
        date:
          anterior === "237"
            ? "2026-07-08"
            : primeiroD === "2026-07-17"
              ? "2026-07-16"
              : "2026-07-15",
      },
      { index: 5, date: primeiroD },
      { index: 6, date: "2026-07-20" },
    ];
    assert.equal(
      primeiraDataDesligamento([null, null, null, null, anterior, "D", "D"], datas, ehD),
      primeiroD,
    );
  });
}

for (const [nome, atual, esperado] of [
  ["DANIEL PAULINO DE MOURA", "2026-07-07", "2026-07-06"],
  ["DIEGO LEAL DOS SANTOS", "2026-07-08", "2026-07-07"],
] as const) {
  test(`${nome}: corrige ${atual} para ${esperado}`, () => {
    assert.equal(
      planejarDesligamento(nome, nome, esperado, {
        id: nome,
        nome,
        ativo: false,
        data_desligamento: atual,
        deleted_at: null,
      }).acao,
      "corrigir",
    );
  });
}
