import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  agruparResponsaveis,
  codigoCcResponsaveis,
  consolidarDesdobramentosResponsaveis,
  excluirCadastroResponsavel,
  filtrarObrasResponsaveis,
  montarHierarquiaResponsaveis,
  obrasExibidasResponsaveis,
  pessoasSemelhantes,
  podeGerenciarResponsaveis,
  resumirVinculosLote,
  selecionarCcsColados,
  vincularResponsavelEmLote,
  type ResponsavelObraRow,
} from "./responsaveis-obras.ts";

const base: ResponsavelObraRow = {
  obra_id: "obra-1",
  obra_nome: "CC 230 - Iguá ETE Sul",
  obra_status: "Em andamento",
  obra_cargo_id: "oc-1",
  cargo_id: "cargo-1",
  cargo_nome: "Supervisor",
  cargo_ordem: 50,
  vinculo_id: null,
  pessoa_id: null,
  pessoa_nome: null,
  pessoa_tipo: null,
  funcionario_id: null,
  total_obras_pessoa: 0,
  compartilhado: false,
};

test("lote reconhece códigos exatos, marca encontrados e informa ausentes", () => {
  const obras = agruparResponsaveis([
    { ...base, obra_id: "a", obra_nome: "150 - Obra A", obra_cargo_id: null },
    { ...base, obra_id: "b", obra_nome: "173 - Obra B", obra_cargo_id: null },
  ]);
  assert.equal(codigoCcResponsaveis("150 - Obra A"), "150");
  assert.equal(codigoCcResponsaveis("CC 230 - Obra C"), "230");
  assert.deepEqual(selecionarCcsColados(obras, "150, 173; 150\n999"), {
    ids: ["a", "b"],
    naoEncontrados: ["999"],
  });
  assert.deepEqual(resumirVinculosLote(["a", "b"], new Set(["a"])), {
    novos: 1,
    existentes: 1,
  });
});

test("visão e lote consolidam desdobramentos somente quando o principal está disponível", () => {
  const registro = (id: string, status = "Em andamento"): ResponsavelObraRow => ({
    ...base,
    obra_id: id,
    obra_nome: `${id} - Obra ${id}`,
    obra_status: status,
    obra_cargo_id: null,
  });
  const obras = agruparResponsaveis([
    registro("237"),
    registro("237.1"),
    registro("237.3"),
    registro("236"),
    registro("236.1"),
    registro("236.2"),
    registro("300.1"),
    registro("400"),
    registro("500", "Concluída"),
    registro("500.1"),
  ]);
  const ids = (lista: readonly { id: string }[]) => lista.map((obra) => obra.id);
  assert.deepEqual(ids(consolidarDesdobramentosResponsaveis(obras)), [
    "236",
    "237",
    "300.1",
    "400",
    "500", // ordenação lexical do agrupamento
  ]);
  const padrao = obrasExibidasResponsaveis(obras);
  assert.deepEqual(ids(padrao), ["236", "237", "300.1", "400", "500.1"]);
  assert.deepEqual(ids(obrasExibidasResponsaveis(obras, true)), [
    "236",
    "237",
    "300.1",
    "400",
    "500",
  ]);
  assert.deepEqual(ids(montarHierarquiaResponsaveis(obras, "").semGestor), ids(padrao));
  assert.deepEqual(ids(montarHierarquiaResponsaveis(obras, "237.3").semGestor), []);
  assert.deepEqual(selecionarCcsColados(padrao, "237, 237.3, 300.1"), {
    ids: ["237", "300.1"],
    naoEncontrados: ["237.3"],
  });
  const tela = readFileSync("src/routes/_authenticated/responsaveis-obras.tsx", "utf8");
  assert.match(tela, /obrasExibidasResponsaveis\(obras, mostrarFinalizadas\)/);
  assert.match(tela, /selecionarCcsColados\(obrasElegiveis, loteCodigos\)/);
});

test("consolidação vale nos cards de gerência e coordenação", () => {
  const vinculo = (id: string, cargo: string, pessoa: string): ResponsavelObraRow => ({
    ...base,
    obra_id: id,
    obra_nome: `${id} - Obra ${id}`,
    obra_cargo_id: `${id}-${cargo}`,
    cargo_nome: cargo,
    vinculo_id: `${id}-${pessoa}`,
    pessoa_id: pessoa,
    pessoa_nome: pessoa,
  });
  const visao = montarHierarquiaResponsaveis(
    agruparResponsaveis([
      vinculo("237", "Gerente de Obras", "Gerente"),
      vinculo("237.1", "Gerente de Obras", "Gerente"),
      vinculo("236", "Coordenador", "Coordenador"),
      vinculo("236.2", "Coordenador", "Coordenador"),
    ]),
    "",
  );
  assert.deepEqual(
    visao.gerentes[0].obras.map((obra) => obra.id),
    ["237"],
  );
  assert.deepEqual(
    visao.coordenadoresDiretos[0].obras.map((obra) => obra.id),
    ["236"],
  );
});

