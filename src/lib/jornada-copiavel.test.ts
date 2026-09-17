import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { jornadaOrigemCopiavel } from "./jornada-copiavel.ts";
import { itensSelecionadosCopia, type JornadaCopiaRascunho } from "./copiar-dia-anterior.ts";

const obra = "obra-1";
const horas = {
  obra_id: obra,
  tipo_registro: "horas",
  ausencia: false,
  falta_tipo: null,
  motivo_ausencia: null,
  horas_normais: 8,
  horas_extras: 0,
};
const falta = (falta_tipo: string) => ({
  ...horas,
  tipo_registro: "falta",
  ausencia: true,
  falta_tipo,
  horas_normais: 0,
});

test("alocação isolada, ausências e estados incompletos falham fechado", () => {
  assert.equal(jornadaOrigemCopiavel([], obra, true), false);
  assert.equal(jornadaOrigemCopiavel([horas], obra, false), false);
  for (const tipo of ["folga_campo", "ferias"]) {
    assert.equal(
      jornadaOrigemCopiavel(
        [{ ...horas, tipo_registro: tipo, ausencia: true, horas_normais: 0 }],
        obra,
        true,
      ),
      false,
    );
  }
  for (const subtipo of ["nao_justificada", "atestado", "afastamento"]) {
    assert.equal(jornadaOrigemCopiavel([falta(subtipo)], obra, true), false);
  }
  assert.equal(jornadaOrigemCopiavel([{ ...horas, horas_normais: 0 }], obra, true), false);
  assert.equal(jornadaOrigemCopiavel([{ ...horas, ausencia: true }], obra, true), false);
  assert.equal(jornadaOrigemCopiavel([horas, falta("atestado")], obra, true), false);
  assert.equal(jornadaOrigemCopiavel([horas, horas], obra, true), false);
});

test("jornadas reais, inclusive só com horas extras, continuam copiáveis; lote é individual", () => {
  const extras = { ...horas, horas_normais: 0, horas_extras: 5 };
  assert.equal(jornadaOrigemCopiavel([horas], obra, true), true);
  assert.equal(jornadaOrigemCopiavel([extras], obra, true), true);
  const lote = [[horas], [falta("atestado")], [extras], []];
  assert.deepEqual(
    lote.map((registros) => jornadaOrigemCopiavel(registros, obra, true)),
    [true, false, true, false],
  );
});

test("destino ocupado e origem não copiável ficam fora do lote enviado", () => {
  const itens = [
    { funcionario_id: "joao", nome: "João", status: "adicionar" as const, motivo: null },
    { funcionario_id: "maria", nome: "Maria", status: "ja_existente" as const, motivo: null },
    { funcionario_id: "ana", nome: "Ana", status: "nao_copiavel" as const, motivo: null },
  ];
  const rascunhos = { joao: { incluirNaCopia: true } as JornadaCopiaRascunho };
  assert.deepEqual(
    itensSelecionadosCopia(itens, rascunhos).map((item) => item.funcionario_id),
    ["joao"],
  );
});

test("SQL mantém ramo manual sem origemData, valida cópia, preserva destino e elimina fallback", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20260917120000_copia_somente_jornadas.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /IF v_origem_calculo = 'copia' THEN[\s\S]*v_origem_data :=/);
  assert.match(
    sql,
    /v_origem_calculo := coalesce\(nullif\(v_item->>'origemCalculo', ''\), 'copia'\)/,
  );
  assert.match(sql, /v_item->'detalhe', v_origem_calculo/);
  assert.match(sql, /v_origem_calculo = 'copia' AND v_alocacao_id IS NULL AND EXISTS/);
  assert.match(sql, /EXCEPTION WHEN unique_violation/);
  assert.doesNotMatch(sql, /THEN 8 ELSE 9|horas_normais > 0 LIMIT 1/);
  assert.match(sql, /coalesce\(r\.horas_normais, 0\) \+ coalesce\(r\.horas_extras, 0\) > 0/);
  const rollback = readFileSync(
    new URL(
      "../../supabase/manual/ROLLBACK_20260917120000_copia_somente_jornadas.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(rollback, /v_origem_calculo := coalesce/);
  assert.match(rollback, /REVOKE ALL ON FUNCTION public\.obras_copiar_jornadas_v2/);
});
