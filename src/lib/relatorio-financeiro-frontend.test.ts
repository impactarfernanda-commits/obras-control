import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adaptarRelatorioFinanceiroCompleto,
  relatorioFinanceiroCompletoHabilitado,
  relatorioFinanceiroCompletoKeys,
  removerRelatorioFinanceiroDoUsuario,
  selecionarFluxoFinanceiro,
} from "./relatorio-financeiro-frontend.ts";
import { QueryClient } from "@tanstack/react-query";
import type { RelatorioFinanceiroCompletoDTO } from "./relatorio-centro-custo.functions.ts";

const tela = readFileSync("src/routes/_authenticated/relatorios.tsx", "utf8");

function dto(): RelatorioFinanceiroCompletoDTO {
  return {
    competencia: "2026-10-01",
    periodoInicial: "2026-09-25",
    periodoFinal: "2026-10-24",
    centros: [],
    avisos: [],
    segmentarMod: true,
    obras: [{ id: "obra-1", nome: "Obra Teste" }],
    funcionarios: [
      {
        funcionarioId: "func-1",
        funcionarioNome: "Funcionário",
        categoria: "MONTADOR",
        tipo: "MOD",
        ativo: true,
        dataAdmissao: "2025-01-01",
        dataDesligamento: null,
        custoMensal: {
          salario: 3000,
          encargos: 1000,
          prov13: 250,
          provAvisoPrevio: 250,
          provFerias: 333,
          beneficios: 600,
          seguroVida: 15,
          total: 5448,
        },
        totalMensalIntegral: 5548,
        proporcionalCompetencia: {
          custoBase: 2000,
          custoHE: 100,
          remuneracaoHE: 50,
          encargosProvisoesHE: 50,
          custoAdicionalNoturno: 20,
          custoRefeicao: 45,
          total: 2165,
          horas50: 2,
          horas100: 1,
          horasSemAdicionalHe: 0,
        },
        totalProporcionalCompetencia: 2165,
        alocacoes: [
          {
            obra_id: "obra-1",
            data: "2026-10-01",
            hora_entrada: "07:00:00",
            hora_saida: "18:00:00",
          },
        ],
        registros: [
          {
            id: "registro-1",
            obra_id: "obra-1",
            data: "2026-10-01",
            horas_normais: 9,
            horas_extras: 2,
            ausencia: false,
            tipo_registro: "horas",
            falta_tipo: null,
            observacoes: "Teste",
            detalhe: {
              minutos_normais: 540,
              minutos_he_50: 120,
              minutos_he_100: 0,
              minutos_sem_adicional_he: 0,
              minutos_noturnos_reais: 60,
              minutos_noturnos_remuneraveis: 60,
              jornada_excepcional: false,
            },
          },
        ],
      },
    ],
  };
}

test("feature flag fica desabilitada por padrão e aceita somente true explícito", () => {
  assert.equal(relatorioFinanceiroCompletoHabilitado(undefined), false);
  assert.equal(relatorioFinanceiroCompletoHabilitado("false"), false);
  assert.equal(relatorioFinanceiroCompletoHabilitado("TRUE"), false);
  assert.equal(relatorioFinanceiroCompletoHabilitado("true"), true);
});

test("fluxo completo substitui folha e centro antigos sem chamadas paralelas", () => {
  for (const role of ["gerente", "diretor"] as const)
    assert.deepEqual(
      selecionarFluxoFinanceiro({ role, aba: "funcionarios", flagHabilitada: true }),
      { usarCompleto: true, consultarFolhaLegada: false, consultarCentros: false },
    );
  assert.deepEqual(
    selecionarFluxoFinanceiro({
      role: "gerente",
      aba: "funcionarios",
      flagHabilitada: false,
    }),
    { usarCompleto: false, consultarFolhaLegada: true, consultarCentros: true },
  );
});

test("cinco perfis preservam autorização e fluxo operacional anterior", () => {
  for (const role of ["coordenador", "assistente", "supervisor"] as const) {
    const fluxo = selecionarFluxoFinanceiro({ role, aba: "funcionarios", flagHabilitada: true });
    assert.equal(fluxo.usarCompleto, false, role);
    assert.equal(fluxo.consultarFolhaLegada, false, role);
  }
  assert.equal(
    selecionarFluxoFinanceiro({
      role: "coordenador",
      aba: "obras",
      flagHabilitada: true,
    }).consultarCentros,
    true,
  );
});

test("troca de usuário e competência produz chaves isoladas", () => {
  assert.notDeepEqual(
    relatorioFinanceiroCompletoKeys.competencia("user-1", "2026-10-01"),
    relatorioFinanceiroCompletoKeys.competencia("user-2", "2026-10-01"),
  );
  assert.notDeepEqual(
    relatorioFinanceiroCompletoKeys.competencia("user-1", "2026-10-01"),
    relatorioFinanceiroCompletoKeys.competencia("user-1", "2026-11-01"),
  );
});

test("logout e troca de usuário removem somente o cache financeiro da sessão anterior", () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    relatorioFinanceiroCompletoKeys.competencia("user-1", "2026-10-01"),
    dto(),
  );
  queryClient.setQueryData(
    relatorioFinanceiroCompletoKeys.competencia("user-2", "2026-10-01"),
    dto(),
  );
  removerRelatorioFinanceiroDoUsuario(queryClient, "user-1");
  assert.equal(
    queryClient.getQueryData(relatorioFinanceiroCompletoKeys.competencia("user-1", "2026-10-01")),
    undefined,
  );
  assert.ok(
    queryClient.getQueryData(relatorioFinanceiroCompletoKeys.competencia("user-2", "2026-10-01")),
  );
});

test("adaptador preserva tabela, totais distintos e diálogo diário", () => {
  const adaptado = adaptarRelatorioFinanceiroCompleto(dto());
  assert.equal(adaptado.funcionarios[0]?.nome, "Funcionário");
  assert.equal(adaptado.custosPorFuncionario.get("func-1")?.total, 5448);
  assert.equal(adaptado.totaisMensaisIntegrais.get("func-1"), 5548);
  assert.equal(adaptado.totaisProporcionaisCompetencia.get("func-1"), 2165);
  assert.equal(adaptado.proporcionaisPorFuncionario.get("func-1")?.custoRefeicao, 45);
  assert.deepEqual(adaptado.obras, [{ id: "obra-1", nome: "Obra Teste" }]);
  assert.deepEqual(adaptado.alocacoes[0], {
    funcionario_id: "func-1",
    obra_id: "obra-1",
    data: "2026-10-01",
    hora_entrada: "07:00:00",
    hora_saida: "18:00:00",
    tipo_mao_obra: null,
  });
  assert.equal(adaptado.registros[0]?.observacoes, "Teste");
  assert.equal(adaptado.detalhes[0]?.minutos_noturnos_remuneraveis, 60);
});

test("tela usa query protegida em memória e mantém rollback pelo fluxo legado", () => {
  assert.match(tela, /getRelatorioFinanceiroCompleto/);
  assert.match(
    tela,
    /queryKey: relatorioFinanceiroCompletoKeys\.competencia\(user\?\.id, competencia\)/,
  );
  assert.match(tela, /enabled: Boolean\(user\?\.id\) && fluxoFinanceiro\.usarCompleto/);
  assert.match(tela, /enabled: Boolean\(user\?\.id\) && fluxoFinanceiro\.consultarFolhaLegada/);
  assert.match(tela, /enabled: fluxoFinanceiro\.consultarCentros/);
  assert.match(tela, /refetchOnMount: "always"/);
  assert.doesNotMatch(tela, /persistQuery|localStorage|sessionStorage/);
});
