import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const raiz = new URL("../../", import.meta.url);
const migration = readFileSync(
  new URL("supabase/migrations/20261013120000_relatorio_alocacao_centro_custo.sql", raiz),
  "utf8",
);
const tela = readFileSync(new URL("src/routes/_authenticated/relatorios.tsx", raiz), "utf8");
const componente = readFileSync(
  new URL("src/components/RelatorioAlocacaoCentroCusto.tsx", raiz),
  "utf8",
);
test("RPC reutiliza competência, alocação diária e não expõe dados privados", () => {
  assert.match(migration, /public\.competencia_25_24\(p_competencia\)/);
  assert.match(
    migration,
    /LEFT JOIN public\.alocacoes a ON a\.funcionario_id = d\.funcionario_id AND a\.data = d\.data/,
  );
  assert.match(migration, /count\(DISTINCT de\.data\)/i);
  for (const privado of ["salario", "encargos", "cpf", "pix", "endereco"])
    assert.doesNotMatch(
      migration.match(/RETURNS TABLE \([\s\S]*?\)\nLANGUAGE/)?.[0] ?? "",
      new RegExp(privado, "i"),
    );
});

test("RPC protege autenticação, roles, search_path e grants", () => {
  assert.match(migration, /auth\.uid\(\)/);
  for (const role of ["assistente", "supervisor", "coordenador", "gerente", "diretor"])
    assert.match(migration, new RegExp(`'${role}'`));
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO ''/);
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test("fonte diária preserva detalhe, fallback, ausências e inconsistências", () => {
  for (const termo of [
    "registros_horas_detalhes",
    "ALOCACAO_SEM_REGISTRO_HORAS",
    "HORAS_SEM_ALOCACAO",
    "VINCULO_DETALHE_DIVERGENTE",
    "HORAS_LEGADAS_SEM_DETALHE",
    "sem_alocacao",
  ])
    assert.match(migration, new RegExp(termo));
  assert.match(
    migration,
    /CASE WHEN coalesce\(rd\.possui_ausencia, false\) THEN NULL ELSE a\.obra_id END/,
  );
  assert.match(
    migration,
    /LEFT JOIN public\.alocacoes a_detalhe ON a_detalhe\.id = rd\.alocacao_id/,
  );
  assert.match(
    migration,
    /LEFT JOIN public\.alocacoes a_dia[\s\S]*?rd\.alocacao_id IS NULL[\s\S]*?a_dia\.funcionario_id = rh\.funcionario_id[\s\S]*?a_dia\.data = rh\.data/,
  );
  assert.match(migration, /coalesce\(a_detalhe\.id, a_dia\.id\) IS NULL/);
  assert.match(migration, /OBRA_DIVERGENTE/);
});

test("RETURN QUERY qualifica colunas que colidem com variáveis de RETURNS TABLE", () => {
  const returnQuery = migration.match(/RETURN QUERY([\s\S]*?)\nEND;\n\$function\$/)?.[1] ?? "";
  const colunasRetorno =
    migration
      .match(/RETURNS TABLE \(([\s\S]*?)\)\nLANGUAGE/)?.[1]
      ?.split(",")
      .map((declaracao) => declaracao.trim().split(/\s+/)[0]) ?? [];

  assert.ok(returnQuery.length > 0);
  assert.equal(colunasRetorno.length, 27);
  assert.doesNotMatch(returnQuery, /SELECT\s+funcionario_id\s*,\s*data\s+FROM\s+dias_esperados/i);
  assert.doesNotMatch(returnQuery, /SELECT\s+funcionario_id\s*,\s*data\s+FROM\s+dias_movimento/i);
  assert.match(returnQuery, /SELECT de\.funcionario_id, de\.data FROM dias_esperados de/);
  assert.match(returnQuery, /SELECT dm\.funcionario_id, dm\.data FROM dias_movimento dm/);

  for (const coluna of colunasRetorno) {
    const referenciaSimples = new RegExp(
      `(?:SELECT|WHERE|JOIN|ON|GROUP\\s+BY|ORDER\\s+BY)\\s+${coluna}\\b`,
      "i",
    );
    assert.doesNotMatch(returnQuery, referenciaSimples, `referência sem alias: ${coluna}`);
  }
});

test("aba está na ordem pedida e oferece filtros, detalhe e estados", () => {
  const gatilhos =
    tela.match(
      /<TabsTrigger[\s\S]*?<TabsTrigger value="sem-alocacao">Sem alocação<\/TabsTrigger>/,
    )?.[0] ?? "";
  assert.ok(
    gatilhos.indexOf("Custo por funcionário") < gatilhos.indexOf("Custo por centro de custo"),
  );
  assert.ok(
    gatilhos.indexOf("Custo por centro de custo") <
      gatilhos.indexOf("Alocação por Centro de Custo"),
  );
  assert.ok(gatilhos.indexOf("Alocação por Centro de Custo") < gatilhos.indexOf("Sem alocação"));
  for (const texto of [
    "Buscar funcionário",
    "Todos os centros",
    "Todas as categorias",
    "Somente com pendência",
    "Skeleton",
    "Não há alocações ou registros",
    "Detalhamento diário",
  ])
    assert.match(componente, new RegExp(texto));
});
