import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calcularPendenciasSemAlocacao,
  dataLimitePendencias,
  filtrarDatasPendentes,
  ultimasAlocacoesPorFuncionario,
  datasUteisNoIntervalo,
  diaUtilAnterior,
} from "./relatorio-sem-alocacao.ts";

const servidor = readFileSync("src/lib/relatorio-sem-alocacao.functions.ts", "utf8");
const tela = readFileSync("src/routes/_authenticated/relatorios.tsx", "utf8");
const navegacao = readFileSync("src/lib/navigation.ts", "utf8");
const financeiro = readFileSync("src/lib/relatorio-centro-custo.functions.ts", "utf8");

test("dias úteis excluem 07/09 ativo, mas preservam segunda comum e feriado não informado", () => {
  const feriados = new Set(["2026-09-07"]);
  assert.deepEqual(datasUteisNoIntervalo("2026-09-04", "2026-09-08", feriados), [
    "2026-09-04",
    "2026-09-08",
  ]);
  assert.deepEqual(datasUteisNoIntervalo("2026-09-14", "2026-09-14", feriados), ["2026-09-14"]);
  assert.deepEqual(datasUteisNoIntervalo("2026-09-07", "2026-09-07"), ["2026-09-07"]);
  assert.deepEqual(datasUteisNoIntervalo("2026-09-07", "2026-09-07", new Set()), ["2026-09-07"]);
});

test("pendências diminuem na coleção de dias disponíveis sem filtrar só a apresentação", () => {
  const alocadas = new Set(["2026-09-08"]);
  const semFeriados = datasUteisNoIntervalo("2026-09-04", "2026-09-09").filter(
    (data) => !alocadas.has(data),
  );
  const datasSemAlocacao = datasUteisNoIntervalo(
    "2026-09-04",
    "2026-09-09",
    new Set(["2026-09-07"]),
  ).filter((data) => !alocadas.has(data));
  assert.equal(datasSemAlocacao.length, semFeriados.length - 1);
  assert.deepEqual(datasSemAlocacao, ["2026-09-04", "2026-09-09"]);
  assert.match(tela, /calcularPendenciasSemAlocacao/);
  assert.match(tela, /semAlocacao\.map/);
});

test("dia útil anterior ao desligamento pula feriado e fim de semana", () => {
  assert.equal(diaUtilAnterior("2026-09-08", new Set(["2026-09-07"])), "2026-09-04");
  assert.equal(diaUtilAnterior("2026-09-08"), "2026-09-07");
  assert.equal(diaUtilAnterior("2026-09-09", new Set(["2026-09-07", "2026-09-08"])), "2026-09-04");
});

test("helper canônico respeita cobertura, feriado, fim de semana, admissão e desligamento", () => {
  const [funcionario] = calcularPendenciasSemAlocacao({
    funcionarios: [
      {
        id: "f1",
        categoria_mo: "Montador",
        data_admissao: "2026-09-04",
        data_desligamento: "2026-09-10",
      },
    ],
    coberturas: [
      { funcionario_id: "f1", data: "2026-09-04", tipo: "alocacao" },
      { funcionario_id: "f1", data: "2026-09-08", tipo: "ferias" },
    ],
    feriados: new Set(["2026-09-07"]),
    inicioCompetencia: "2026-08-25",
    fimCompetencia: "2026-09-24",
    dataLimiteAnalise: "2026-09-12",
  });

  assert.deepEqual(funcionario.datasSemAlocacao, ["2026-09-09"]);
  assert.equal(funcionario.diasDisponiveis, 3);
  assert.equal(funcionario.diasComAlocacao, 1);
  assert.equal(funcionario.diasCobertos, 2);
  assert.equal(funcionario.admitidoNoPeriodo, true);
  assert.equal(funcionario.desligadoNoPeriodo, true);
});

test("helper canônico diferencia Para tratar de ontem e hoje sem depender de filtro visual", () => {
  const funcionarios = [
    {
      id: "f1",
      categoria_mo: "Montador",
      data_admissao: null,
      data_desligamento: null,
    },
  ];
  const base = {
    funcionarios,
    coberturas: [{ funcionario_id: "f1", data: "2026-09-01", tipo: "alocacao" as const }],
    feriados: new Set<string>(),
    inicioCompetencia: "2026-09-01",
    fimCompetencia: "2026-09-30",
  };
  const paraTratar = calcularPendenciasSemAlocacao({
    ...base,
    dataLimiteAnalise: dataLimitePendencias("2026-09-04", base.fimCompetencia, "para-tratar"),
  })[0];
  const todas = calcularPendenciasSemAlocacao({
    ...base,
    dataLimiteAnalise: dataLimitePendencias("2026-09-04", base.fimCompetencia, "todas"),
  })[0];

  assert.deepEqual(paraTratar.datasSemAlocacao, ["2026-09-02"]);
  assert.deepEqual(todas.datasSemAlocacao, ["2026-09-02", "2026-09-03"]);
  assert.equal(paraTratar.datasSemAlocacao.includes("2026-09-04"), false);
});

