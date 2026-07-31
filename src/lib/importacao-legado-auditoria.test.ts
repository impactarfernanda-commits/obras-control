import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  conciliarCelulasComAlocacoesExistentes,
  criarSourceCellKey,
  separarDuplicidadesInternas,
  somarGruposMutuamenteExclusivos,
  type CelulaAlocacaoLegado,
} from "./importacao-legado-auditoria.ts";
import { buscarTodasPaginas } from "./paginacao.ts";

function celula(overrides: Partial<CelulaAlocacaoLegado> = {}): CelulaAlocacaoLegado {
  return {
    sourceCellKey: "linha 2 | coluna 5 | 2026-06-25",
    funcionarioKey: "maria",
    funcionarioNome: "Maria",
    funcionarioId: "func-1",
    obraId: "obra-230",
    data: "2026-06-25",
    valorOriginal: "230-M",
    codigoBase: "230",
    tipoMaoObra: "montagem",
    ...overrides,
  };
}

test("uma célula nova aparece uma vez nas alocações novas", () => {
  const resultado = conciliarCelulasComAlocacoesExistentes([celula()], []);
  assert.equal(resultado.novas.length, 1);
  assert.equal(resultado.existentes.length, 0);
});

test("uma célula existente é ignorada uma vez e não permanece nas novas", () => {
  const resultado = conciliarCelulasComAlocacoesExistentes(
    [celula()],
    [{ id: "aloc-1", funcionario_id: "func-1", obra_id: "obra-230", data: "2026-06-25" }],
  );
  assert.equal(resultado.novas.length, 0);
  assert.equal(resultado.existentes.length, 1);
  assert.equal(resultado.totalMatchesBanco, 1);
});

test("mesma pessoa e data em centro diferente é conflito bloqueante", () => {
  const resultado = conciliarCelulasComAlocacoesExistentes(
    [celula()],
    [{ id: "aloc-199", funcionario_id: "func-1", obra_id: "obra-199", data: "2026-06-25" }],
  );
  assert.equal(resultado.novas.length, 0);
  assert.equal(resultado.existentes.length, 0);
  assert.equal(resultado.conflitos.length, 1);
  assert.deepEqual(resultado.conflitos[0].obraIdsExistentes, ["obra-199"]);
});

test("múltiplos centros existentes são conflito histórico", () => {
  const resultado = conciliarCelulasComAlocacoesExistentes(
    [celula()],
    [
      { id: "aloc-199", funcionario_id: "func-1", obra_id: "obra-199", data: "2026-06-25" },
      { id: "aloc-230", funcionario_id: "func-1", obra_id: "obra-230", data: "2026-06-25" },
    ],
  );
  assert.equal(resultado.conflitos.length, 1);
  assert.equal(resultado.conflitos[0].conflitoHistorico, true);
  assert.equal(resultado.conflitosHistoricos.length, 1);
});

test("tipo de mão de obra diferente no mesmo centro não cria conflito entre centros", () => {
  const resultado = conciliarCelulasComAlocacoesExistentes(
    [celula({ tipoMaoObra: "civil" })],
    [{ id: "aloc-1", funcionario_id: "func-1", obra_id: "obra-230", data: "2026-06-25" }],
  );
  assert.equal(resultado.conflitos.length, 0);
  assert.equal(resultado.existentes.length, 1);
  assert.equal(resultado.existentes[0].tipoMaoObra, "civil");
});

test("dois registros no banco geram uma célula ignorada e um match adicional", () => {
  const registros = ["aloc-1", "aloc-2"].map((id) => ({
    id,
    funcionario_id: "func-1",
    obra_id: "obra-230",
    data: "2026-06-25",
  }));
  const resultado = conciliarCelulasComAlocacoesExistentes([celula()], registros);
  assert.equal(resultado.existentes.length, 1);
  assert.equal(resultado.existentes[0].quantidadeMatches, 2);
  assert.deepEqual(resultado.existentes[0].idsExistentes, ["aloc-1", "aloc-2"]);
  assert.equal(resultado.matchesAdicionaisBanco, 1);
  assert.equal(resultado.duplicidadesHistoricas.length, 1);
});

