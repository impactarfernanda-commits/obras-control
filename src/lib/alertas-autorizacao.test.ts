import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { executarAlertasManualAutorizado } from "./alertas-autorizacao.ts";

const resultadoEsperado = { created: 2, alerts: 3 };

async function executarComRoles(roles: Array<string | null>) {
  let execucoesAdministrativas = 0;
  const resultado = await executarAlertasManualAutorizado({
    buscarRoles: async () => ({
      data: roles.map((role) => ({ role })),
      error: null,
    }),
    executar: async () => {
      execucoesAdministrativas += 1;
      return resultadoEsperado;
    },
  });
  return { resultado, execucoesAdministrativas };
}

for (const role of ["assistente", "supervisor", "coordenador"]) {
  test(`${role} não executa a rotina administrativa de alertas`, async () => {
    let execucoesAdministrativas = 0;
    await assert.rejects(
      executarAlertasManualAutorizado({
        buscarRoles: async () => ({ data: [{ role }], error: null }),
        executar: async () => {
          execucoesAdministrativas += 1;
          return resultadoEsperado;
        },
      }),
      /Forbidden: alertas disponíveis apenas para gerente e diretor/,
    );
    assert.equal(execucoesAdministrativas, 0);
  });
}

for (const role of ["gerente", "diretor"]) {
  test(`${role} executa alertas e recebe o resultado sem alteração`, async () => {
    const { resultado, execucoesAdministrativas } = await executarComRoles([role]);
    assert.deepEqual(resultado, resultadoEsperado);
    assert.equal(execucoesAdministrativas, 1);
  });
}

test("ausência de role autorizada não executa operação administrativa", async () => {
  let execucoesAdministrativas = 0;
  await assert.rejects(
    executarAlertasManualAutorizado({
      buscarRoles: async () => ({ data: [], error: null }),
      executar: async () => {
        execucoesAdministrativas += 1;
        return resultadoEsperado;
      },
    }),
    /Forbidden/,
  );
  assert.equal(execucoesAdministrativas, 0);
});

test("erro ao consultar roles aborta antes da operação administrativa", async () => {
  let execucoesAdministrativas = 0;
  await assert.rejects(
    executarAlertasManualAutorizado({
      buscarRoles: async () => ({ data: null, error: { message: "role query failed" } }),
      executar: async () => {
        execucoesAdministrativas += 1;
        return resultadoEsperado;
      },
    }),
    /role query failed/,
  );
  assert.equal(execucoesAdministrativas, 0);
});

test("role alegada pelo cliente não participa da autorização", async () => {
  const entradaDoCliente = { role: "diretor" };
  let execucoesAdministrativas = 0;
  await assert.rejects(
    executarAlertasManualAutorizado({
      buscarRoles: async () => ({ data: [{ role: "assistente" }], error: null }),
      executar: async () => {
        execucoesAdministrativas += 1;
        return { ...resultadoEsperado, entradaDoCliente };
      },
    }),
    /Forbidden/,
  );
  assert.equal(entradaDoCliente.role, "diretor");
  assert.equal(execucoesAdministrativas, 0);
});

test("serverFn exige autenticação, usa o usuário verificado e adia o código administrativo", () => {
  const serverFn = readFileSync(new URL("./alertas.functions.ts", import.meta.url), "utf8");
  assert.match(serverFn, /\.middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(serverFn, /\.eq\("user_id", context\.userId\)/);
  assert.doesNotMatch(serverFn, /data\.(?:role|userId)|claims\.(?:role|user_metadata)/);
  assert.doesNotMatch(serverFn, /import\s+\{\s*runAlertChecks\s*\}/);

  const roleQuery = serverFn.indexOf('context.supabase.from("user_roles")');
  const adminImport = serverFn.indexOf('await import("./alertas.server")');
  assert.ok(roleQuery >= 0);
  assert.ok(adminImport > roleQuery);
});

test("middleware rejeita ausência de bearer e token inválido ou expirado", () => {
  const middleware = readFileSync(
    new URL("../integrations/supabase/auth-middleware.ts", import.meta.url),
    "utf8",
  );
  assert.match(middleware, /if \(!authHeader\)/);
  assert.match(middleware, /Unauthorized: No authorization header provided/);
  assert.match(middleware, /supabase\.auth\.getClaims\(token\)/);
  assert.match(middleware, /if \(error \|\| !data\?\.claims\)/);
  assert.match(middleware, /Unauthorized: Invalid token/);
});
