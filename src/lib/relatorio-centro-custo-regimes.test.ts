import assert from "node:assert/strict";
import test from "node:test";

import { consolidarCustosCentros } from "./relatorio-centro-custo.ts";

const funcionarios = [
  {
    id: "amaro",
    nome: "AMARO TEODATO MUTEMBA",
    categoria_mo: "MONTADOR",
    data_admissao: "2026-01-01",
    data_desligamento: null,
  },
  {
    id: "brenda",
    nome: "BRENDA MICHELLE SANCHEZ SANDOVAL",
    categoria_mo: "ADMINISTRATIVO",
    data_admissao: "2026-01-01",
    data_desligamento: null,
  },
];

function consolidar() {
  return consolidarCustosCentros({
    funcionarios,
    obras: new Map([
      ["236", "236 - AEGEA ETE MOSAICO E PROURBIS"],
      ["230", "230 - OUTRO CENTRO"],
    ]),
    custos: new Map(
      funcionarios.map((funcionario) => [
        funcionario.id,
        {
          salario: 0,
          encargos: 0,
          prov13: 0,
          provAvisoPrevio: 0,
          provFerias: 0,
          beneficios: 0,
          seguroVida: 0,
          total: 0,
        },
      ]),
    ),
    alocacoes: [
      { funcionario_id: "amaro", obra_id: "236", data: "2026-08-07", tipo_mao_obra: "montagem" },
      { funcionario_id: "amaro", obra_id: "230", data: "2026-08-11", tipo_mao_obra: "montagem" },
      { funcionario_id: "brenda", obra_id: "236", data: "2026-08-07", tipo_mao_obra: "indireta" },
    ],
    registros: [
      {
        funcionario_id: "brenda",
        obra_id: "236",
        data: "2026-08-07",
        horas_normais: 9,
        horas_extras: 0,
        ausencia: false,
        tipo_registro: "horas",
      },
      {
        funcionario_id: "brenda",
        obra_id: "236",
        data: "2026-08-08",
        horas_normais: 0,
        horas_extras: 0,
        ausencia: true,
        tipo_registro: "folga_campo",
      },
    ],
    vigenciasRegime: [
      {
        funcionarioId: "amaro",
        regime: "alojado",
        vigenciaInicio: "2026-07-25",
        vigenciaFim: null,
      },
      { funcionarioId: "brenda", regime: "local", vigenciaInicio: "2026-07-25", vigenciaFim: null },
    ],
    alocacoesReferenciaRegime: [
      { funcionarioId: "amaro", obraId: "236", data: "2026-08-07" },
      { funcionarioId: "amaro", obraId: "230", data: "2026-08-11" },
      { funcionarioId: "brenda", obraId: "236", data: "2026-08-07" },
    ],
    periodoInicial: "2026-08-07",
    periodoFinal: "2026-08-11",
    diasUteis: 22,
    resolverTipo: (alocacao, funcionario) =>
      alocacao?.tipo_mao_obra === "indireta" || funcionario.id === "brenda" ? "MOI" : "MOD",
    calcularCustoBase: () => 0,
    horasNormaisPadrao: () => 9,
  });
}

test("relatorio agrega Local trabalhado e Alojado corrido por funcionario e CC", () => {
  const resultado = consolidar();
  const centro236 = resultado.centros.find((centro) => centro.id === "236")!;
  const centro230 = resultado.centros.find((centro) => centro.id === "230")!;
  const brenda = centro236.linhas.find((linha) => linha.funcionarioId === "brenda")!;
  const amaro236 = centro236.linhas.find((linha) => linha.funcionarioId === "amaro")!;
  const amaro230 = centro230.linhas.find((linha) => linha.funcionarioId === "amaro")!;
  assert.equal(brenda.regime, "Local");
  assert.equal(brenda.custoRegime, 45);
  assert.equal(amaro236.regime, "Alojado");
  assert.equal(amaro236.custoRegimeAlojado, 4 * 77);
  assert.equal(amaro230.custoRegimeAlojado, 77);
  assert.equal(centro236.custoRegimeLocal, 45);
  assert.equal(centro236.custoRegimeAlojado, 4 * 77);
  assert.equal(centro236.total, 45 + 4 * 77);
  assert.equal(centro230.total, 77);
});

test("troca de CC do Alojado ocorre somente na data da nova alocacao", () => {
  const resultado = consolidar();
  assert.equal(resultado.centros.find((centro) => centro.id === "236")!.custoRegimeAlojado, 308);
  assert.equal(resultado.centros.find((centro) => centro.id === "230")!.custoRegimeAlojado, 77);
});
