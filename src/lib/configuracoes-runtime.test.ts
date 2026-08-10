import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  beneficiosOuZero,
  combinarCategoriasSalarios,
  nomeUsuarioDisponivel,
} from "./configuracoes-runtime.ts";

const configuracoesSource = readFileSync(
  new URL("../routes/_authenticated/configuracoes.tsx", import.meta.url),
  "utf8",
);
const fechamentoSource = readFileSync(
  new URL("../components/FechamentoCompetenciaCard.tsx", import.meta.url),
  "utf8",
);
const routeBoundarySource = readFileSync(
  new URL("../components/RouteErrorBoundary.tsx", import.meta.url),
  "utf8",
);

test("categorias vazias produzem estado vazio sem exceção", () => {
  assert.deepEqual(combinarCategoriasSalarios([], []), []);
});

test("salários vazios usam zero para cada categoria", () => {
  assert.deepEqual(combinarCategoriasSalarios([{ nome: "Eletricista", tipo: "MOD" }], []), [
    { categoria: "Eletricista", salario: "0", encargos: "0", seguro_vida: "0" },
  ]);
});

test("linha parcial de salário usa zero somente nos campos ausentes", () => {
  assert.deepEqual(
    combinarCategoriasSalarios(
      [{ nome: "Supervisor", tipo: "MOI" }],
      [{ categoria: "Supervisor", salario: 5000, encargos: null, seguro_vida: 25 }],
    ),
    [{ categoria: "Supervisor", salario: "5000", encargos: "0", seguro_vida: "25" }],
  );
});

test("benefícios sem registro usam valores zero", () => {
  assert.deepEqual(beneficiosOuZero(null), {
    assistencia_medica: 0,
    assistencia_odontologica: 0,
    vale_alimentacao: 0,
    multibeneficio: 0,
  });
});

test("benefícios parciais são normalizados sem salvar automaticamente", () => {
  assert.deepEqual(beneficiosOuZero({ vale_alimentacao: 300 }), {
    assistencia_medica: 0,
    assistencia_odontologica: 0,
    vale_alimentacao: 300,
    multibeneficio: 0,
  });
});

test("profile ausente não derruba a listagem de fechamentos", () => {
  assert.equal(nomeUsuarioDisponivel(new Map(), "uuid-1"), "Usuário não disponível");
  assert.equal(nomeUsuarioDisponivel(undefined, "uuid-1"), "Usuário não disponível");
  assert.equal(nomeUsuarioDisponivel(new Map(), null), "—");
});

test("profile existente exibe o nome", () => {
  assert.equal(nomeUsuarioDisponivel(new Map([["uuid-1", "Gerente"]]), "uuid-1"), "Gerente");
});

test("erros de categorias e salários ficam no card salarial e usam refetch", () => {
  assert.match(configuracoesSource, /categoriasQuery\.isError \|\| salariosQuery\.isError/);
  assert.match(configuracoesSource, /categoriasQuery\.refetch\(\)/);
  assert.match(configuracoesSource, /salariosQuery\.refetch\(\)/);
});

test("erro de benefícios fica no card e usa refetch", () => {
  assert.match(configuracoesSource, /beneficiosQuery\.isError/);
  assert.match(configuracoesSource, /beneficiosQuery\.refetch\(\)/);
});

test("fechamentos e profiles são consultas independentes", () => {
  assert.match(fechamentoSource, /const fechamentosQuery = useQuery/);
  assert.match(fechamentoSource, /const profilesQuery = useQuery/);
  assert.match(fechamentoSource, /enabled: profileIds\.length > 0/);
});

test("erro de fechamento fica restrito ao card", () => {
  assert.match(fechamentoSource, /fechamentosQuery\.isError/);
  assert.match(fechamentoSource, /fechamentosQuery\.refetch\(\)/);
});

test("erro de profiles preserva fechamentos e permite retry próprio", () => {
  assert.match(fechamentoSource, /profilesQuery\.isError/);
  assert.match(fechamentoSource, /profilesQuery\.refetch\(\)/);
  assert.match(fechamentoSource, /Os fechamentos continuam disponíveis/);
});

test("queries possuem identificação segura de diagnóstico", () => {
  for (const operation of [
    "categorias",
    "categoria_salarios",
    "beneficios_config",
    "fechamentos_competencia",
    "users_profiles",
  ]) {
    assert.match(
      configuracoesSource + fechamentoSource,
      new RegExp(`(?:configContext|logConfigQueryError\\(\\"${operation}\\")`),
    );
  }
});

test("RouteErrorBoundary continua reservado a erros inesperados de renderização", () => {
  assert.match(routeBoundarySource, /getDerivedStateFromError/);
  assert.match(routeBoundarySource, /componentDidCatch/);
});

test("matriz de acesso de Configurações não foi ampliada", () => {
  assert.match(
    configuracoesSource,
    /allowed=\{\["supervisor", "coordenador", "gerente", "diretor"\]\}/,
  );
});
