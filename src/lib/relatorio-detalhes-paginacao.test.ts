import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buscarDetalhesHorasPaginados,
  compararCompletudeDetalhesAgregada,
} from "./relatorio-detalhes-paginacao.ts";

function detalhes(quantidade: number) {
  return Array.from({ length: quantidade }, (_, indice) => ({
    registro_horas_id: String(indice).padStart(6, "0"),
    minutos_normais: 480,
    minutos_he_50: indice % 3 === 0 ? 60 : 0,
    minutos_he_100: indice % 5 === 0 ? 60 : 0,
    minutos_sem_adicional_he: indice % 7 === 0 ? 30 : 0,
    minutos_noturnos_reais: indice % 11 === 0 ? 60 : 0,
    minutos_noturnos_remuneraveis: indice % 11 === 0 ? 68.5714 : 0,
    jornada_excepcional: indice % 13 === 0,
  }));
}

async function paginar(total: number) {
  const fonte = detalhes(total);
  const intervalos: Array<[number, number]> = [];
  const resultado = await buscarDetalhesHorasPaginados<(typeof fonte)[number]>(
    async (inicio, fim) => {
      intervalos.push([inicio, fim]);
      return { data: fonte.slice(inicio, fim + 1), error: null };
    },
  );
  return { resultado, intervalos };
}

test("carrega competência com menos de mil detalhes em uma página", async () => {
  const { resultado, intervalos } = await paginar(999);
  assert.equal(resultado.length, 999);
  assert.deepEqual(intervalos, [[0, 999]]);
});

test("carrega exatamente mil detalhes e confirma completude com página final vazia", async () => {
  const { resultado, intervalos } = await paginar(1000);
  assert.equal(resultado.length, 1000);
  assert.deepEqual(intervalos, [
    [0, 999],
    [1000, 1999],
  ]);
});

test("carrega mais de mil detalhes em múltiplas páginas sem perder associação", async () => {
  const { resultado, intervalos } = await paginar(2105);
  assert.equal(resultado.length, 2105);
  assert.deepEqual(intervalos, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
  assert.equal(resultado[1000]?.registro_horas_id, "001000");
  assert.equal(new Map(resultado.map((item) => [item.registro_horas_id, item])).size, 2105);
});

test("interrompe diante de erro ou resposta incompleta em qualquer página", async () => {
  let pagina = 0;
  await assert.rejects(
    buscarDetalhesHorasPaginados(async () => {
      pagina += 1;
      return pagina === 1
        ? { data: detalhes(1000), error: null }
        : { data: null, error: new Error("falha controlada") };
    }),
    /falha controlada/,
  );
  await assert.rejects(
    buscarDetalhesHorasPaginados(async () => ({ data: null, error: null })),
    /incompleta/,
  );
});

test("comparação agregada preserva paridade e sinaliza possíveis impactos sem dados pessoais", () => {
  const completos = detalhes(1005);
  const paridade = compararCompletudeDetalhesAgregada(completos, completos);
  assert.equal(paridade.detalhesAdicionais, 0);
  assert.equal(paridade.possivelImpactoFinanceiro, false);

  const resumo = compararCompletudeDetalhesAgregada(completos.slice(0, 1000), completos);
  assert.equal(resumo.detalhesConsultaUnica, 1000);
  assert.equal(resumo.detalhesConsultaPaginada, 1005);
  assert.equal(resumo.detalhesAdicionais, 5);
  assert.equal(resumo.possivelImpactoFinanceiro, true);
  assert.deepEqual(Object.keys(resumo.diferencasMinutos).sort(), [
    "minutos_he_100",
    "minutos_he_50",
    "minutos_normais",
    "minutos_noturnos_reais",
    "minutos_noturnos_remuneraveis",
    "minutos_sem_adicional_he",
  ]);
  assert.doesNotMatch(JSON.stringify(resumo), /registro_horas_id|funcionario|salario|nome/i);
});

test("as duas consultas preservam período 25–24, campos, ordenação e paginação", () => {
  const servidor = readFileSync("src/lib/relatorio-centro-custo.functions.ts", "utf8");
  const tela = readFileSync("src/routes/_authenticated/relatorios.tsx", "utf8");
  for (const fonte of [servidor, tela]) {
    assert.match(fonte, /buscarDetalhesHorasPaginados/);
    assert.match(fonte, /\.gte\("data_inicio" as never, (?:periodo\.start|start)\)/);
    assert.match(fonte, /\.lte\("data_inicio" as never, (?:periodo\.end|end)\)/);
    assert.match(fonte, /\.order\("registro_horas_id" as never, \{ ascending: true \}\)/);
    assert.match(fonte, /\.range\(from, to\)/);
  }
  assert.match(
    servidor,
    /minutos_noturnos_normais_remuneraveis,minutos_noturnos_he_50_remuneraveis,minutos_noturnos_he_100_remuneraveis,minutos_noturnos_sem_adicional_he_remuneraveis/,
  );
  assert.match(tela, /minutos_noturnos_reais,minutos_noturnos_remuneraveis,jornada_excepcional/);
});

test("período 25–24 e autorizações dos endpoints permanecem inalterados", () => {
  const servidor = readFileSync("src/lib/relatorio-centro-custo.functions.ts", "utf8");
  assert.match(servidor, /const periodo = periodoFolha\(competencia\)/);
  assert.match(servidor, /const ROLES_CENTRO_CUSTO = \["coordenador", "gerente", "diretor"\]/);
  assert.match(servidor, /const ROLES_FINANCEIRO_COMPLETO = \["gerente", "diretor"\]/);
  assert.match(servidor, /\.middleware\(\[requireSupabaseAuth\]\)/);
});
