import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolverEspecialidadeAjudanteGrade } from "./especialidade-ajudante.ts";

test("edição de horas preserva especialidade Civil persistida", () => {
  assert.equal(resolverEspecialidadeAjudanteGrade("civil", null), "civil");
  assert.equal(resolverEspecialidadeAjudanteGrade("civil", "montagem"), "civil");
});

test("edição de horas preserva especialidade Montagem persistida", () => {
  assert.equal(resolverEspecialidadeAjudanteGrade("montagem", null), "montagem");
  assert.equal(resolverEspecialidadeAjudanteGrade("montagem", "civil"), "montagem");
});

test("alocação legada sem classificação exige uma seleção antes de salvar", () => {
  assert.equal(resolverEspecialidadeAjudanteGrade(null, null), null);
  assert.equal(resolverEspecialidadeAjudanteGrade(null, "civil"), "civil");
  assert.equal(resolverEspecialidadeAjudanteGrade(null, "montagem"), "montagem");
});

test("Grade carrega e reenvia especialidade da alocação sem alterá-la", () => {
  const grade = readFileSync("src/components/RegistrosGrid.tsx", "utf8");
  assert.match(grade, /\.select\("funcionario_id, data, especialidade_ajudante"\)/);
  assert.match(grade, /especialidade_ajudante: exigeEspecialidade \? especialidadeAjudante : null/);
  assert.match(grade, /else if \(exigeEspecialidade && !especialidadePersistida\)/);
  assert.match(grade, /\.update\(\{ especialidade_ajudante: especialidadeAjudante \}\)/);
  assert.match(grade, /\(!alocado \|\| !especialidadePersistida\)/);
});
