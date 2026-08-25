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

function consolidarAjudante(input: {
  referencias: Array<{
    funcionario_id: string;
    obra_id: string;
    data: string;
    tipo_mao_obra: "civil" | "montagem";
    especialidade_ajudante: "civil" | "montagem" | null;
  }>;
  inicio?: string;
  fim?: string;
  regime?: "local" | "alojado";
  registros?: Array<{
    funcionario_id: string;
    obra_id: string;
    data: string;
    horas_normais: number;
    horas_extras: number;
    ausencia: boolean;
    tipo_registro: "horas";
  }>;
}) {
  const inicio = input.inicio ?? "2026-08-01";
  const fim = input.fim ?? "2026-08-03";
  const funcionario = {
    id: "tiago",
    nome: "TIAGO DA ROCHA DUARTE",
    categoria_mo: "AJUDANTE",
    data_admissao: "2026-01-01",
    data_desligamento: null,
  };
  return consolidarCustosCentros({
    funcionarios: [funcionario],
    obras: new Map([["236", "OBRA"]]),
    custos: new Map([
      [
        funcionario.id,
        {
          salario: 0,
          encargos: 0,
          prov13: 0,
          provAvisoPrevio: 0,
          provFerias: 0,
          beneficios: 0,
          seguroVida: 0,
          total: 1,
        },
      ],
    ]),
    alocacoes: input.referencias.filter((item) => item.data >= inicio && item.data <= fim),
    alocacoesReferenciaClassificacao: input.referencias,
    alocacoesReferenciaRegime: input.referencias.map((item) => ({
      funcionarioId: item.funcionario_id,
      obraId: item.obra_id,
      data: item.data,
    })),
    registros: input.registros ?? [],
    vigenciasRegime: [
      {
        funcionarioId: funcionario.id,
        regime: input.regime ?? "alojado",
        vigenciaInicio: "2026-07-25",
        vigenciaFim: null,
      },
    ],
    periodoInicial: inicio,
    periodoFinal: fim,
    diasUteis: 22,
    resolverTipo: (alocacao) => (alocacao?.tipo_mao_obra === "indireta" ? "MOI" : "MOD"),
    calcularCustoBase: () => 0,
    horasNormaisPadrao: () => 0,
  });
}

test("Alojado AJUDANTE propaga Montagem nos dias sem jornada sem criar outra linha", () => {
  const datasTrabalhadas = Array.from(
    { length: 16 },
    (_, indice) => `2026-08-${String(indice + 1).padStart(2, "0")}`,
  );
  const resultado = consolidarAjudante({
    inicio: "2026-08-01",
    fim: "2026-08-31",
    referencias: datasTrabalhadas.map((data) => ({
      funcionario_id: "tiago",
      obra_id: "236",
      data,
      tipo_mao_obra: "montagem" as const,
      especialidade_ajudante: "montagem" as const,
    })),
    registros: datasTrabalhadas.map((data, indice) => ({
      funcionario_id: "tiago",
      obra_id: "236",
      data,
      horas_normais: indice === 15 ? 6 : 9,
      horas_extras: 0,
      ausencia: false,
      tipo_registro: "horas" as const,
    })),
  });
  const linhas = resultado.centros[0].linhas;
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].tipoMod, "Montagem");
  assert.equal(linhas[0].dias, 16);
  assert.equal(linhas[0].horasNormais + linhas[0].horas50 + linhas[0].horas100, 141);
  assert.equal(linhas[0].custoRegimeAlojado, 31 * 77);
});

test("mudanca Montagem para Civil tambem vale somente na data registrada", () => {
  const resultado = consolidarAjudante({
    inicio: "2026-08-01",
    fim: "2026-08-04",
    referencias: [
      {
        funcionario_id: "tiago",
        obra_id: "236",
        data: "2026-07-31",
        tipo_mao_obra: "montagem",
        especialidade_ajudante: "montagem",
      },
      {
        funcionario_id: "tiago",
        obra_id: "236",
        data: "2026-08-03",
        tipo_mao_obra: "civil",
        especialidade_ajudante: "civil",
      },
    ],
  });
  const linhas = resultado.centros[0].linhas;
  assert.equal(linhas.find((linha) => linha.tipoMod === "Montagem")?.custoRegimeAlojado, 2 * 77);
  assert.equal(linhas.find((linha) => linha.tipoMod === "Civil")?.custoRegimeAlojado, 2 * 77);
});

test("Alojado respeita mudancas Civil e Montagem somente a partir da data registrada", () => {
  const referencias = [
    {
      funcionario_id: "tiago",
      obra_id: "236",
      data: "2026-07-31",
      tipo_mao_obra: "civil" as const,
      especialidade_ajudante: "civil" as const,
    },
    {
      funcionario_id: "tiago",
      obra_id: "236",
      data: "2026-08-03",
      tipo_mao_obra: "montagem" as const,
      especialidade_ajudante: "montagem" as const,
    },
  ];
  const resultado = consolidarAjudante({ referencias, inicio: "2026-08-01", fim: "2026-08-04" });
  const linhas = resultado.centros[0].linhas;
  assert.equal(linhas.find((linha) => linha.tipoMod === "Civil")?.custoRegimeAlojado, 2 * 77);
  assert.equal(linhas.find((linha) => linha.tipoMod === "Montagem")?.custoRegimeAlojado, 2 * 77);
  assert.equal(
    linhas.reduce((total, linha) => total + linha.dias, 0),
    0,
  );
  assert.equal(
    linhas.reduce((total, linha) => total + linha.horasNormais, 0),
    0,
  );
});

test("sem classificacao valida anterior Alojado permanece A classificar", () => {
  const resultado = consolidarAjudante({
    referencias: [
      {
        funcionario_id: "tiago",
        obra_id: "236",
        data: "2026-08-01",
        tipo_mao_obra: "civil",
        especialidade_ajudante: null,
      },
    ],
  });
  assert.equal(resultado.centros[0].linhas[0].tipoMod, "A classificar");
  assert.equal(resultado.centros[0].linhas[0].custoRegimeAlojado, 3 * 77);
});

test("Local sem jornada nao gera refeicao", () => {
  const resultado = consolidarAjudante({
    regime: "local",
    referencias: [
      {
        funcionario_id: "tiago",
        obra_id: "236",
        data: "2026-08-01",
        tipo_mao_obra: "civil",
        especialidade_ajudante: "civil",
      },
    ],
  });
  assert.equal(resultado.centros.length, 0);
});
