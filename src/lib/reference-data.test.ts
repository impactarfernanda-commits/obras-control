import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  REFERENCE_STALE_TIME,
  categoriasOptions,
  funcionariosSegurosOptions,
  invalidateCategorias,
  obrasCompletasOptions,
  obrasMinimasOptions,
  referenceDataKeys,
  removeReferenceDataForUser,
} from "./reference-data.ts";

test("consultas canônicas iguais compartilham a mesma resposta enquanto estão frescas", async () => {
  const client = new QueryClient();
  let chamadas = 0;
  const options = {
    ...categoriasOptions("user-a"),
    queryFn: async () => {
      chamadas += 1;
      return [{ nome: "Ajudante", tipo: "MOD" as const }];
    },
  };

  const primeira = await client.fetchQuery(options);
  const segunda = await client.fetchQuery(options);

  assert.equal(chamadas, 1);
  assert.strictEqual(primeira, segunda);
});

test("formatos diferentes de obras possuem chaves independentes", () => {
  assert.notDeepEqual(
    obrasMinimasOptions("user-a").queryKey,
    obrasCompletasOptions("user-a").queryKey,
  );
});

test("staleTime segue a volatilidade definida para cada domínio", () => {
  assert.equal(categoriasOptions("user-a").staleTime, 30 * 60 * 1000);
  assert.equal(REFERENCE_STALE_TIME.feriados, 30 * 60 * 1000);
  assert.equal(obrasMinimasOptions("user-a").staleTime, 5 * 60 * 1000);
  assert.equal(funcionariosSegurosOptions("user-a").staleTime, 5 * 60 * 1000);
});

test("dados expirados são buscados novamente", async () => {
  const client = new QueryClient();
  const base = categoriasOptions("user-a");
  client.setQueryData(base.queryKey, [{ nome: "Antiga", tipo: "MOD" }], {
    updatedAt: Date.now() - REFERENCE_STALE_TIME.categorias - 1,
  });
  let chamadas = 0;

  const atual = await client.fetchQuery({
    ...base,
    queryFn: async () => {
      chamadas += 1;
      return [{ nome: "Atual", tipo: "MOI" as const }];
    },
  });

  assert.equal(chamadas, 1);
  assert.equal(atual[0]?.nome, "Atual");
});

test("invalidação após mutação impede a permanência de dados desatualizados", async () => {
  const client = new QueryClient();
  const base = categoriasOptions("user-a");
  client.setQueryData(base.queryKey, [{ nome: "Antes", tipo: "MOD" }]);
  await invalidateCategorias(client);
  assert.equal(client.getQueryState(base.queryKey)?.isInvalidated, true);

  const atual = await client.fetchQuery({
    ...base,
    queryFn: async () => [{ nome: "Depois", tipo: "MOI" as const }],
  });
  assert.equal(atual[0]?.nome, "Depois");
});

test("invalidação refaz imediatamente uma consulta com componente montado", async () => {
  const client = new QueryClient();
  let chamadas = 0;
  const observer = new QueryObserver(client, {
    ...categoriasOptions("user-a"),
    queryFn: async () => {
      chamadas += 1;
      return [{ nome: `Versão ${chamadas}`, tipo: "MOD" as const }];
    },
  });
  const aguardarChamadas = (quantidade: number) =>
    new Promise<void>((resolve) => {
      let unsubscribe: () => void = () => {};
      unsubscribe = observer.subscribe((result) => {
        if (chamadas >= quantidade && result.fetchStatus === "idle") {
          unsubscribe();
          resolve();
        }
      });
    });

  await aguardarChamadas(1);
  const atualizada = aguardarChamadas(2);
  await invalidateCategorias(client);
  await atualizada;

  assert.equal(chamadas, 2);
  assert.deepEqual(client.getQueryData(categoriasOptions("user-a").queryKey), [
    { nome: "Versão 2", tipo: "MOD" },
  ]);
});

test("cache é isolado por usuário e removido na troca de sessão", () => {
  const client = new QueryClient();
  const userA = referenceDataKeys.categorias("user-a");
  const userB = referenceDataKeys.categorias("user-b");
  client.setQueryData(userA, [{ nome: "A", tipo: "MOD" }]);
  client.setQueryData(userB, [{ nome: "B", tipo: "MOI" }]);

  assert.notDeepEqual(userA, userB);
  removeReferenceDataForUser(client, "user-a");
  assert.equal(client.getQueryData(userA), undefined);
  assert.deepEqual(client.getQueryData(userB), [{ nome: "B", tipo: "MOI" }]);
});

test("fluxos de mutação invalidam as novas famílias canônicas", () => {
  const configuracoes = readFileSync(
    new URL("../routes/_authenticated/configuracoes.tsx", import.meta.url),
    "utf8",
  );
  const obras = readFileSync(
    new URL("../routes/_authenticated/obras.tsx", import.meta.url),
    "utf8",
  );
  const funcionarios = readFileSync(
    new URL("../routes/_authenticated/funcionarios.tsx", import.meta.url),
    "utf8",
  );
  const importacao = readFileSync(
    new URL("../components/ImportarPlanilhaLegadoDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(configuracoes, /invalidateCategorias\(qc\)/);
  assert.match(obras, /invalidateObras\(queryClient\)/);
  assert.match(funcionarios, /invalidateFuncionarios\(qc\)/);
  assert.match(importacao, /invalidateFuncionarios\(qc\)/);
});
