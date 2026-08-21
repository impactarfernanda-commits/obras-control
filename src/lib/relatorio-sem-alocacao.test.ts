import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ultimasAlocacoesPorFuncionario } from "./relatorio-sem-alocacao.ts";

const servidor = readFileSync("src/lib/relatorio-sem-alocacao.functions.ts", "utf8");
const tela = readFileSync("src/routes/_authenticated/relatorios.tsx", "utf8");

test("último CC usa a alocação válida mais recente até a data de referência", () => {
  const ultimas = ultimasAlocacoesPorFuncionario(
    [
      { funcionario_id: "f1", obra_id: "cc-antigo", data: "2026-08-01" },
      { funcionario_id: "f1", obra_id: "cc-atual", data: "2026-08-10" },
      { funcionario_id: "f1", obra_id: "cc-futuro", data: "2026-08-12" },
      { funcionario_id: "f2", obra_id: "cc-2", data: "2026-07-20" },
    ],
    "2026-08-11",
  );
  assert.deepEqual(ultimas.get("f1"), {
    funcionario_id: "f1",
    obra_id: "cc-atual",
    data: "2026-08-10",
  });
  assert.equal(ultimas.get("f2")?.data, "2026-07-20");
  assert.equal(ultimas.has("f3"), false);
});

test("servidor usa consultas existentes e limita o histórico à referência", () => {
  assert.match(servidor, /\.from\("alocacoes"\)[\s\S]*\.lte\("data", data\.referencia\)/);
  assert.match(servidor, /\.from\("obras"\)/);
  assert.match(servidor, /ultimasAlocacoesPorFuncionario/);
  assert.doesNotMatch(servidor, /responsavel/i);
});

test("tela e Excel exibem e filtram os novos campos sem renomear a semântica", () => {
  for (const label of [
    "Último CC",
    "Última alocação",
    "Dias sem alocação",
    "Último Centro de Custo",
  ])
    assert.match(tela, new RegExp(label));
  assert.match(tela, /ultimoCcFilter/);
  assert.match(tela, /referencia: dataLimiteAnalise/);
  assert.match(tela, /Sem CC anterior/);
  assert.doesNotMatch(tela, /Responsável pelo CC/);
});
