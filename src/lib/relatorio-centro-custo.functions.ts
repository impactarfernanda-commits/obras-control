import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  calcularCusto,
  custoDoDia,
  diasUteisNoIntervalo,
  horasPadraoDoDia,
  type Beneficios,
} from "@/lib/custos-core";
import { tipoCategoria, type Categoria } from "@/lib/categorias-core";
import { buscarTodasPaginas } from "@/lib/paginacao";
import {
  consolidarCustosCentros,
  type AlocacaoRelatorio,
  type RegistroRelatorio,
} from "@/lib/relatorio-centro-custo";

type Role = "assistente" | "supervisor" | "coordenador" | "gerente" | "diretor";
type FuncionarioInterno = {
  id: string;
  nome: string;
  categoria_mo: string;
  salario: number | null;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
};
export type RelatorioCentrosCustoDTO = {
  competencia: string;
  periodoInicial: string;
  periodoFinal: string;
  centros: ReturnType<typeof consolidarCustosCentros>["centros"];
  avisos: string[];
};

const inputSchema = z.object({ competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) });

export function periodoFolha(competencia: string) {
  const [year, month] = competencia.split("-").map(Number);
  const localISO = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const startDate = new Date(year, month - 2, 25);
  const endDate = new Date(year, month - 1, 24);
  return { start: localISO(startDate), end: localISO(endDate), startDate, endDate };
}

export function montarRelatorioCentrosCusto(input: {
  competencia: string;
  funcionarios: FuncionarioInterno[];
  beneficios: Beneficios | null;
  seguros: Array<{ categoria: string; seguro_vida: number | null }>;
  categorias: Categoria[];
  obras: Array<{ id: string; nome: string }>;
  alocacoes: AlocacaoRelatorio[];
  registros: RegistroRelatorio[];
}): RelatorioCentrosCustoDTO {
  const periodo = periodoFolha(input.competencia);
  const funcionarios = input.funcionarios.filter(
    (f) => f.deleted_at == null && f.visivel_obras_control !== false,
  );
  const seguros = new Map(input.seguros.map((r) => [r.categoria, Number(r.seguro_vida ?? 0)]));
  const custos = new Map(
    funcionarios.map((f) => [
      f.id,
      calcularCusto(f.salario, input.beneficios, seguros.get(f.categoria_mo) ?? 0),
    ]),
  );
  const resultado = consolidarCustosCentros({
    alocacoes: input.alocacoes,
    registros: input.registros,
    funcionarios,
    custos,
    obras: new Map(input.obras.map((obra) => [obra.id, obra.nome])),
    diasUteis: diasUteisNoIntervalo(periodo.startDate, periodo.endDate),
    resolverTipo: (alocacao, funcionario) => {
      if (alocacao?.tipo_mao_obra === "montagem" || alocacao?.tipo_mao_obra === "civil")
        return "MOD";
      if (alocacao?.tipo_mao_obra === "indireta") return "MOI";
      return tipoCategoria(funcionario.categoria_mo, input.categorias) ?? "MOD";
    },
    calcularCustoBase: (args) => custoDoDia({ ...args, horasExtras: 0 }),
    horasNormaisPadrao: horasPadraoDoDia,
  });
  return {
    competencia: input.competencia,
    periodoInicial: periodo.start,
    periodoFinal: periodo.end,
    centros: resultado.centros.map((centro) => ({
      ...centro,
      linhas: centro.linhas.map((linha) => ({ ...linha })),
    })),
    avisos: [...resultado.avisos],
  };
}

export const getRelatorioCentrosCusto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<RelatorioCentrosCustoDTO> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const roleResult = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleResult.error) throw new Error(roleResult.error.message);
    const roles = (roleResult.data ?? []).map((row) => row.role as Role);
    if (!roles.some((role) => role === "coordenador" || role === "gerente" || role === "diretor"))
      throw new Error("Forbidden: relatório indisponível para este perfil");
    const periodo = periodoFolha(data.competencia);
    const [funcionarios, beneficiosRes, seguros, categorias, obras, alocacoes, registros] =
      await Promise.all([
        buscarTodasPaginas<FuncionarioInterno>((from, to) =>
          supabaseAdmin
            .from("funcionarios")
            .select("id,nome,categoria_mo,salario,deleted_at,visivel_obras_control")
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
        buscarTodasPaginas<AlocacaoRelatorio>((from, to) =>
          supabaseAdmin
            .from("alocacoes")
            .select("id,funcionario_id,obra_id,data,tipo_mao_obra" as never)
            .gte("data", periodo.start)
            .lte("data", periodo.end)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        buscarTodasPaginas<RegistroRelatorio>((from, to) =>
          supabaseAdmin
            .from("registros_horas")
            .select(
              "id,funcionario_id,obra_id,data,horas_normais,horas_extras,ausencia,tipo_registro,falta_tipo",
            )
            .gte("data", periodo.start)
            .lte("data", periodo.end)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ]);
    if (beneficiosRes.error) throw new Error(beneficiosRes.error.message);
    return montarRelatorioCentrosCusto({
      competencia: data.competencia,
      funcionarios,
      beneficios: beneficiosRes.data as Beneficios | null,
      seguros,
      categorias,
      obras,
      alocacoes,
      registros,
    });
  });