test("lote preserva vínculos existentes, deduplica CC e reporta falhas sem interromper", async () => {
  const chamadas: string[] = [];
  const resultado = await vincularResponsavelEmLote("diretor", ["a", "a", "b", "c"], async (id) => {
    chamadas.push(id);
    if (id === "b") return "existente";
    if (id === "c") throw new Error("Falha de RLS");
    return "criado";
  });
  assert.deepEqual(chamadas, ["a", "b", "c"]);
  assert.deepEqual(resultado, {
    criados: 1,
    existentes: 1,
    falhas: [{ obraId: "c", erro: "Falha de RLS" }],
  });
  await assert.rejects(
    () => vincularResponsavelEmLote("assistente", ["a"], async () => "criado"),
    /Sem permissão/,
  );
});

test("hierarquia usa vínculos por identidade, separa gerentes e coordenadores diretos", () => {
  const vinculo = (
    obra: string,
    cargo: string,
    pessoa: string,
    id: string,
  ): ResponsavelObraRow => ({
    ...base,
    obra_id: obra,
    obra_nome: `CC ${obra}`,
    obra_cargo_id: `${obra}-${cargo}`,
    cargo_id: cargo,
    cargo_nome: cargo,
    vinculo_id: `${obra}-${cargo}-${id}`,
    pessoa_id: id,
    pessoa_nome: pessoa,
  });
  const obras = agruparResponsaveis([
    vinculo("150", "Diretor de Obras", "Sue", "d"),
    vinculo("150", "Gerente de Obras", "Higor", "g"),
    vinculo("150", "Coordenador", "Marcelo", "c"),
    vinculo("230", "Gerente de Obras", "Higor", "g"),
    vinculo("247", "Coordenador", "Marcelo", "c"),
    { ...base, obra_id: "250", obra_nome: "CC 250", obra_cargo_id: null },
  ]);
  const visao = montarHierarquiaResponsaveis(obras, "");
  assert.deepEqual(
    visao.diretores.map((p) => p.nome),
    ["Sue"],
  );
  assert.deepEqual(
    visao.gerentes[0].obras.map((o) => o.id),
    ["150", "230"],
  );
  assert.deepEqual(
    visao.coordenadoresDiretos[0].obras.map((o) => o.id),
    ["247"],
  );
  assert.deepEqual(
    visao.semGestor.map((o) => o.id),
    ["250"],
  );
  assert.deepEqual(
    montarHierarquiaResponsaveis(obras, "230").gerentes[0].obras.map((o) => o.id),
    ["230"],
  );
  assert.deepEqual(
    montarHierarquiaResponsaveis(obras, "Higor").gerentes[0].obras.map((o) => o.id),
    ["150", "230"],
  );
  assert.deepEqual(
    montarHierarquiaResponsaveis(obras, "Marcelo").coordenadoresDiretos[0].obras.map((o) => o.id),
    ["247"],
  );
});

test("hierarquia respeita Concluída e promove coordenador quando gerente deixa de estar definido", () => {
  const rows: ResponsavelObraRow[] = [
    {
      ...base,
      obra_id: "1",
      obra_nome: "CC 1",
      obra_status: "Concluída",
      cargo_nome: "Gerente de Obras",
      vinculo_id: "v1",
      pessoa_id: "g",
      pessoa_nome: "Gerente",
    },
    { ...base, obra_id: "2", obra_nome: "CC 2", cargo_nome: "Gerente de Obras" },
    {
      ...base,
      obra_id: "2",
      obra_nome: "CC 2",
      obra_cargo_id: "oc-2",
      cargo_nome: "Coordenador",
      vinculo_id: "v2",
      pessoa_id: "c",
      pessoa_nome: "Coordenador",
    },
  ];
  const obras = agruparResponsaveis(rows);
  assert.equal(montarHierarquiaResponsaveis(obras, "").gerentes.length, 0);
  assert.equal(montarHierarquiaResponsaveis(obras, "").coordenadoresDiretos[0].obras[0].id, "2");
  assert.equal(montarHierarquiaResponsaveis(obras, "", true).gerentes[0].obras[0].id, "1");
  assert.equal(montarHierarquiaResponsaveis(obras, "1").gerentes.length, 0);
});

