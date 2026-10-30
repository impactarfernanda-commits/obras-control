import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type Beneficios } from "@/lib/custos-core";
import type { Categoria } from "@/lib/categorias-core";
import { buscarTodasPaginas } from "@/lib/paginacao";
import { SUPERVISOR_CC_VIGENCIAS_ATIVAS } from "@/lib/supervisor-cc";
import type { AlocacaoRelatorio } from "@/lib/relatorio-centro-custo";
import {
  executarProcessamentoFinanceiroAutorizado,
  processarFinanceiroRelatoriosInterno,
  type AlocacaoFinanceiraInterna,
  type EntradaProcessamentoFinanceiroInterno,
  type FuncionarioFinanceiroInterno,
  type ProjecaoFinanceiraFuncionarioInterna,
  type RegistroFinanceiroInterno,
} from "@/lib/relatorio-financeiro-interno.server";
import type { DetalheJornadaVisual } from "@/lib/horas-visualizacao";

type Role = "assistente" | "supervisor" | "coordenador" | "gerente" | "diretor";
type ProcessamentoFinanceiroInterno = ReturnType<typeof processarFinanceiroRelatoriosInterno>;

export type RelatorioCentrosCustoDTO = {
  competencia: string;
  periodoInicial: string;
  periodoFinal: string;
  centros: ProcessamentoFinanceiroInterno["consolidacao"]["centros"];
  avisos: string[];
  segmentarMod: boolean;
};

export type RelatorioFinanceiroCompletoDTO = RelatorioCentrosCustoDTO & {
  funcionarios: ProjecaoFinanceiraFuncionarioInterna[];
};

const inputSchema = z.object({ competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) });
const ROLES_CENTRO_CUSTO = ["coordenador", "gerente", "diretor"] as const;
const ROLES_FINANCEIRO_COMPLETO = ["gerente", "diretor"] as const;

export function periodoFolha(competencia: string) {
  const [year, month] = competencia.split("-").map(Number);
  const localISO = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const startDate = new Date(year, month - 2, 25);
  const endDate = new Date(year, month - 1, 24);
  return { start: localISO(startDate), end: localISO(endDate), startDate, endDate };
}

function montarRelatorioCentrosCustoDTO(
  entrada: EntradaProcessamentoFinanceiroInterno,
  processamento: ProcessamentoFinanceiroInterno,
): RelatorioCentrosCustoDTO {
  return {
    competencia: entrada.competencia,
    periodoInicial: entrada.periodo.start,
    periodoFinal: entrada.periodo.end,
    centros: processamento.consolidacao.centros.map((centro) => ({
      ...centro,
      linhas: centro.linhas.map((linha) => ({ ...linha })),
    })),
    avisos: [...processamento.consolidacao.avisos],
    segmentarMod: processamento.segmentarMod,
  };
}

export function montarRelatorioCentrosCusto(
  input: Omit<EntradaProcessamentoFinanceiroInterno, "periodo">,
): RelatorioCentrosCustoDTO {
  const entrada = { ...input, periodo: periodoFolha(input.competencia) };
  const processamento = processarFinanceiroRelatoriosInterno(entrada, {
    incluirProjecaoFolha: false,
  });
  return montarRelatorioCentrosCustoDTO(entrada, processamento);
}

async function carregarRoles(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const roleResult = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (roleResult.error) throw new Error(roleResult.error.message);
  return (roleResult.data ?? []).map((row) => row.role as Role);
}

