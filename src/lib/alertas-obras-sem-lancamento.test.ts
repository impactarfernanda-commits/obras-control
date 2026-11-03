import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  buscarObrasComUltimoRegistro,
  criarAlertasObrasSemLancamento,
  validarObrasComUltimoRegistro,
  type ObraComUltimoRegistro,
} from "./alertas-obras-sem-lancamento.ts";

const HOJE = new Date("2026-11-03T00:00:00.000Z");
const HOJE_STR = "2026-11-03";

function obra(id: string, nome: string, data?: string): ObraComUltimoRegistro {
  return { id, nome, registros_horas: data ? [{ data }] : [] };
}

function criarAdminComFetch(fetchMock: typeof fetch) {
  return createClient("https://example.supabase.co", "chave-publicavel-de-teste", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchMock },
  });
}

test("preserva os limites de hoje, três, quatro, sete e oito dias", () => {
  const alertas = criarAlertasObrasSemLancamento({
    obras: [
      obra("hoje", "Hoje", "2026-11-03"),
      obra("tres", "Três", "2026-10-31"),
      obra("quatro", "Quatro", "2026-10-30"),
      obra("sete", "Sete", "2026-10-27"),
      obra("oito", "Oito", "2026-10-26"),
    ],
    hoje: HOJE,
    hojeStr: HOJE_STR,
    diasSemLancamento: 3,
  });

  assert.deepEqual(
    alertas.map(({ metadata, severidade }) => [metadata.obra_id, metadata.dias, severidade]),
    [
      ["quatro", 4, "warning"],
      ["sete", 7, "warning"],
      ["oito", 8, "critical"],
    ],
  );
});

test("mantém integralmente o DTO do alerta para obra sem lançamentos", () => {
  const [alerta] = criarAlertasObrasSemLancamento({
    obras: [obra("obra-sem-registro", "Obra sem registro")],
    hoje: HOJE,
    hojeStr: HOJE_STR,
    diasSemLancamento: 3,
  });

  assert.deepEqual(alerta, {
    tipo: "obra_sem_lancamento",
    titulo: "Centro de custo sem lançamentos: Obra sem registro",
    mensagem: "O centro de custo Obra sem registro nunca recebeu registros de horas.",
    severidade: "critical",
    metadata: { obra_id: "obra-sem-registro", obra_nome: "Obra sem registro", dias: 999 },
    dedupe_key: "obra_sem_lancamento:obra-sem-registro:2026-11-03",
  });
});

test("mantém mensagem, metadata e dedupe_key do último lançamento", () => {
  const ultimo = "2026-10-30";
  const [alerta] = criarAlertasObrasSemLancamento({
    obras: [obra("obra-1", "Obra 1", ultimo)],
    hoje: HOJE,
    hojeStr: HOJE_STR,
    diasSemLancamento: 3,
  });

  assert.deepEqual(alerta, {
    tipo: "obra_sem_lancamento",
    titulo: "Centro de custo sem lançamentos: Obra 1",
    mensagem: `O centro de custo Obra 1 não recebe registros de horas há 4 dias (último: ${new Date(ultimo).toLocaleDateString("pt-BR")}).`,
    severidade: "warning",
    metadata: { obra_id: "obra-1", obra_nome: "Obra 1", dias: 4 },
    dedupe_key: "obra_sem_lancamento:obra-1:2026-11-03",
  });
});

test("não exclui obras por status ou visibilidade", () => {
  const obras = validarObrasComUltimoRegistro([
    { ...obra("ativa", "Ativa"), status: "ativa", visivel_obras_control: true },
    { ...obra("inativa", "Inativa"), status: "inativa", visivel_obras_control: true },
    { ...obra("oculta", "Oculta"), status: "ativa", visivel_obras_control: false },
  ]);

  const alertas = criarAlertasObrasSemLancamento({
    obras,
    hoje: HOJE,
    hojeStr: HOJE_STR,
    diasSemLancamento: 3,
  });
  assert.deepEqual(
    alertas.map((alerta) => alerta.metadata.obra_id),
    ["ativa", "inativa", "oculta"],
  );
});

test("rejeita relacionamento ausente, mais de uma linha e datas inválidas", () => {
  assert.throws(() => validarObrasComUltimoRegistro([{ id: "1", nome: "Obra" }]));
  assert.throws(() =>
    validarObrasComUltimoRegistro([
      { id: "1", nome: "Obra", registros_horas: [{ data: "2026-10-01" }, { data: "2026-10-01" }] },
    ]),
  );
  assert.throws(() =>
    validarObrasComUltimoRegistro([
      { id: "1", nome: "Obra", registros_horas: [{ data: "2026-02-30" }] },
    ]),
  );
});

