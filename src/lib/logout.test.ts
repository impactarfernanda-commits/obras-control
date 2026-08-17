import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PORTAL_ORIGIN, portalLogoutUrl } from "./sso.ts";

const auth = fs.readFileSync(new URL("../hooks/use-auth.tsx", import.meta.url), "utf8");

test("logout do Obras encerra apenas a sessão local", () => {
  assert.match(auth, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
});

test("logout usa replace para a rota dedicada do Portal", () => {
  assert.equal(portalLogoutUrl(), `${PORTAL_ORIGIN}/logout`);
  assert.match(auth, /window\.location\.replace\(portalLogoutUrl\(\)\)/);
  assert.doesNotMatch(auth, /window\.location\.assign\(PORTAL_ORIGIN\)/);
});

test("falha do signOut ainda segue uma vez para o logout do Portal", () => {
  assert.match(auth, /if \(signingOut\.current\) return/);
  assert.match(auth, /try \{[\s\S]*await supabase\.auth\.signOut[\s\S]*\} finally \{/);
  assert.doesNotMatch(auth, /setTimeout|setInterval/);
});

test("estado autenticado do Obras é limpo antes da navegação", () => {
  const clearSession = auth.indexOf("setSession(null)");
  const redirect = auth.indexOf("window.location.replace(portalLogoutUrl())");
  assert.ok(clearSession > 0);
  assert.ok(clearSession < redirect);
  assert.match(auth, /setUser\(null\)/);
  assert.match(auth, /setRole\(null\)/);
});
