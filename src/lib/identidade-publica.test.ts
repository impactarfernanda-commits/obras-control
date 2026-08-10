import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const rootRoutePath = "src/routes/__root.tsx";
const rootRoute = readFileSync(rootRoutePath, "utf8");

test("metadata publica identifica o sistema como Obras Control", () => {
  assert.match(rootRoute, /\{ title: "Obras Control" \}/);
  assert.match(rootRoute, /name: "application-name", content: "Obras Control"/);
  assert.match(rootRoute, /property: "og:title", content: "Obras Control"/);
  assert.match(rootRoute, /name: "twitter:title", content: "Obras Control"/);
  assert.doesNotMatch(rootRoute, /Lovable App|Lovable Generated Project|@Lovable/);
});

test("favicon ativo usa um asset existente do projeto", () => {
  const faviconImport = rootRoute.match(/import faviconUrl from "\.\.\/(.+)\?url";/);

  assert.ok(faviconImport?.[1], "a rota raiz deve importar o favicon");
  assert.ok(rootRoute.includes('rel: "icon"'));
  assert.ok(rootRoute.includes('rel: "apple-touch-icon"'));
  assert.ok(existsSync(`src/${faviconImport[1]}`), "o asset do favicon deve existir");
});

test("arquivos publicos opcionais nao expoem metadata do Lovable", () => {
  for (const path of ["index.html", "public/manifest.json", "public/manifest.webmanifest"]) {
    if (existsSync(path)) {
      assert.doesNotMatch(readFileSync(path, "utf8"), /lovable/i, `${path} nao deve expor Lovable`);
    }
  }
});
