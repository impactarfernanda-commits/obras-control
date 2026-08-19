import assert from "node:assert/strict";
import test from "node:test";

import { filtrarFuncionariosBusca, type FuncionarioBusca } from "./funcionario-busca.ts";
import { funcionarioElegivelNoPeriodo } from "./funcionarios.ts";

const funcionarios: FuncionarioBusca[] = [
  {
    id: "ativo",
    nome: "João Ativo",
    categoria_mo: "Montador",
    ativo: true,
    data_desligamento: null,
  },
  {
    id: "desligado",
    nome: "José Histórico",
    categoria_mo: "Soldador",
    ativo: false,
    data_desligamento: "2026-07-31",
  },
];

function ids(termo: string) {
  return filtrarFuncionariosBusca(funcionarios, termo).map(({ id }) => id);
}

test("funcionário ativo é encontrado após digitação lenta", () => {
  for (const termo of ["J", "Jo", "Joã", "João"]) assert.ok(ids(termo).includes("ativo"));
});

test("funcionário desligado elegível é encontrado após digitação lenta", () => {
  for (const termo of ["J", "Jo", "Jos", "José"]) assert.ok(ids(termo).includes("desligado"));
});

test("funcionário desligado é encontrado ao informar o termo completo rapidamente", () => {
  assert.deepEqual(ids("José"), ["desligado"]);
});

test("digitação rápida e lenta produzem o mesmo resultado final", () => {
  const resultadoRapido = ids("José");
  let resultadoLento: string[] = [];
  for (const termo of ["J", "Jo", "Jos", "José"]) resultadoLento = ids(termo);
  assert.deepEqual(resultadoLento, resultadoRapido);
});

test("troca imediata de termo usa sempre o estado atual sem resposta assíncrona tardia", () => {
  assert.deepEqual(ids("José"), ["desligado"]);
  assert.deepEqual(ids("João"), ["ativo"]);
  assert.deepEqual(ids("José"), ["desligado"]);
});

test("busca não altera as regras de elegibilidade por desligamento", () => {
  const desligado = {
    data_admissao: "2020-01-01",
    data_desligamento: "2026-07-31",
    deleted_at: null,
    visivel_obras_control: true,
  };
  assert.equal(funcionarioElegivelNoPeriodo(desligado, "2026-07-01", "2026-07-31"), true);
  assert.equal(funcionarioElegivelNoPeriodo(desligado, "2026-08-01", "2026-08-31"), false);
});
