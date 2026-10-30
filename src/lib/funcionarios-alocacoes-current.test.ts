import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  alocacoesCurrentKey,
  filtrarFuncionariosCandidatosAlocacao,
  funcionariosElegiveisConsultaAlocacao,
  idsCanonicosFuncionarios,
  nomeObraDaAlocacao,
  nomesObrasPorId,
  ultimasAlocacoesPorFuncionario,
} from "./funcionarios-alocacoes-current.ts";

const funcionarios = [
  {
    id: "ativo",
    nome: "João Ativo",
    categoria_mo: "PEDREIRO",
    ativo: true,
    deleted_at: null,
    visivel_obras_control: true,
  },
  {
    id: "desligado",
    nome: "Maria Desligada",
    categoria_mo: "ADMINISTRATIVO",
    ativo: false,
    deleted_at: null,
    visivel_obras_control: true,
  },
  {
    id: "excluido",
    nome: "Excluído",
    categoria_mo: "PEDREIRO",
    ativo: true,
    deleted_at: "2026-10-01T00:00:00Z",
    visivel_obras_control: true,
  },
  {
    id: "oculto",
    nome: "Oculto",
    categoria_mo: "PEDREIRO",
    ativo: true,
    deleted_at: null,
    visivel_obras_control: false,
  },
] as const;

const resolverTipo = (categoria: string | null) =>
  categoria === "PEDREIRO" ? ("MOD" as const) : categoria ? ("MOI" as const) : null;

test("consulta inclui somente funcionarios que podem aparecer com os filtros atuais", () => {
  assert.deepEqual(
    filtrarFuncionariosCandidatosAlocacao(
      funcionarios,
      { status: "ativo", tipo: "MOD", busca: "joão" },
      resolverTipo,
    ).map((f) => f.id),
    ["ativo"],
  );
  assert.deepEqual(
    filtrarFuncionariosCandidatosAlocacao(
      funcionarios,
      { status: "inativo", tipo: "all", busca: "" },
      resolverTipo,
    ).map((f) => f.id),
    ["desligado"],
  );
});

test("funcionarios excluidos e invisiveis nunca entram na consulta historica", () => {
  assert.deepEqual(
    funcionariosElegiveisConsultaAlocacao(funcionarios).map((f) => f.id),
    ["ativo", "desligado"],
  );
});

test("ids da consulta permanecem estaveis ao alternar filtros locais", () => {
  const elegiveis = funcionariosElegiveisConsultaAlocacao(funcionarios);
  const ids = idsCanonicosFuncionarios(elegiveis);
  assert.deepEqual(ids, ["ativo", "desligado"]);
  assert.deepEqual(idsCanonicosFuncionarios(elegiveis), ids);
});

test("ultima alocacao preserva a primeira linha da ordenacao decrescente", () => {
  const atuais = ultimasAlocacoesPorFuncionario([
    { funcionario_id: "f1", obra_id: "obra-nova", data: "2026-10-20" },
    { funcionario_id: "f2", obra_id: "obra-unica", data: "2026-10-18" },
    { funcionario_id: "f1", obra_id: "obra-antiga", data: "2026-09-01" },
  ]);
  assert.deepEqual(atuais.get("f1"), {
    funcionario_id: "f1",
    obra_id: "obra-nova",
    data: "2026-10-20",
  });
  assert.equal(atuais.get("sem-alocacao"), undefined);
});

test("nome da obra usa inclusive referencias ocultas da consulta canonica", () => {
  const nomes = nomesObrasPorId([
    { id: "visivel", nome: "Obra Visível" },
    { id: "oculta", nome: "Obra Oculta" },
  ]);
  assert.equal(nomeObraDaAlocacao("oculta", nomes), "Obra Oculta");
});

test("obra ausente preserva o identificador em vez de virar informacao vazia", () => {
  assert.equal(
    nomeObraDaAlocacao("obra-fora-lista", new Map()),
    "Centro de custo não disponível (obra-fora-lista)",
  );
});

test("ids e query keys sao canonicos e isolados por usuario", () => {
  const ids = idsCanonicosFuncionarios([{ id: "b" }, { id: "a" }, { id: "b" }]);
  assert.deepEqual(ids, ["a", "b"]);
  assert.notDeepEqual(alocacoesCurrentKey("usuario-a", ids), alocacoesCurrentKey("usuario-b", ids));
  assert.equal(alocacoesCurrentKey("usuario-a", ids)[0], "alocacoes-current");
});

test("rota restringe ids, remove join repetido e preserva invalidacao por prefixo", () => {
  const rota = readFileSync("src/routes/_authenticated/funcionarios.tsx", "utf8");
  assert.match(rota, /\.select\("funcionario_id, obra_id, data"\)/);
  assert.match(rota, /\.in\("funcionario_id", funcionariosCandidatosIds\)/);
  assert.doesNotMatch(rota, /\.select\("funcionario_id, obra_id, data, obras\(nome\)"\)/);
  assert.match(
    rota,
    /alocacoesCurrentKey\(user\?\.id \?\? "sem-usuario", funcionariosCandidatosIds\)/,
  );
});
