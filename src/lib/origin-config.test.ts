import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalOrigin, configuredPortalOrigin } from "./origin-config.ts";

test("origin Vercel de producao e local sao normalizados sem path", () => {
  assert.equal(
    canonicalOrigin("https://portal-tks-br.vercel.app/path"),
    "https://portal-tks-br.vercel.app",
  );
  assert.equal(canonicalOrigin("http://localhost:5173/"), "http://localhost:5173");
});
test("runtime server usa PORTAL_ORIGIN na CSP restritiva", () => {
  assert.equal(
    configuredPortalOrigin({ PORTAL_ORIGIN: "https://portal-tks-br.vercel.app/" }),
    "https://portal-tks-br.vercel.app",
  );
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /frame-ancestors 'self' \$\{configuredPortalOrigin\(env\)\}/);
  assert.doesNotMatch(server, /frame-ancestors[^\n]*\*/);
});
