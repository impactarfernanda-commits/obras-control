import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizarFuncionariosAlocacao, rotuloFuncionarioAlocacao } from "./alocacoes-runtime.ts";
import { APP_NAVIGATION_ITEMS } from "./navigation.ts";

const sourceAlocacoes = readFileSync(
  new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url),
  "utf8",
);
const sourceSidebar = readFileSync(
  new URL("../components/AppSidebar.tsx", import.meta.url),
  "utf8",
);
const sourceRoot = readFileSync(new URL("../routes/__root.tsx", import.meta.url), "utf8");
const sourceAuthenticated = readFileSync(
  new URL("../routes/_authenticated/route.tsx", import.meta.url),
  "utf8",
);
const sourceIndex = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");
const sourceDashboard = readFileSync(
  new URL("../routes/_authenticated/dashboard.tsx", import.meta.url),
  "utf8",
);
const sourceSsoCallback = readFileSync(
  new URL("../routes/sso.callback.tsx", import.meta.url),
  "utf8",
);
const sourceVite = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

const expectedNavigation = [
  ["Funcionários", "/funcionarios"],
  ["Centros de custo", "/obras"],
  ["Alocações", "/alocacoes"],
  ["Relatórios", "/relatorios"],
  ["Planejamento HH e Custos", "/planejamento-hh"],
  ["Configurações", "/configuracoes"],
  ["Usuários", "/admin/usuarios"],
];

function funcionario(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    nome: "Pessoa de teste",
    categoria_mo: "Montador",
    ativo: true,
    data_admissao: "2026-01-01",
    data_desligamento: null,
    deleted_at: null,
    visivel_obras_control: true,
    ...overrides,
  };
}

test("labels da sidebar são exatamente os esperados", () => {
  assert.deepEqual(
    APP_NAVIGATION_ITEMS.map(({ title, url }) => [title, url]),
    expectedNavigation,
  );
});

test("Dashboard fica oculto e Funcionários abre a navegação", () => {
  assert.doesNotMatch(
    readFileSync(new URL("./navigation.ts", import.meta.url), "utf8"),
    /url: "\/dashboard"/,
  );
  assert.deepEqual(APP_NAVIGATION_ITEMS[0], {
    title: "Funcionários",
    url: "/funcionarios",
    minLevel: 1,
  });
});

test("ordem e permissões da navegação permanecem restritas", () => {
  assert.deepEqual(APP_NAVIGATION_ITEMS, [
    { title: "Funcionários", url: "/funcionarios", minLevel: 1 },
    { title: "Centros de custo", url: "/obras", minLevel: 1 },
    { title: "Alocações", url: "/alocacoes", minLevel: 1 },
    {
      title: "Relatórios",
      url: "/relatorios",
      minLevel: 2,
      allowedRoles: ["coordenador", "gerente", "diretor"],
    },
    {
      title: "Planejamento HH e Custos",
      url: "/planejamento-hh",
      minLevel: 2,
      allowedRoles: ["gerente", "diretor"],
    },
    { title: "Configurações", url: "/configuracoes", minLevel: 3 },
    {
      title: "Usuários",
      url: "/admin/usuarios",
      minLevel: 1,
      requiresUserManagement: true,
    },
  ]);
  assert.match(sourceSidebar, /i\.allowedRoles[\s\S]*i\.allowedRoles\.includes\(role\)/);
});

