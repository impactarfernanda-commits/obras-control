import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PORTAL_ORIGIN, portalLogoutUrl } from "./sso.ts";

const auth = fs.readFileSync(new URL("../hooks/use-auth.tsx", import.meta.url), "utf8");
const guard = fs.readFileSync(
  new URL("../routes/_authenticated/route.tsx", import.meta.url),
  "utf8",
);
const sidebar = fs.readFileSync(new URL("../components/AppSidebar.tsx", import.meta.url), "utf8");

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

test("logout explicito bloqueia o redirect do guard antes de emitir SIGNED_OUT", () => {
  const setLoggingOut = auth.indexOf("setIsLoggingOut(true)");
  const signOut = auth.indexOf('supabase.auth.signOut({ scope: "local" })');
  assert.ok(setLoggingOut > 0);
  assert.ok(setLoggingOut < signOut);
  assert.match(guard, /authStatus === "unauthenticated" && !isLoggingOut/);
  assert.equal(portalLogoutUrl(), "https://portal-tks-br.vercel.app/logout");
  assert.notEqual(portalLogoutUrl(), "https://portal-tks-br.vercel.app/?return_path=%2Falocacoes");
});

test("guard preserva o retorno normal de uma sessao ausente", () => {
  const shouldRedirect = (sessionIsMissing: boolean, isLoggingOut: boolean) =>
    sessionIsMissing && !isLoggingOut;
  assert.equal(shouldRedirect(true, false), true);
  assert.equal(shouldRedirect(true, true), false);
  assert.match(guard, /portalLoginUrl\(currentUrl, consumePortalLaunchMarker\(window\)\)/);
});

test("clique duplicado e ignorado e os botoes ficam desabilitados", () => {
  assert.match(auth, /if \(signingOut\.current\) return/);
  assert.match(sidebar, /disabled=\{isLoggingOut\}/);
  assert.match(guard, /disabled=\{isLoggingOut\}/);
});

test("SIGNED_OUT nao encerra o estado de logout explicito", () => {
  const authStateHandler = auth.slice(
    auth.indexOf("supabase.auth.onAuthStateChange"),
    auth.indexOf("supabase.auth.getSession"),
  );
  assert.doesNotMatch(authStateHandler, /setIsLoggingOut\(false\)/);
});

test("estado autenticado do Obras é limpo antes da navegação", () => {
  const clearSession = auth.indexOf("setSession(null)");
  const redirect = auth.indexOf("window.location.replace(portalLogoutUrl())");
  assert.ok(clearSession > 0);
  assert.ok(clearSession < redirect);
  assert.match(auth, /setUser\(null\)/);
  assert.match(auth, /setRole\(null\)/);
});