test("oculta apenas Concluída por padrão e mostra todas ao ativar finalizadas", () => {
  const obras = agruparResponsaveis(
    ["Concluída", "Planejada", "Em andamento", "Paralisada", "Outro"].map((status, index) => ({
      ...base,
      obra_id: `obra-${index}`,
      obra_status: status,
    })),
  );
  assert.equal(filtrarObrasResponsaveis(obras, "").length, 4);
  assert.equal(filtrarObrasResponsaveis(obras, "", true).length, 5);
  assert.equal(obras.length, 5);
});

test("busca por CC, obra, cargo e pessoa respeita o conjunto exibido", () => {
  const obras = agruparResponsaveis([
    { ...base, obra_status: "Concluída", vinculo_id: "v", pessoa_id: "p", pessoa_nome: "Ana Lima" },
  ]);
  for (const termo of ["230", "igua", "supervisor", "ana"]) {
    assert.equal(filtrarObrasResponsaveis(obras, termo).length, 0);
    assert.equal(filtrarObrasResponsaveis(obras, termo, true).length, 1);
    assert.equal(filtrarObrasResponsaveis(obras, termo, false).length, 0);
  }
  assert.equal(obras[0].cargos[0].pessoas.length, 1);
});

test("mantém cargo sem pessoa como não definido", () => {
  const [obra] = agruparResponsaveis([base]);
  assert.equal(obra.cargos.length, 1);
  assert.equal(obra.cargos[0].pessoas.length, 0);
  assert.equal(obra.totalDefinidos, 0);
});

test("exclui cargo sem vínculo por id", async () => {
  const alvo = { tipo: "cargo" as const, id: "cargo-teste", nome: "Teste" };
  let chamadas = 0;
  await excluirCadastroResponsavel("diretor", alvo, async (cadastro) => {
    assert.deepEqual(cadastro, alvo);
    chamadas++;
    return { id: cadastro.id };
  });
  assert.equal(chamadas, 1);
});

test("bloqueia cargo em uso quando FK RESTRICT rejeita, inclusive obra oculta", async () => {
  await assert.rejects(
    excluirCadastroResponsavel("gerente", { tipo: "cargo", id: "c", nome: "Teste" }, async () => {
      throw { code: "23503" };
    }),
    /Cargo em uso.*Remova primeiro todos os vínculos.*desativar/,
  );
});

test("exclui pessoa manual sem vínculo por identidade, não por nome", async () => {
  await excluirCadastroResponsavel(
    "gerente",
    { tipo: "pessoa", id: "p", nome: "Homônimo", funcionario_id: null },
    async (cadastro) => {
      assert.equal(cadastro.id, "p");
      return { id: "p" };
    },
  );
});

test("bloqueia pessoa manual vinculada quando FK RESTRICT rejeita", async () => {
  await assert.rejects(
    excluirCadastroResponsavel(
      "diretor",
      { tipo: "pessoa", id: "p", nome: "Teste", funcionario_id: null },
      async () => {
        throw { code: "23503" };
      },
    ),
    /Pessoa manual em uso.*Remova primeiro todos os vínculos/,
  );
});

test("funcionário não pode ser excluído pelo módulo nem chamar o adaptador", async () => {
  await assert.rejects(
    excluirCadastroResponsavel(
      "diretor",
      { tipo: "pessoa", id: "p", nome: "Funcionário", funcionario_id: "f" },
      async () => {
        assert.fail("Não deve enviar DELETE");
      },
    ),
    /Funcionários não podem ser excluídos/,
  );
});

test("somente gerente e diretor podem enviar exclusão de ambos os cadastros", async () => {
  for (const role of ["coordenador", "supervisor", "assistente", "admin", null, undefined]) {
    for (const alvo of [
      { tipo: "cargo" as const, id: "c", nome: "Teste" },
      { tipo: "pessoa" as const, id: "p", nome: "Teste", funcionario_id: null },
    ]) {
      await assert.rejects(
        excluirCadastroResponsavel(role, alvo, async () => {
          assert.fail("Perfil de consulta não deve enviar DELETE");
        }),
        /Sem permissão/,
      );
    }
  }
});

test("DELETE sem registro retornado não é tratado como sucesso", async () => {
  await assert.rejects(
    excluirCadastroResponsavel(
      "diretor",
      { tipo: "cargo", id: "c", nome: "Teste" },
      async () => null,
    ),
    /Cadastro não excluído/,
  );
});

