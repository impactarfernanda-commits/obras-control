import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  consumePortalLaunchMarker,
  isHandoffCode,
  isPortalBootstrap,
  OBRAS_ERROR_MESSAGE,
  OBRAS_READY_MESSAGE,
  portalBootstrapMessage,
  portalLoginUrl,
  PORTAL_ORIGIN,
  safeReturnPath,
} from "./sso.ts";
const callback = readFileSync(new URL("../routes/sso.callback.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../routes/auth.tsx", import.meta.url), "utf8");
test("return_path aceita apenas rotas internas permitidas", () => {
  assert.equal(safeReturnPath("/alocacoes"), "/alocacoes");
  for (const bad of ["//evil.test", "https://evil.test", "javascript:alert(1)", "/nao-existe"])
    assert.equal(safeReturnPath(bad), "/alocacoes");
});
test("redirecionamento ao Portal preserva destino seguro", () => {
  const url = new URL(portalLoginUrl("/obras"));
  assert.equal(url.searchParams.get("app"), null);
  assert.equal(url.searchParams.get("return_path"), "/obras");
});
test("redirecionamento ao Portal nao solicita abertura automatica do Obras", () => {
  const url = new URL(portalLoginUrl("/configuracoes"));
  assert.equal(url.pathname, "/");
  assert.deepEqual([...url.searchParams.keys()], ["return_path"]);
});
test("destino invalido volta para Alocacoes sem criar loop", () => {
  const url = new URL(portalLoginUrl("https://evil.test"));
  assert.equal(url.searchParams.get("return_path"), "/alocacoes");
  assert.equal(url.searchParams.has("app"), false);
});
test("rotas sem sessao e logout levam ao Portal sem parametro de autoabertura", () => {
  const guard = readFileSync(
    new URL("../routes/_authenticated/route.tsx", import.meta.url),
    "utf8",
  );
  const authProvider = readFileSync(new URL("../hooks/use-auth.tsx", import.meta.url), "utf8");
  assert.match(
    guard,
    /window\.location\.replace\(portalLoginUrl\(pathname, consumePortalLaunchMarker\(window\)\)\)/,
  );
  assert.match(authProvider, /window\.location\.assign\(PORTAL_ORIGIN\)/);
  assert.doesNotMatch(authProvider, /app=obras-control/);
});
test("callback exige nonce base64url de 32 bytes", () => {
  assert.equal(isHandoffCode("a".repeat(43)), true);
  assert.equal(isHandoffCode("bad"), false);
});
test("callback limpa URL, troca sessão antiga e verifica OTP", () => {
  assert.match(callback, /history\.replaceState/);
  assert.match(callback, /signOut\(\{\s*scope:\s*"local"\s*\}\)/);
  assert.match(
    callback,
    /verifyOtp\(\{[\s\S]*?token_hash:\s*data\.token_hash,[\s\S]*?type:\s*"magiclink"/,
  );
  assert.doesNotMatch(callback, /searchParams\.set\([^)]*token_hash/);
});
test("produção não oferece login ou cadastro local", () => {
  assert.match(auth, /component: import\.meta\.env\.PROD \? ProductionAuthRedirect : AuthPage/);
});
test("bootstrap em iframe e explicito; acesso direto preserva fallback", () => {
  assert.equal(
    isPortalBootstrap(new URL("https://obras.test/sso/callback?portal_bootstrap=1"), true),
    true,
  );
  assert.equal(
    isPortalBootstrap(new URL("https://obras.test/sso/callback?portal_bootstrap=1"), false),
    false,
  );
  assert.match(callback, /Entrando no Obras Control/);
});
test("ready ocorre apenas depois de sessao, usuario e perfil resolvidos", () => {
  const verify = callback.indexOf("verifyOtp");
  const user = callback.indexOf("supabase.auth.getUser()");
  const ready = callback.indexOf("notifyPortal(OBRAS_READY_MESSAGE");
  assert.ok(verify >= 0 && user > verify && ready > user);
  assert.match(callback, /Promise\.all/);
});
test("mensagem ao Portal tem payload minimo, origin exato e nenhum token", () => {
  assert.deepEqual(portalBootstrapMessage(OBRAS_READY_MESSAGE, "/obras"), {
    type: OBRAS_READY_MESSAGE,
    return_path: "/obras",
  });
  assert.deepEqual(portalBootstrapMessage(OBRAS_ERROR_MESSAGE), { type: OBRAS_ERROR_MESSAGE });
  const messaging = callback.match(/postMessage\([\s\S]*?\);/)?.[0] ?? "";
  assert.match(messaging, /new URL\(PORTAL_ORIGIN\)\.origin/);
  assert.doesNotMatch(messaging, /access_token|refresh_token|token_hash/);
});
test("erro de bootstrap sinaliza falha sem loop de redirect", () => {
  assert.match(callback, /notifyPortal\(OBRAS_ERROR_MESSAGE\)/);
  assert.equal((callback.match(/window\.location\.replace/g) ?? []).length, 1);
});
test("origin corporativo configurado governa postMessage e retorno ao Portal", () => {
  assert.equal(new URL(PORTAL_ORIGIN).origin, PORTAL_ORIGIN);
  assert.match(callback, /new URL\(PORTAL_ORIGIN\)\.origin/);
  assert.doesNotMatch(callback, /postMessage\([^)]*,\s*["']\*["']/);
});
test("retorno top-level sem sessao sinaliza falha uma vez e nao reinicia SSO", () => {
  const target = { name: "obras-control-bootstrap" };
  assert.equal(consumePortalLaunchMarker(target), true);
  assert.equal(target.name, "");
  assert.equal(consumePortalLaunchMarker(target), false);
  const url = new URL(portalLoginUrl("/alocacoes", true));
  assert.equal(url.searchParams.get("obras_auth_failed"), "1");
  const guard = readFileSync(
    new URL("../routes/_authenticated/route.tsx", import.meta.url),
    "utf8",
  );
  assert.match(guard, /consumePortalLaunchMarker\(window\)/);
  assert.doesNotMatch(guard, /startObrasSso|portal_bootstrap/);
});