test("raiz e Dashboard redirecionam para Alocações sem remover sua implementação", () => {
  assert.match(sourceIndex, /redirect\(\{ to: "\/alocacoes" \}\)/);
  assert.match(sourceDashboard, /beforeLoad:[\s\S]*?redirect\(\{ to: "\/alocacoes" \}\)/);
  assert.match(sourceDashboard, /function DashboardPage\(/);
  assert.match(sourceDashboard, /useQuery/);
});

test("Alocações e o retorno padrão do SSO continuam preservados", () => {
  assert.match(sourceAlocacoes, /createFileRoute\("\/_authenticated\/alocacoes"\)/);
  assert.match(sourceSsoCallback, /safeReturnPath/);
  assert.match(sourceSsoCallback, /const returnPath = safeReturnPath\(data\.return_path\)/);
});

test("nenhum label da sidebar fica vazio", () => {
  assert.ok(APP_NAVIGATION_ITEMS.every(({ title }) => title.trim().length > 0));
});

test("a sidebar consome uma única definição ativa de navegação", () => {
  assert.match(sourceSidebar, /APP_NAVIGATION_ITEMS\.map/);
  assert.doesNotMatch(sourceSidebar, /const items: Item\[\] = \[/);
});

test("assistente pode abrir Alocações sem guard de role local", () => {
  assert.match(sourceAuthenticated, /<AuthProvider>/);
  assert.doesNotMatch(sourceAlocacoes, /RequireRole|roleLevel|Acesso negado/);
});

test("modal e select de funcionários permanecem disponíveis", () => {
  assert.match(sourceAlocacoes, /Lançar dia trabalhado/);
  assert.match(sourceAlocacoes, /name="funcionario_id"/);
  assert.match(sourceAlocacoes, /<FuncionarioSearchSelect/);
});

test("lista grande de funcionários é normalizada sem crash", () => {
  const rows = Array.from({ length: 2500 }, (_, index) =>
    funcionario({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` }),
  );
  assert.equal(normalizarFuncionariosAlocacao(rows).validos.length, 2500);
});

test("funcionário sem categoria usa fallback e não causa crash", () => {
  const [row] = normalizarFuncionariosAlocacao([funcionario({ categoria_mo: null })]).validos;
  assert.match(rotuloFuncionarioAlocacao(row), /Sem função/);
});

test("funcionário inativo permanece representável", () => {
  const [row] = normalizarFuncionariosAlocacao([funcionario({ ativo: false })]).validos;
  assert.equal(row.ativo, false);
});

test("funcionário com desligamento produz um único rótulo estável", () => {
  const [row] = normalizarFuncionariosAlocacao([
    funcionario({ data_desligamento: "2026-08-01" }),
  ]).validos;
  assert.equal(typeof rotuloFuncionarioAlocacao(row), "string");
  assert.match(rotuloFuncionarioAlocacao(row), /desligado em 01\/08\/2026/);
});

test("linhas sem id, sem nome ou duplicadas são isoladas por contagem", () => {
  const result = normalizarFuncionariosAlocacao([
    funcionario(),
    funcionario({ id: "" }),
    funcionario({ nome: null }),
    funcionario(),
  ]);
  assert.equal(result.validos.length, 1);
  assert.equal(result.ignorados, 3);
});

test("erro da query de funcionários fica dentro do modal", () => {
  assert.match(sourceAlocacoes, /Não foi possível carregar os funcionários\./);
  assert.match(sourceAlocacoes, /funcionariosQuery\.refetch/);
});

test("erro da query de obras possui tratamento local", () => {
  assert.match(sourceAlocacoes, /Não foi possível carregar os centros de custo\./);
  assert.match(sourceAlocacoes, /obrasQuery\.refetch/);
});

test("erro mensal não desmonta o shell autenticado", () => {
  assert.match(sourceAlocacoes, /alocacoesQuery\.isError \|\| registrosQuery\.isError/);
  assert.match(sourceAuthenticated, /<RouteErrorBoundary resetKey=\{pathname\}>/);
});

test("seleção usa rótulo único e evita nós condicionais traduzíveis", () => {
  assert.match(sourceAlocacoes, /formatLabel=\{rotuloFuncionarioAlocacao\}/);
  assert.doesNotMatch(sourceAlocacoes, /f\.data_desligamento\s*\?\s*` — desligado/);
});

test("trocar rapidamente de rota reseta somente o boundary da rota", () => {
  assert.match(sourceAuthenticated, /resetKey=\{pathname\}/);
});

test("SSR declara português e bloqueia mutação automática de tradução", () => {
  assert.match(sourceRoot, /<html lang="pt-BR" translate="no">/);
  assert.match(sourceRoot, /name: "google", content: "notranslate"/);
});

test("mock de tradutor reproduz a exceção DOM observada pelo React", () => {
  const parent = {
    child: "texto-original",
    removeChild(child: string) {
      if (child !== this.child) {
        throw new DOMException(
          "The node to be removed is not a child of this node.",
          "NotFoundError",
        );
      }
    },
  };
  parent.child = "font-adicionado-pelo-tradutor";
  assert.throws(
    () => parent.removeChild("texto-original"),
    (error: unknown) =>
      error instanceof DOMException &&
      error.name === "NotFoundError" &&
      error.message === "The node to be removed is not a child of this node.",
  );
});

test("fingerprint público deriva do SHA fornecido pela Vercel", () => {
  assert.match(sourceVite, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(sourceRoot, /name: "build-sha", content: BUILD_SHA/);
  assert.match(sourceRoot, /\[Build\] \$\{BUILD_SHORT_SHA\}/);
});

test("logs de Alocações são identificados sem payloads pessoais", () => {
  const runtime = readFileSync(new URL("./alocacoes-runtime.ts", import.meta.url), "utf8");
  for (const operation of ["funcionarios", "obras", "alocacoes", "registros"]) {
    assert.match(runtime + sourceAlocacoes, new RegExp(`(?:\\[Alocacoes\\]\\[|\\")${operation}`));
  }
  assert.doesNotMatch(runtime, /console\.(?:error|warn)\([^\n]*(?:nome|payload|jwt|session)/i);
});