test("cobertura tipada deduplica o dia e inclui apenas ausências autorizadas", () => {
  const [funcionario] = calcularPendenciasSemAlocacao({
    funcionarios: [
      { id: "f1", categoria_mo: "Montador", data_admissao: null, data_desligamento: null },
    ],
    coberturas: [
      { funcionario_id: "f1", data: "2026-09-01", tipo: "alocacao" },
      { funcionario_id: "f1", data: "2026-09-01", tipo: "atestado" },
      { funcionario_id: "f1", data: "2026-09-02", tipo: "afastamento" },
    ],
    feriados: new Set(),
    inicioCompetencia: "2026-09-01",
    fimCompetencia: "2026-09-03",
    dataLimiteAnalise: "2026-09-03",
  });
  assert.equal(funcionario.diasCobertos, 2);
  assert.equal(funcionario.diasComAlocacao, 1);
  assert.equal(Number(funcionario.coberturaPercentual.toFixed(2)), 66.67);
  assert.deepEqual(
    new Set(funcionario.tiposCobertura),
    new Set(["alocacao", "atestado", "afastamento"]),
  );
  assert.deepEqual(funcionario.datasSemAlocacao, ["2026-09-03"]);
});

test("servidor inclui atestado e afastamento explícitos e exclui demais faltas", () => {
  assert.match(
    servidor,
    /\.eq\("tipo_registro", "falta"\)[\s\S]*\.in\("falta_tipo", \["atestado", "afastamento"\]\)/,
  );
  for (const tipo of ["nao_justificada", "suspensao", "outro", "justificada"])
    assert.doesNotMatch(servidor, new RegExp(`falta_tipo\\.in\\.\\([^)]*${tipo}`));
});

test("servidor retorna somente feriados ativos do intervalo analisado", () => {
  assert.match(
    servidor,
    /\.from\("feriados_obras_control"\)\s+\.select\("data"\)\s+\.eq\("ativo", true\)\s+\.gte\("data", data.inicio\)\s+\.lte\("data", data.referencia\)/,
  );
  assert.match(servidor, /feriados: feriados.map/);
  assert.match(tela, /new Set\(relatorioSemAlocacao\?\.feriados \?\? \[\]\)/);
});

test("Para tratar exclui ontem e inclui anteontem", () => {
  assert.equal(dataLimitePendencias("2026-09-04", "2026-09-24", "para-tratar"), "2026-09-02");
  assert.deepEqual(
    filtrarDatasPendentes(["2026-09-02", "2026-09-03"], "2026-09-04", "para-tratar"),
    ["2026-09-02"],
  );
});

test("funcionário com pendência antiga e ontem permanece somente com a antiga", () => {
  const pendenciasDoFuncionario = ["2026-08-28", "2026-09-03"];
  assert.deepEqual(filtrarDatasPendentes(pendenciasDoFuncionario, "2026-09-04", "para-tratar"), [
    "2026-08-28",
  ]);
});

test("Todas mantém o corte anterior e inclui ontem", () => {
  assert.equal(dataLimitePendencias("2026-09-04", "2026-09-24", "todas"), "2026-09-03");
  assert.deepEqual(filtrarDatasPendentes(["2026-09-02", "2026-09-03"], "2026-09-04", "todas"), [
    "2026-09-02",
    "2026-09-03",
  ]);
});

test("contador e Excel usam a coleção filtrada pela visão", () => {
  assert.match(tela, /dataLimitePendencias\(hojeISO, end, visaoPendencias\)/);
  assert.match(tela, /semAlocacao\.length} pendência\(s\)/);
  const exportacao = tela.match(/function exportarSemAlocacao\(\) \{([\s\S]*?)\n {2}\}/)?.[1] ?? "";
  assert.match(exportacao, /semAlocacao\.map/);
  assert.match(exportacao, /dataLimiteAnalise/);
});

test("último CC usa a alocação válida mais recente até a data de referência", () => {
  const ultimas = ultimasAlocacoesPorFuncionario(
    [
      { funcionario_id: "f1", obra_id: "cc-antigo", data: "2026-08-01" },
      { funcionario_id: "f1", obra_id: "cc-atual", data: "2026-08-10" },
      { funcionario_id: "f1", obra_id: "cc-futuro", data: "2026-08-12" },
      { funcionario_id: "f2", obra_id: "cc-2", data: "2026-07-20" },
    ],
    "2026-08-11",
  );
  assert.deepEqual(ultimas.get("f1"), {
    funcionario_id: "f1",
    obra_id: "cc-atual",
    data: "2026-08-10",
  });
  assert.equal(ultimas.get("f2")?.data, "2026-07-20");
  assert.equal(ultimas.has("f3"), false);
});