test("migration incremental restringe DELETE manual sem flexibilizar FKs ou outros módulos", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20260915120000_responsaveis_exclusao_manual.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /ALTER POLICY "Gerente e diretor excluem pessoas de responsabilidade"/);
  assert.match(sql, /ON public\.responsaveis_pessoas/);
  assert.match(sql, /funcionario_id IS NULL/);
  assert.match(sql, /has_role\(\(SELECT auth\.uid\(\)\), 'gerente'\)/);
  assert.match(sql, /has_role\(\(SELECT auth\.uid\(\)\), 'diretor'\)/);
  assert.doesNotMatch(sql, /CASCADE|DELETE FROM|ALTER TABLE|CREATE POLICY/i);
  const original = readFileSync(
    new URL("../../supabase/migrations/20260914135902_responsaveis_obras.sql", import.meta.url),
    "utf8",
  );
  assert.match(
    original,
    /cargo_id uuid NOT NULL REFERENCES public\.responsaveis_cargos\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    original,
    /pessoa_id uuid NOT NULL REFERENCES public\.responsaveis_pessoas\(id\) ON DELETE RESTRICT/,
  );
});

test("interface confirma exclusão e limita lista a pessoas manuais", () => {
  const fonte = readFileSync(
    new URL("../routes/_authenticated/responsaveis-obras.tsx", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /Confirmar exclusão definitiva/);
  assert.match(fonte, /Excluir definitivamente/);
  assert.match(fonte, /canManage && pessoasOpen/);
  assert.match(fonte, /canManage && Boolean\(exclusao\)/);
  assert.match(fonte, /pessoa\.tipo === "manual"\s*&&\s*pessoa\.funcionario_id === null/);
  assert.match(fonte, /query = query\.is\("funcionario_id", null\)/);
  assert.doesNotMatch(fonte, /from\("funcionarios"\)/);
});

test("permite várias pessoas no mesmo cargo e calcula o status retornado pelo banco", () => {
  const obra = agruparResponsaveis([
    { ...base, vinculo_id: "v1", pessoa_id: "p1", pessoa_nome: "João", compartilhado: false },
    { ...base, vinculo_id: "v2", pessoa_id: "p2", pessoa_nome: "Pedro", compartilhado: true },
  ])[0];
  assert.equal(obra.totalDefinidos, 2);
  assert.deepEqual(
    obra.cargos[0].pessoas.map((p) => p.status),
    ["definido", "compartilhado"],
  );
});

test("busca ignora acentos e encontra obra, cargo e pessoa", () => {
  const obras = agruparResponsaveis([
    { ...base, vinculo_id: "v1", pessoa_id: "p1", pessoa_nome: "Hígor Cardoso" },
  ]);
  assert.equal(filtrarObrasResponsaveis(obras, "igua").length, 1);
  assert.equal(filtrarObrasResponsaveis(obras, "higor").length, 1);
  assert.equal(filtrarObrasResponsaveis(obras, "supervisor").length, 1);
  assert.equal(filtrarObrasResponsaveis(obras, "comprador").length, 0);
});

test("sugere nomes semelhantes sem tratá-los como chave única", () => {
  const pessoas = [{ nome: "Higor Cardoso" }, { nome: "Higor Souza" }, { nome: "Ana Lima" }];
  assert.equal(pessoasSemelhantes(pessoas, "Higor").length, 2);
  assert.equal(pessoasSemelhantes(pessoas, "Hi").length, 0);
});

test("somente gerente e diretor podem gerenciar responsáveis", () => {
  assert.equal(podeGerenciarResponsaveis("diretor"), true);
  assert.equal(podeGerenciarResponsaveis("gerente"), true);
  assert.equal(podeGerenciarResponsaveis("coordenador"), false);
  assert.equal(podeGerenciarResponsaveis("supervisor"), false);
  assert.equal(podeGerenciarResponsaveis("assistente"), false);
  assert.equal(podeGerenciarResponsaveis(null), false);
});

test("migration cria as quatro tabelas e restringe escrita a gerente e diretor", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20260914135902_responsaveis_obras.sql", import.meta.url),
    "utf8",
  );
  for (const tabela of [
    "responsaveis_cargos",
    "responsaveis_pessoas",
    "obra_responsabilidade_cargos",
    "obra_responsabilidade_pessoas",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${tabela}`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${tabela} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /'gerente'/);
  assert.match(sql, /'diretor'/);
  assert.doesNotMatch(sql, /'coordenador'/);
  assert.doesNotMatch(sql, /UNIQUE\s*\(\s*nome_manual\s*\)/i);
  assert.match(
    sql,
    /WHERE o\.id = obra_responsabilidade_cargos\.obra_id[\s\S]*?o\.visivel_obras_control IS DISTINCT FROM false/,
  );
  assert.match(
    sql,
    /WHERE orc\.id = obra_responsabilidade_pessoas\.obra_cargo_id[\s\S]*?o\.visivel_obras_control IS DISTINCT FROM false/,
  );
});
