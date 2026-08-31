import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nova = readFileSync(
  new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url),
  "utf8",
);
const periodo = readFileSync(
  new URL("../components/AlocarPeriodoDialog.tsx", import.meta.url),
  "utf8",
);
const copia = readFileSync(
  new URL("../components/CopiarDiaAnteriorDialog.tsx", import.meta.url),
  "utf8",
);

test("Nova alocação restaura todos os campos editáveis e limpa somente no sucesso ou descarte", () => {
  for (const campo of [
    "funcionario_id",
    "obra_id",
    "data_fim",
    "tipo_registro",
    "falta_tipo",
    "hora_entrada",
    "hora_saida",
    "intervalo_minutos",
    "observacoes",
    "justificativa_extras",
    "especialidade_ajudante",
  ])
    assert.match(nova, new RegExp(campo));
  assert.match(nova, /form\.reset\(restoredNovaAlocacaoDraft\)/);
  assert.match(nova, /onSuccess:[\s\S]*clearNovaAlocacaoDraft\(\)/);
  assert.match(nova, /onError:[\s\S]*toast\.error/);
  assert.match(nova, /Descartar rascunho/);
});

test("Alocar período restaura parâmetros e isola o rascunho pela obra", () => {
  assert.match(periodo, /flow: "alocar-periodo"/);
  assert.match(periodo, /context: obraId/);
  for (const campo of [
    "funcionarioId",
    "dataInicio",
    "dataFim",
    "tipoRegistro",
    "especialidadeAjudante",
    "modo",
  ])
    assert.match(periodo, new RegExp(`restoredDraft\\.${campo}`));
  assert.match(periodo, /Descartar rascunho/);
});

test("Copiar dia restaura seleção, jornadas, observações e classificação sem aplicar RPC", () => {
  assert.match(copia, /flow: "copiar-dia-anterior"/);
  assert.match(copia, /context: obraId/);
  assert.match(copia, /setRascunhos\(restoredDraft\.rascunhos\)/);
  assert.match(copia, /setEscolhas\(restoredDraft\.escolhas\)/);
  assert.match(copia, /setPrevia\(restoredDraft\.previa\)/);
  assert.match(copia, /justificativa/);
  assert.match(copia, /observacoes/);
  assert.match(copia, /Rascunho recuperado/);
  assert.equal((copia.match(/obras_copiar_jornadas_v2/g) ?? []).length, 1);
});
