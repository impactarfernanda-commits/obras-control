import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { preserveAuthenticatedUser } from "./auth-session.ts";
import { safeReturnPath } from "./sso.ts";

const authHook = readFileSync(new URL("../hooks/use-auth.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../routes/_authenticated/route.tsx", import.meta.url), "utf8");
const authPage = readFileSync(new URL("../routes/auth.tsx", import.meta.url), "utf8");
const router = readFileSync(new URL("../router.tsx", import.meta.url), "utf8");
const allocationPage = readFileSync(
  new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url),
  "utf8",
);

const user = { id: "user-a" } as User;

test("refresh normal preserva a identidade e não remonta a página autenticada", () => {
  const refreshed = { id: "user-a", updated_at: "novo-token" } as User;
  assert.equal(preserveAuthenticatedUser(user, refreshed), user);
  assert.match(authHook, /setUser\(\(current\) => preserveAuthenticatedUser/);
});

test("sessão realmente inválida continua limpando a identidade", () => {
  assert.equal(preserveAuthenticatedUser(user, null), null);
  assert.match(layout, /authStatus === "unauthenticated" && !isLoggingOut/);
  assert.match(layout, /portalLoginUrl\(currentUrl, consumePortalLaunchMarker\(window\)\)/);
  assert.match(layout, /window\.location\.replace\(/);
});

test("foco, blur e visibilitychange não executam navegação ou fechamento de modal", () => {
  for (const source of [authHook, layout, router]) {
    assert.doesNotMatch(
      source,
      /visibilitychange|visibilityState|addEventListener\([^)]*focus|\bblur\b/,
    );
  }
  assert.doesNotMatch(
    allocationPage,
    /visibilitychange|visibilityState|window\.onfocus|window\.onblur/,
  );
});

test("rota, query params e hash são preservados no retorno autenticado", () => {
  const target = "/alocacoes?obra=obra-1&competencia=2026-08#detalhes";
  assert.equal(safeReturnPath(target), target);
  assert.match(layout, /state\.location\.href/);
  assert.match(layout, /portalLoginUrl\(currentUrl/);
  assert.match(authPage, /window\.location\.replace\(returnPath\)/);
});

test("retorno autenticado rejeita URL externa e rota não autorizada", () => {
  assert.equal(safeReturnPath("//evil.example/alocacoes?obra=1"), "/alocacoes");
  assert.equal(safeReturnPath("/admin?obra=1"), "/alocacoes");
});

test("scroll restoration permanece habilitado e rascunhos continuam integrados", () => {
  assert.match(router, /scrollRestoration: true/);
  assert.match(allocationPage, /usePersistentDraft<FormVals>/);
  assert.match(allocationPage, /flow: "nova-alocacao"/);
});