test("servidor usa consultas existentes e limita o histórico à referência", () => {
  assert.match(servidor, /\.from\("alocacoes"\)[\s\S]*\.lte\("data", data\.referencia\)/);
  assert.match(servidor, /\.from\("obras"\)/);
  assert.match(servidor, /ultimasAlocacoesPorFuncionario/);
  assert.doesNotMatch(servidor, /responsavel/i);
});

test("tela e Excel exibem e filtram os novos campos sem renomear a semântica", () => {
  for (const label of [
    "Último CC",
    "Última alocação",
    "Dias sem alocação",
    "Último Centro de Custo",
  ])
    assert.match(tela, new RegExp(label));
  assert.match(tela, /ultimoCcFilter/);
  assert.match(tela, /referencia: end/);
  assert.match(tela, /calcularPendenciasAte\(dataLimiteAnalise\)/);
  assert.match(tela, /Sem CC anterior/);
  assert.doesNotMatch(tela, /Responsável pelo CC/);
});

test("todas as roles internas acessam o relatorio operacional", () => {
  for (const role of ["assistente", "supervisor", "coordenador", "gerente", "diretor"]) {
    assert.match(servidor, new RegExp(`role === "${role}"`));
    assert.match(navegacao, new RegExp(`"${role}"`));
  }
  assert.match(tela, /useState<AbaRelatorios>\(\(\) => abaInicialRelatorios\(role\)\)/);
  assert.match(tela, /value=\{abaAtiva\}/);
  assert.match(tela, /onValueChange=\{\(value\) => setAbaAtiva\(value as AbaRelatorios\)\}/);
  for (const roleExterna of ["cliente", "externo", "visualizador"])
    assert.doesNotMatch(servidor, new RegExp(`role === "${roleExterna}"`));
});

test("matriz preserva centro de custo do coordenador sem liberar folha individual", () => {
  assert.match(financeiro, /ROLES_CENTRO_CUSTO = \["coordenador", "gerente", "diretor"\]/);
  assert.match(financeiro, /ROLES_FINANCEIRO_COMPLETO = \["gerente", "diretor"\]/);
  assert.match(tela, /const podeVerFolha = role === "gerente" \|\| role === "diretor"/);
  assert.match(tela, /const podeVerCentroCusto = role === "coordenador" \|\| podeVerFolha/);
  assert.match(
    tela,
    /\{podeVerFolha && <TabsTrigger value="funcionarios">Custo por funcionário<\/TabsTrigger>\}/,
  );
  assert.match(
    tela,
    /\{podeVerCentroCusto && <TabsTrigger value="obras">Custo por centro de custo<\/TabsTrigger>\}/,
  );
  assert.match(
    tela,
    /queryFn: \(\) => getRelatorioCentrosCusto[\s\S]*?enabled: consultasAtivas\.centros/,
  );
  for (const role of ["assistente", "supervisor", "cliente", "externo"])
    assert.doesNotMatch(financeiro, new RegExp(`ROLES_[A-Z_]+ = \\[.*"${role}"`));
});

test("Excel Sem alocacao contem somente campos operacionais", () => {
  const exportacao = tela.match(/function exportarSemAlocacao\(\) \{([\s\S]*?)\n {2}\}/)?.[1] ?? "";
  for (const campo of [
    "Funcionário",
    "Função/Categoria",
    "Último CC",
    "Dias sem alocação",
    "Observação",
  ])
    assert.match(exportacao, new RegExp(campo));
  for (const proibido of ["salário", "custo-base", "refeição", "HE 50%", "custo total"])
    assert.doesNotMatch(exportacao, new RegExp(proibido, "i"));
});

test("remove controles legados de apontamentos e preserva relatorios", () => {
  assert.doesNotMatch(tela, /Exportar apontamentos|exportarApontamentos|apontamentos-\$\{start\}/);
  assert.doesNotMatch(tela, /tipoRegistroFilter|Todos os apontamentos|falta\(s\) no período/);
  assert.match(tela, /<TabsTrigger value="funcionarios">Custo por funcionário<\/TabsTrigger>/);
  assert.match(tela, /<TabsTrigger value="obras">Custo por centro de custo<\/TabsTrigger>/);
  assert.match(tela, /<TabsTrigger value="sem-alocacao">Sem alocação<\/TabsTrigger>/);
  assert.match(tela, /function exportarSemAlocacao\(\)/);
  assert.match(tela, /function exportarCentroDetalhe\(\)/);
  assert.match(tela, /aria-label="Mês anterior"/);
  assert.match(tela, /aria-label="Próximo mês"/);
});
