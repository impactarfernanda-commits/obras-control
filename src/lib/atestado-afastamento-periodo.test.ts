import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  enumerarDiasCorridos,
  faltaPermitePeriodo,
  normalizarTipoRegistroPeriodo,
} from "./registro-falta.ts";

const componente = readFileSync("src/components/AlocarPeriodoDialog.tsx", "utf8");

test("atestado de um dia mantém o registro diário atual", () => {
  assert.deepEqual(enumerarDiasCorridos("2026-09-02", "2026-09-02"), ["2026-09-02"]);
  assert.deepEqual(normalizarTipoRegistroPeriodo("atestado"), {
    tipoRegistro: "falta",
    faltaTipo: "atestado",
  });
});

test("atestado e afastamento aceitam período inclusivo com fins de semana", () => {
  assert.deepEqual(enumerarDiasCorridos("2026-09-04", "2026-09-07"), [
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
    "2026-09-07",
  ]);
  assert.equal(faltaPermitePeriodo("atestado"), true);
  assert.deepEqual(normalizarTipoRegistroPeriodo("afastamento"), {
    tipoRegistro: "falta",
    faltaTipo: "afastamento",
  });
});

test("intervalo invertido é inválido e não enumera dias", () => {
  assert.deepEqual(enumerarDiasCorridos("2026-09-03", "2026-09-02"), []);
  assert.match(componente, /Data final deve ser igual ou posterior à inicial/);
});

test("período preserva conflitos, revalida concorrência e relata resultado parcial", () => {
  assert.match(componente, /const diasAlvo =[\s\S]*?!setA\.has\(d\)[\s\S]*?!setR\.has\(d\)/);
  assert.match(componente, /ocupadosConcorrentes/);
  assert.match(componente, /ignoreDuplicates: true/);
  assert.match(componente, /Os lançamentos existentes foram preservados/);
  assert.match(componente, /!faltaPeriodo && \(/);
});

test("atestado e afastamento reutilizam RPC e regras diárias sem alterar horas normais", () => {
  assert.match(componente, /rpc\("obras_salvar_registro_horas"/);
  assert.match(componente, /p_falta_tipo: faltaTipo/);
  assert.match(componente, /p_horas_normais: 0/);
  assert.match(componente, /p_horas_extras: 0/);
  assert.match(componente, /garantirCompetenciaAberta\(supabase, data\)/);
  assert.match(componente, /calcularJornadaDetalhada/);
});
