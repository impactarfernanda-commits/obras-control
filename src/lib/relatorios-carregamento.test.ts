import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  abaInicialRelatorios,
  consultasRelatoriosPorAba,
  type AbaRelatorios,
} from "./relatorios-carregamento.ts";
import type { Role } from "./access-control.ts";

const perfis: Role[] = ["gerente", "diretor", "coordenador", "assistente", "supervisor"];

test("cada perfil abre na mesma aba inicial já apresentada pela tela", () => {
  assert.equal(abaInicialRelatorios("gerente"), "funcionarios");
  assert.equal(abaInicialRelatorios("diretor"), "funcionarios");
  assert.equal(abaInicialRelatorios("coordenador"), "obras");
  assert.equal(abaInicialRelatorios("assistente"), "sem-alocacao");
  assert.equal(abaInicialRelatorios("supervisor"), "sem-alocacao");
});

test("a aba inicial habilita somente os pacotes necessários ao perfil", () => {
  assert.deepEqual(consultasRelatoriosPorAba("gerente", "funcionarios"), {
    folha: true,
    centros: true,
    semAlocacao: false,
  });
  assert.deepEqual(consultasRelatoriosPorAba("diretor", "funcionarios"), {
    folha: true,
    centros: true,
    semAlocacao: false,
  });
  assert.deepEqual(consultasRelatoriosPorAba("coordenador", "obras"), {
    folha: false,
    centros: true,
    semAlocacao: false,
  });
  for (const role of ["assistente", "supervisor"] as const)
    assert.deepEqual(consultasRelatoriosPorAba(role, "sem-alocacao"), {
      folha: false,
      centros: false,
      semAlocacao: true,
    });
});

test("trocar de aba ativa exatamente as consultas exigidas pelo conteúdo visível", () => {
  const esperadoGerente: Record<AbaRelatorios, ReturnType<typeof consultasRelatoriosPorAba>> = {
    funcionarios: { folha: true, centros: true, semAlocacao: false },
    obras: { folha: false, centros: true, semAlocacao: false },
    "alocacao-centro-custo": { folha: false, centros: false, semAlocacao: true },
    "sem-alocacao": { folha: false, centros: false, semAlocacao: true },
  };
  for (const [aba, esperado] of Object.entries(esperadoGerente))
    assert.deepEqual(consultasRelatoriosPorAba("gerente", aba as AbaRelatorios), esperado);

  for (const role of perfis) {
    assert.equal(consultasRelatoriosPorAba(role, "alocacao-centro-custo").semAlocacao, true);
    assert.equal(consultasRelatoriosPorAba(role, "sem-alocacao").semAlocacao, true);
  }
});

test("query keys e funções existentes permanecem preservadas para refetch e invalidação", () => {
  const tela = readFileSync("src/routes/_authenticated/relatorios.tsx", "utf8");
  for (const chave of [
    "alocacoes-mes",
    "registros-mes",
    "registros-horas-detalhes-relatorio",
    "relatorio-sem-alocacao",
    "relatorio-centros-custo",
  ])
    assert.match(tela, new RegExp(`queryKey: \\["${chave}`));
  assert.match(tela, /getRelatorioSemAlocacao/);
  assert.match(tela, /getRelatorioCentrosCusto/);
  assert.match(tela, /<RelatorioAlocacaoCentroCusto/);
});
