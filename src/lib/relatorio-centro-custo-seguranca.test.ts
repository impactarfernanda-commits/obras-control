import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calcularCusto, custoDoDia, diasUteisNoIntervalo } from "./custos-core.ts";
import { consolidarCustosCentros } from "./relatorio-centro-custo.ts";

test("mantem paridade das formulas financeiras compartilhadas", () => {
  const custo = calcularCusto(
    3000,
    {
      assistencia_medica: 100,
      assistencia_odontologica: 20,
      vale_alimentacao: 400,
      multibeneficio: 80,
    },
    15,
  );
  assert.equal(custo.total, 5859);
  const dias = diasUteisNoIntervalo(new Date(2026, 6, 25), new Date(2026, 7, 24));
  const resultado = consolidarCustosCentros({
    alocacoes: [
      { funcionario_id: "f1", obra_id: "o1", data: "2026-08-03", tipo_mao_obra: "montagem" },
    ],
    registros: [
      {
        funcionario_id: "f1",
        obra_id: "o1",
        data: "2026-08-03",
        horas_normais: 9,
        horas_extras: 0,
        ausencia: false,
      },
    ],
    funcionarios: [{ id: "f1", nome: "Pessoa", categoria_mo: "Soldador" }],
    custos: new Map([["f1", custo]]),
    obras: new Map([["o1", "Obra"]]),
    diasUteis: dias,
    resolverTipo: () => "MOD",
    calcularCustoBase: (input) => custoDoDia({ ...input, horasExtras: 0 }),
    horasNormaisPadrao: () => 9,
  });
  assert.equal(resultado.centros[0].total, custo.total / dias);
});

test("coordenador usa somente a server function e consultas financeiras ficam desabilitadas", () => {
  const route = readFileSync(
    new URL("../routes/_authenticated/relatorios.tsx", import.meta.url),
    "utf8",
  );
  assert.match(route, /allowed=\{\["coordenador", "gerente", "diretor"\]\}/);
  assert.match(route, /const podeVerFolha = role === "gerente" \|\| role === "diretor"/);
  assert.match(route, /useBeneficios\(\{ enabled: podeVerFolha \}\)/);
  assert.match(route, /getRelatorioCentrosCusto/);
  assert.match(route, /enabled: podeVerFolha/g);
});

test("DTO publico nao declara campos de folha", () => {
  const source = readFileSync(
    new URL("./relatorio-centro-custo.functions.ts", import.meta.url),
    "utf8",
  );
  const dto =
    source.match(/export type RelatorioCentrosCustoDTO = \{([^;]+;){4}[^}]*\}/s)?.[0] ?? "";
  for (const proibido of ["salario", "beneficios", "seguroVida", "encargos", "prov13"])
    assert.doesNotMatch(dto, new RegExp(proibido, "i"));
  assert.match(source, /role === "coordenador" \|\| role === "gerente" \|\| role === "diretor"/);
});