test("duas células iguais em linhas distintas têm sourceCellKeys diferentes", () => {
  const primeira = celula({ sourceCellKey: criarSourceCellKey(1, 4, "2026-06-25") });
  const segunda = celula({ sourceCellKey: criarSourceCellKey(8, 4, "2026-06-25") });
  const resultado = separarDuplicidadesInternas([primeira, segunda]);
  assert.notEqual(primeira.sourceCellKey, segunda.sourceCellKey);
  assert.equal(resultado.unicas.length, 1);
  assert.equal(resultado.duplicadas.length, 1);
  assert.equal(resultado.duplicadas[0].celula.sourceCellKey, segunda.sourceCellKey);
});

test("alocações de funcionário a criar continuam novas", () => {
  const resultado = conciliarCelulasComAlocacoesExistentes(
    [celula({ funcionarioId: undefined, funcionarioKey: "funcionario-novo" })],
    [],
  );
  assert.equal(resultado.novas.length, 1);
  assert.equal(resultado.existentes.length, 0);
});

test("a conciliação fecha entre células novas e existentes", () => {
  const celulas = [
    celula(),
    celula({ sourceCellKey: "linha 3 | coluna 5 | 2026-06-25", data: "2026-06-26" }),
  ];
  const resultado = conciliarCelulasComAlocacoesExistentes(celulas, [
    { id: "aloc-1", funcionario_id: "func-1", obra_id: "obra-230", data: "2026-06-25" },
  ]);
  assert.equal(
    celulas.length,
    resultado.novas.length + resultado.existentes.length + resultado.conflitos.length,
  );
});

test("grupos mutuamente exclusivos fecham com o total do período", () => {
  const grupos = {
    vazias: 0,
    desligado: 758,
    sedeNaoResolvida: 0,
    invalidas: 0,
    centrosNaoEncontrados: 0,
    novas: 5372,
    existentes: 320,
    duplicadasInternas: 0,
    outrosBloqueios: 0,
  };
  assert.equal(somarGruposMutuamenteExclusivos(grupos), 6450);
});

test("D é encerrado na própria classificação e centro inexistente bloqueia a prévia", () => {
  const componente = readFileSync(
    new URL("../components/ImportarPlanilhaLegadoDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    componente,
    /if \(parsed === "desligado"\)[\s\S]*?celulasDesligado \+= 1;[\s\S]*?continue;/,
  );
  assert.match(componente, /if \(!obra\)[\s\S]*?erros\.push\(mensagem\);/);
  assert.match(componente, /bloqueado: erros\.length > 0/);
});

test("prévia e confirmação reutilizam a mesma função de conciliação", () => {
  const componente = readFileSync(
    new URL("../components/ImportarPlanilhaLegadoDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(componente.match(/conciliarCelulasComAlocacoesExistentes\(/g)?.length, 2);
});

test("revalidação detecta conflito surgido depois da prévia", () => {
  const origem = celula();
  const previa = conciliarCelulasComAlocacoesExistentes([origem], []);
  const revalidacao = conciliarCelulasComAlocacoesExistentes(previa.novas, [
    { id: "aloc-nova", funcionario_id: "func-1", obra_id: "obra-199", data: "2026-06-25" },
  ]);
  assert.equal(previa.novas.length, 1);
  assert.equal(revalidacao.conflitos.length, 1);
  assert.equal(revalidacao.novas.length, 0);
});

test("consulta paginada não perde registros", async () => {
  const registros = Array.from({ length: 2005 }, (_, id) => id);
  const resultado = await buscarTodasPaginas<number>((inicio, fim) =>
    Promise.resolve({ data: registros.slice(inicio, fim + 1), error: null }),
  );
  assert.equal(resultado.length, 2005);
  assert.equal(resultado[2004], 2004);
});

test("conflito é verificado antes da primeira escrita da confirmação", () => {
  const componente = readFileSync(
    new URL("../components/ImportarPlanilhaLegadoDialog.tsx", import.meta.url),
    "utf8",
  );
  const verificacao = componente.indexOf("if (revalidacao.conflitos.length > 0)");
  const primeiraEscrita = componente.indexOf("for (const admissao of preview.admissoesAlterar)");
  assert.ok(verificacao > 0);
  assert.ok(primeiraEscrita > verificacao);
});
