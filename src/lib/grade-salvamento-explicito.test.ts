import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const grade = readFileSync("src/components/RegistrosGrid.tsx", "utf8");

test("Grade mantém alterações locais até confirmação explícita", () => {
  assert.match(
    grade,
    /setSaving\(\(statusAtual\) => \(\{ \.\.\.statusAtual, \[key\]: "dirty" \}\)\)/,
  );
  assert.doesNotMatch(grade, /setTimeout\(\(\) => saveCell\(key, next\), 700\)/);
  assert.match(grade, /onSave=\{\(\) => void saveCell\(key, registroComEspecialidade\)\}/);
});

test("popover oferece botão Salvar alterações com feedback de pendência", () => {
  assert.match(grade, /"Salvar alterações"/);
  assert.match(grade, /Alterações pendentes de confirmação/);
  assert.match(grade, /disabled=\{status !== "dirty" && status !== "error"\}/);
});

test("refetch não sobrescreve rascunho ainda não confirmado", () => {
  assert.match(grade, /saving\[key\] === "saving" \|\| saving\[key\] === "dirty"/);
});
