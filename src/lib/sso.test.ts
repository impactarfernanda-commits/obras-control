import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  consumePortalLaunchMarker,
  isHandoffCode,
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
test("Portal URL preserva destino seguro sem autoabertura", () => {
  const url = new URL(portalLoginUrl("/obras"));
  assert.equal(url.searchParams.get("return_path"), "/obras");
  assert.equal(url.searchParams.has("app"), false);
});
test("callback exige nonce base64url de 32 bytes", () => {
  assert.equal(isHandoffCode("a".repeat(43)), true);
  assert.equal(isHandoffCode("bad"), false);
});
test("callback top-level limpa code antes de consumir e verifica OTP uma vez", () => {
  assert.match(callback, /history\.replaceState/);
  assert.ok(callback.indexOf("history.replaceState") < callback.indexOf("obras-sso-exchange"));
  assert.equal((callback.match(/verifyOtp\(/g) ?? []).length, 1);
  assert.match(callback, /token_hash:\s*data\.token_hash/);
});
test("sessao, getUser, roles e perfil antecedem redirect final", () => {
  const verify = callback.indexOf("verifyOtp"),
    user = callback.indexOf("supabase.auth.getUser()"),
    roles = callback.indexOf('from("user_roles")'),
    redirect = callback.indexOf("window.location.replace(returnPath)");
  assert.ok(verify >= 0 && user > verify && roles > verify && redirect > user);
  assert.match(callback, /verified\.session/);
  assert.match(callback, /Promise\.all/);
});
test("callback nao depende de iframe, parent, postMessage ou portal_bootstrap", () => {
  assert.doesNotMatch(
    callback,
    /window\.parent|window\.top|postMessage|portal_bootstrap|notifyPortal/,
  );
});
test("fluxo do Portal usa transicao discreta sem texto antigo", () => {
  assert.match(callback, /launchedFromPortal/);
  assert.doesNotMatch(callback, /Entrando no Obras Control/);
  assert.match(callback, /h-5 w-5 animate-spin/);
});
test("code invalido ou reutilizado segue erro controlado sem loop", () => {
  assert.match(callback, /if \(!isHandoffCode\(code\)\)/);
  assert.match(callback, /consumePortalLaunchMarker\(window\)/);
  const target = { name: "obras-control-bootstrap" };
  assert.equal(consumePortalLaunchMarker(target), true);
  assert.equal(target.name, "");
  assert.equal(consumePortalLaunchMarker(target), false);
  assert.equal(
    new URL(portalLoginUrl("/alocacoes", true)).searchParams.get("obras_auth_failed"),
    "1",
  );
});
test("acesso direto mantem fallback e producao Vercel", () => {
  assert.match(callback, /setFailed\(true\)/);
  assert.equal(PORTAL_ORIGIN, "https://portal-tks-br.vercel.app");
  assert.match(auth, /component: import\.meta\.env\.PROD \? ProductionAuthRedirect : AuthPage/);
});
test("nenhum token e enviado por URL ou mensagem", () => {
  assert.doesNotMatch(callback, /searchParams\.set\([^)]*token_hash|postMessage/);
  assert.match(callback, /history\.replaceState/);
});
