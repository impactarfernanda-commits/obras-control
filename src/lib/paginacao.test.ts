import assert from "node:assert/strict";
import test from "node:test";
import { buscarTodasPaginas } from "./paginacao.ts";

function consultaSimulada(total: number, erroNoInicio?: number) {
  const registros = Array.from({ length: total }, (_, id) => ({ id }));
  return async (inicio: number, fim: number) => {
    if (inicio === erroNoInicio) return { data: null, error: new Error(`falha em ${inicio}`) };
    return { data: registros.slice(inicio, fim + 1), error: null };
  };
}

test("pagina 2237 registros sem truncar ou duplicar", async () => {
  const resultado = await buscarTodasPaginas<{ id: number }>(consultaSimulada(2237));
  assert.equal(resultado.length, 2237);
  assert.equal(new Set(resultado.map((item) => item.id)).size, 2237);
});

test("pagina conjunto com exatamente 1000 registros", async () => {
  const resultado = await buscarTodasPaginas<{ id: number }>(consultaSimulada(1000));
  assert.equal(resultado.length, 1000);
});

test("pagina conjunto menor que 1000 registros", async () => {
  const resultado = await buscarTodasPaginas<{ id: number }>(consultaSimulada(237));
  assert.equal(resultado.length, 237);
});

test("propaga erro de pagina intermediaria", async () => {
  await assert.rejects(
    buscarTodasPaginas<{ id: number }>(consultaSimulada(2237, 1000)),
    /falha em 1000/,
  );
});
