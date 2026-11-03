import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { executarHookAlertasAutorizado } from "./alertas-hook-autorizacao.ts";

const segredo = "segredo-exclusivo-de-alertas";
const resultadoEsperado = { created: 2, alerts: 3 };

async function executar(authorization: string | null, segredoEsperado: string | undefined) {
  let execucoesAdministrativas = 0;
  const resultado = await executarHookAlertasAutorizado({
    authorization,
    segredoEsperado,
    executar: async () => {
      execucoesAdministrativas += 1;
      return resultadoEsperado;
    },
  });
  return { resultado, execucoesAdministrativas };
}

test("rejeita quando ALERTS_HOOK_SECRET não está configurado", async () => {
  const { resultado, execucoesAdministrativas } = await executar(`Bearer ${segredo}`, undefined);
  assert.deepEqual(resultado, { autorizado: false });
  assert.equal(execucoesAdministrativas, 0);
});

test("rejeita segredo vazio", async () => {
  const { resultado, execucoesAdministrativas } = await executar("Bearer ", "");
  assert.deepEqual(resultado, { autorizado: false });
  assert.equal(execucoesAdministrativas, 0);
});

test("rejeita ausência do cabeçalho Authorization", async () => {
  const { resultado, execucoesAdministrativas } = await executar(null, segredo);
  assert.deepEqual(resultado, { autorizado: false });
  assert.equal(execucoesAdministrativas, 0);
});

test("rejeita segredo incorreto", async () => {
  const { resultado, execucoesAdministrativas } = await executar(
    "Bearer segredo-incorreto",
    segredo,
  );
  assert.deepEqual(resultado, { autorizado: false });
  assert.equal(execucoesAdministrativas, 0);
});

test("rejeita formato apikey mesmo que contenha o segredo correto", async () => {
  const { resultado, execucoesAdministrativas } = await executar(segredo, segredo);
  assert.deepEqual(resultado, { autorizado: false });
  assert.equal(execucoesAdministrativas, 0);
});

test("chave publicável não autoriza o hook", async () => {
  const chavePublicavel = "sb_publishable_exemplo";
  const { resultado, execucoesAdministrativas } = await executar(
    `Bearer ${chavePublicavel}`,
    segredo,
  );
  assert.deepEqual(resultado, { autorizado: false });
  assert.equal(execucoesAdministrativas, 0);
});

test("Bearer com o segredo exclusivo executa uma vez e preserva o resultado", async () => {
  const { resultado, execucoesAdministrativas } = await executar(`Bearer ${segredo}`, segredo);
  assert.deepEqual(resultado, { autorizado: true, resultado: resultadoEsperado });
  assert.equal(execucoesAdministrativas, 1);
});

test("rota usa apenas ALERTS_HOOK_SECRET e Authorization", () => {
  const rota = readFileSync(
    new URL("../routes/api/public/hooks/check-alerts.ts", import.meta.url),
    "utf8",
  );
  assert.match(rota, /headers\.get\("authorization"\)/);
  assert.match(rota, /process\.env\.ALERTS_HOOK_SECRET/);
  assert.match(rota, /await import\("@\/lib\/alertas\.server"\)/);
  assert.doesNotMatch(rota, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(rota, /headers\.get\("apikey"\)/);
  assert.doesNotMatch(rota, /import\s+\{\s*runAlertChecks\s*\}\s+from/);
});