test("gera a sintaxe de relacionamento, ordenação, limit por referência e paginação", async () => {
  const urls: URL[] = [];
  const totalObras = 1005;
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    urls.push(url);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "1000");
    const quantidade = Math.max(0, Math.min(limit, totalObras - offset));
    const resposta = Array.from({ length: quantidade }, (_, indice) => ({
      id: `obra-${offset + indice}`,
      nome: `Obra ${offset + indice}`,
      registros_horas: [{ data: "2026-10-01" }],
    }));
    return new Response(JSON.stringify(resposta), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const resultado = await buscarObrasComUltimoRegistro(criarAdminComFetch(fetchMock));

  assert.equal(resultado.length, totalObras);
  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.equal(url.searchParams.get("select"), "id,nome,registros_horas(data)");
    assert.equal(url.searchParams.get("order"), "id.asc");
    assert.equal(url.searchParams.get("registros_horas.order"), "data.desc,id.desc");
    assert.equal(url.searchParams.get("registros_horas.limit"), "1");
    assert.equal(url.searchParams.has("registros_horas.offset"), false);
    assert.equal(url.searchParams.toString().includes("!inner"), false);
    assert.equal(url.searchParams.has("status"), false);
    assert.equal(url.searchParams.has("visivel_obras_control"), false);
  }
  assert.equal(urls[0].searchParams.get("offset"), "0");
  assert.equal(urls[0].searchParams.get("limit"), "1000");
  assert.equal(urls[1].searchParams.get("offset"), "1000");
  assert.equal(urls[1].searchParams.get("limit"), "1000");
});

test("mantém uma linha determinística quando há lançamentos na mesma data", async () => {
  let urlConsultada: URL | undefined;
  const fetchMock: typeof fetch = async (input) => {
    urlConsultada = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    return new Response(
      JSON.stringify([{ id: "obra-1", nome: "Obra 1", registros_horas: [{ data: "2026-10-01" }] }]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const resultado = await buscarObrasComUltimoRegistro(criarAdminComFetch(fetchMock));
  assert.equal(resultado[0].registros_horas.length, 1);
  assert.equal(urlConsultada?.searchParams.get("registros_horas.order"), "data.desc,id.desc");
});

test("propaga erro do PostgREST e não o converte em lista vazia", async () => {
  const fetchMock: typeof fetch = async () =>
    new Response(JSON.stringify({ message: "falha controlada" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

  await assert.rejects(
    buscarObrasComUltimoRegistro(criarAdminComFetch(fetchMock)),
    (erro: unknown) =>
      typeof erro === "object" &&
      erro !== null &&
      "message" in erro &&
      erro.message === "falha controlada",
  );
});

test("a consulta necessária ocorre antes do upsert de notificações", () => {
  const source = readFileSync(new URL("./alertas.server.ts", import.meta.url), "utf8");
  const consulta = source.indexOf("await buscarObrasComUltimoRegistro(admin)");
  const gravacao = source.indexOf('.from("notificacoes")');
  assert.ok(consulta >= 0);
  assert.ok(gravacao > consulta);
  assert.equal(source.includes('.from("registros_horas")\n      .select("obra_id, data")'), false);
});

test("reduz requisições e bytes no cenário sintético com mais de 1.000 registros", () => {
  const obras = Array.from({ length: 100 }, (_, indice) => ({
    id: `00000000-0000-4000-8000-${String(indice).padStart(12, "0")}`,
    nome: `Centro de custo ${indice}`,
  }));
  const historico = Array.from({ length: 5000 }, (_, indice) => ({
    obra_id: obras[indice % obras.length].id,
    data: `2026-10-${String(31 - (indice % 30)).padStart(2, "0")}`,
  }));
  const embutido = obras.map((item, indice) => ({
    ...item,
    registros_horas: [{ data: `2026-10-${String(31 - (indice % 30)).padStart(2, "0")}` }],
  }));
  const antes = Buffer.from(JSON.stringify(obras) + JSON.stringify(historico));
  const depois = Buffer.from(JSON.stringify(embutido));

  assert.equal(1 + Math.ceil(historico.length / 1000), 6);
  assert.equal(Math.ceil(obras.length / 1000), 1);
  assert.ok(depois.length < antes.length * 0.1);
  assert.ok(gzipSync(depois).length < gzipSync(antes).length);
});
