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
  {
    id: "jose-alexandre",
    nome: "JOSE ALEXANDRE CASTOR SILVA",
    categoria_mo: "Encanador",
    ativo: false,
    data_desligamento: "2026-07-31",
  },
  {
    id: "andre-santos",
    nome: "ANDRE LUIZ DOS SANTOS",
    categoria_mo: "Caldeireiro",
    ativo: false,
    data_desligamento: "2026-07-31",
  },
  {
    id: "nome-exato",
    nome: "José",
    categoria_mo: "Ajudante",
    ativo: true,
    data_desligamento: null,
  },
  {
    id: "funcao",
    nome: "Carlos Pereira",
    categoria_mo: "Soldador Montador",
    ativo: true,
    data_desligamento: null,
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
  assert.ok(ids("José").includes("desligado"));
});

test("digitação rápida e lenta produzem o mesmo resultado final", () => {
  const resultadoRapido = ids("José");
  let resultadoLento: string[] = [];
  for (const termo of ["J", "Jo", "Jos", "José"]) resultadoLento = ids(termo);
  assert.deepEqual(resultadoLento, resultadoRapido);
});

test("troca imediata de termo usa sempre o estado atual sem resposta assíncrona tardia", () => {
  assert.ok(ids("José").includes("desligado"));
  assert.deepEqual(ids("João"), ["ativo"]);
  assert.ok(ids("José").includes("desligado"));
});

test("nome único é encontrado normalmente", () => {
  assert.deepEqual(ids("historico"), ["desligado"]);
});

test("nome comum mantém ativos e desligados no resultado", () => {
  const resultado = ids("jose");
  assert.ok(resultado.includes("nome-exato"));
  assert.ok(resultado.includes("desligado"));
  assert.ok(resultado.includes("jose-alexandre"));
});

test("pesquisa com duas palavras encontra tokens não contíguos", () => {
  assert.deepEqual(ids("andre santos"), ["andre-santos"]);
});

test("pesquisa parcial jose alex prioriza o nome iniciado pelo termo", () => {
  assert.deepEqual(ids("jose alex"), ["jose-alexandre"]);
});

test("busca ignora acentos e diferenças entre maiúsculas e minúsculas", () => {
  assert.deepEqual(ids("JOAO"), ["ativo"]);
  assert.equal(ids("josé")[0], "nome-exato");
});

test("nome completo exato precede ativos e desligados com o mesmo primeiro nome", () => {
  assert.equal(ids("jose")[0], "nome-exato");
});

test("correspondência pelo nome precede correspondência somente pela função", () => {
  assert.deepEqual(ids("soldador"), ["desligado", "funcao"]);
});

test("funcionário desligado elegível não é eliminado em listas grandes", () => {
  const listaGrande = [
    ...Array.from({ length: 500 }, (_, indice) => ({
      id: `ativo-${indice}`,
      nome: `JOSE ATIVO ${indice}`,
      categoria_mo: "Montador",
      ativo: true,
      data_desligamento: null,
    })),
    funcionarios.find(({ id }) => id === "jose-alexandre")!,
  ];
  const resultado = filtrarFuncionariosBusca(listaGrande, "jose alex");
  assert.equal(resultado[0].id, "jose-alexandre");
  assert.equal(resultado.length, 1);
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
