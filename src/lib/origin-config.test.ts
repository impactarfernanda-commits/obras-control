import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalOrigin, configuredPortalOrigin } from "./origin-config.ts";

test("origin corporativo e local sao normalizados sem path", () => {
  assert.equal(
    canonicalOrigin("https://portal.tanksbr.com.br/path"),
    "https://portal.tanksbr.com.br",
  );
  assert.equal(canonicalOrigin("http://localhost:5173/"), "http://localhost:5173");
});

test("runtime server usa PORTAL_ORIGIN na CSP sem wildcard", () => {
  assert.equal(
    configuredPortalOrigin({ PORTAL_ORIGIN: "https://portal.tanksbr.com.br/" }),
    "https://portal.tanksbr.com.br",
  );
  const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  assert.match(server, /frame-ancestors 'self' \$\{configuredPortalOrigin\(env\)\}/);
  assert.doesNotMatch(server, /frame-ancestors[^\n]*\*/);
  assert.doesNotMatch(server, /frame-ancestors[^\n]*portal-tks-br\.vercel\.app/);
});