async function carregarEntradaRelatorioFinanceiro(
  competencia: string,
  incluirDadosIndividuais: boolean,
): Promise<EntradaProcessamentoFinanceiroInterno> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const periodo = periodoFolha(competencia);
  const [
    funcionarios,
    beneficiosRes,
    seguros,
    categorias,
    obras,
    alocacoes,
    registros,
    detalhesRes,
    feriadosRes,
    regimes,
    vigenciasCentroCusto,
    alocacoesReferenciaRegime,
  ] = await Promise.all([
    buscarTodasPaginas<FuncionarioFinanceiroInterno>((from, to) =>
      supabaseAdmin
        .from("funcionarios")
        .select(
          "id,nome,categoria_mo,ativo,salario,deleted_at,visivel_obras_control,data_admissao,data_desligamento",
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabaseAdmin
      .from("beneficios_config")
      .select("assistencia_medica,assistencia_odontologica,vale_alimentacao,multibeneficio")
      .maybeSingle(),
    buscarTodasPaginas<{ categoria: string; seguro_vida: number | null }>((from, to) =>
      supabaseAdmin
        .from("categoria_salarios")
        .select("categoria,seguro_vida")
        .order("categoria", { ascending: true })
        .range(from, to),
    ),
    buscarTodasPaginas<Categoria>((from, to) =>
      supabaseAdmin
        .from("categorias")
        .select("nome,tipo")
        .order("nome", { ascending: true })
        .range(from, to),
    ),
    buscarTodasPaginas<{ id: string; nome: string }>((from, to) =>
      supabaseAdmin
        .from("obras")
        .select("id,nome")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    buscarTodasPaginas<AlocacaoFinanceiraInterna>((from, to) =>
      supabaseAdmin
        .from("alocacoes")
        .select(
          (incluirDadosIndividuais
            ? "id,funcionario_id,obra_id,data,tipo_mao_obra,especialidade_ajudante,hora_entrada,hora_saida"
            : "id,funcionario_id,obra_id,data,tipo_mao_obra,especialidade_ajudante") as never,
        )
        .gte("data", periodo.start)
        .lte("data", periodo.end)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    buscarTodasPaginas<RegistroFinanceiroInterno>((from, to) =>
      supabaseAdmin
        .from("registros_horas")
        .select(
          incluirDadosIndividuais
            ? "id,funcionario_id,obra_id,data,horas_normais,horas_extras,ausencia,tipo_registro,falta_tipo,observacoes"
            : "id,funcionario_id,obra_id,data,horas_normais,horas_extras,ausencia,tipo_registro,falta_tipo",
        )
        .gte("data", periodo.start)
        .lte("data", periodo.end)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabaseAdmin
      .from("registros_horas_detalhes" as never)
      .select(
        "registro_horas_id,minutos_normais,minutos_he_50,minutos_he_100,minutos_sem_adicional_he,minutos_noturnos_reais,minutos_noturnos_remuneraveis,minutos_noturnos_normais_remuneraveis,minutos_noturnos_he_50_remuneraveis,minutos_noturnos_he_100_remuneraveis,minutos_noturnos_sem_adicional_he_remuneraveis,jornada_excepcional" as never,
      )
      .gte("data_inicio" as never, periodo.start)
      .lte("data_inicio" as never, periodo.end),
    supabaseAdmin
      .from("feriados_obras_control" as never)
      .select("data" as never)
      .eq("ativo" as never, true),
    buscarTodasPaginas<{
      funcionario_id: string;
      regime: "local" | "alojado";
      vigencia_inicio: string;
      vigencia_fim: string | null;
    }>((from, to) =>
      supabaseAdmin
        .from("funcionario_regime_vigencias")
        .select("funcionario_id,regime,vigencia_inicio,vigencia_fim")
        .lte("vigencia_inicio", periodo.end)
        .or(`vigencia_fim.is.null,vigencia_fim.gte.${periodo.start}`)
        .order("funcionario_id")
        .order("vigencia_inicio")
        .range(from, to),
    ),
    SUPERVISOR_CC_VIGENCIAS_ATIVAS
      ? buscarTodasPaginas<{
          funcionario_id: string;
          obra_id: string;
          vigencia_inicio: string;
          vigencia_fim: string | null;
          origem: string;
          observacao: string | null;
        }>(
          (from, to) =>
            supabaseAdmin
              .from("funcionario_cc_vigencias" as never)
              .select(
                "funcionario_id,obra_id,vigencia_inicio,vigencia_fim,origem,observacao" as never,
              )
              .lte("vigencia_inicio" as never, periodo.end as never)
              .or(`vigencia_fim.is.null,vigencia_fim.gte.${periodo.start}` as never)
              .order("funcionario_id" as never)
              .order("vigencia_inicio" as never)
              .range(from, to) as never,
        )
      : Promise.resolve([]),
    (async () => {
      const result = await supabaseAdmin.rpc("obras_control_alocacoes_referencia_regime", {
        p_inicio: periodo.start,
        p_fim: periodo.end,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    })(),
  ]);
  if (beneficiosRes.error) throw new Error(beneficiosRes.error.message);
  if (detalhesRes.error) throw new Error(detalhesRes.error.message);
  if (feriadosRes.error) throw new Error(feriadosRes.error.message);

  const referenciasAnteriores = alocacoesReferenciaRegime.filter(
    (referencia) => referencia.data < periodo.start,
  );
  const idsComReferenciaAnterior = [
    ...new Set(referenciasAnteriores.map((referencia) => referencia.funcionario_id)),
  ];
  const alocacoesAnteriores = idsComReferenciaAnterior.length
    ? await buscarTodasPaginas<AlocacaoRelatorio>((from, to) =>
        supabaseAdmin
          .from("alocacoes")
          .select("funcionario_id,obra_id,data,tipo_mao_obra,especialidade_ajudante" as never)
          .in("funcionario_id", idsComReferenciaAnterior)
          .lt("data", periodo.start)
          .order("data", { ascending: false })
          .range(from, to),
      )
    : [];

  return {
    competencia,
    periodo,
    funcionarios,
    beneficios: beneficiosRes.data as Beneficios | null,
    seguros,
    categorias,
    obras,
    alocacoes,
    registros,
    detalhes: detalhesRes.data as unknown as Array<
      DetalheJornadaVisual & { registro_horas_id: string }
    >,
    feriados: (feriadosRes.data as unknown as Array<{ data: string }>).map((item) => item.data),
    vigenciasRegime: regimes.map((vigencia) => ({
      funcionarioId: vigencia.funcionario_id,
      regime: vigencia.regime,
      vigenciaInicio: vigencia.vigencia_inicio,
      vigenciaFim: vigencia.vigencia_fim,
    })),
    vigenciasCentroCusto: vigenciasCentroCusto.map((vigencia) => ({
      funcionarioId: vigencia.funcionario_id,
      obraId: vigencia.obra_id,
      vigenciaInicio: vigencia.vigencia_inicio,
      vigenciaFim: vigencia.vigencia_fim,
      origem: vigencia.origem,
      observacao: vigencia.observacao,
    })),
    alocacoesReferenciaRegime: alocacoesReferenciaRegime.map((alocacao) => ({
      funcionarioId: alocacao.funcionario_id,
      obraId: alocacao.obra_id,
      data: alocacao.data,
    })),
    alocacoesReferenciaClassificacao: [...alocacoesAnteriores, ...alocacoes],
  };
}

async function executarRelatorioAutorizado(input: {
  userId: string;
  competencia: string;
  rolesPermitidas: readonly Role[];
  incluirProjecaoFolha: boolean;
  mensagemProibido: string;
}) {
  const roles = await carregarRoles(input.userId);
  return executarProcessamentoFinanceiroAutorizado({
    roles,
    rolesPermitidas: input.rolesPermitidas,
    mensagemProibido: input.mensagemProibido,
    incluirProjecaoFolha: input.incluirProjecaoFolha,
    carregarEntrada: () =>
      carregarEntradaRelatorioFinanceiro(input.competencia, input.incluirProjecaoFolha),
  });
}

export const getRelatorioCentrosCusto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<RelatorioCentrosCustoDTO> => {
    const { entrada, processamento } = await executarRelatorioAutorizado({
      userId: context.userId,
      competencia: data.competencia,
      rolesPermitidas: ROLES_CENTRO_CUSTO,
      incluirProjecaoFolha: false,
      mensagemProibido: "Forbidden: relatório indisponível para este perfil",
    });
    return montarRelatorioCentrosCustoDTO(entrada, processamento);
  });

export const getRelatorioFinanceiroCompleto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<RelatorioFinanceiroCompletoDTO> => {
    const { entrada, processamento } = await executarRelatorioAutorizado({
      userId: context.userId,
      competencia: data.competencia,
      rolesPermitidas: ROLES_FINANCEIRO_COMPLETO,
      incluirProjecaoFolha: true,
      mensagemProibido: "Forbidden: relatório financeiro restrito a gerente e diretor",
    });
    if (!processamento.projecaoFolha)
      throw new Error("Projeção financeira indisponível para a solicitação autorizada");
    return {
      ...montarRelatorioCentrosCustoDTO(entrada, processamento),
      funcionarios: processamento.projecaoFolha,
    };
  });
