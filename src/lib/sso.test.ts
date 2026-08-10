import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isHandoffCode, portalLoginUrl, safeReturnPath } from "./sso.ts";
const callback = readFileSync(new URL("../routes/sso.callback.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../routes/auth.tsx", import.meta.url), "utf8");
test("return_path aceita apenas rotas internas permitidas", () => {
  assert.equal(safeReturnPath("/alocacoes"), "/alocacoes");
  for (const bad of ["//evil.test", "https://evil.test", "javascript:alert(1)", "/nao-existe"])
    assert.equal(safeReturnPath(bad), "/alocacoes");
});
test("redirecionamento ao Portal preserva destino seguro", () => {
  const url = new URL(portalLoginUrl("/obras"));
  assert.equal(url.searchParams.get("app"), "obras-control");
  assert.equal(url.searchParams.get("return_path"), "/obras");
});
test("callback exige nonce base64url de 32 bytes", () => {
  assert.equal(isHandoffCode("a".repeat(43)), true);
  assert.equal(isHandoffCode("bad"), false);
});
test("callback limpa URL, troca sessão antiga e verifica OTP", () => {
  assert.match(callback, /history\.replaceState/);
  assert.match(callback, /signOut\(\{\s*scope:\s*"local"\s*\}\)/);
  assert.match(callback, /verifyOtp\(\{[\s\S]*?token_hash:\s*data\.token_hash,[\s\S]*?type:\s*"magiclink"/);
  assert.doesNotMatch(callback, /searchParams\.set\([^)]*token_hash/);
});
test("produção não oferece login ou cadastro local", () => {
  assert.match(auth, /component: import\.meta\.env\.PROD \? ProductionAuthRedirect : AuthPage/);
});
