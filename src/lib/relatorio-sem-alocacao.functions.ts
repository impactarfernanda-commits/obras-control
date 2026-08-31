import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buscarTodasPaginas } from "@/lib/paginacao";
import {
  ultimasAlocacoesPorFuncionario,
  type AlocacaoHistorica,
} from "@/lib/relatorio-sem-alocacao";

type Role = "assistente" | "supervisor" | "coordenador" | "gerente" | "diretor";

export type FuncionarioSemAlocacaoDTO = {
  id: string;
  nome: string;
  categoria_mo: string;
  ativo: boolean;
  data_admissao: string | null;
  data_desligamento: string | null;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
};

export type RelatorioSemAlocacaoDTO = {
  funcionarios: FuncionarioSemAlocacaoDTO[];
  alocacoes: Array<{ funcionario_id: string; data: string }>;
  ultimasAlocacoes: Array<{
    funcionario_id: string;
    obra_id: string;
    obra_nome: string;
    data: string;
  }>;
  vigenciasCentroCusto: Array<{
    funcionario_id: string;
    obra_id: string;
    vigencia_inicio: string;
    vigencia_fim: string | null;
  }>;
};

const inputSchema = z.object({
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const getRelatorioSemAlocacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<RelatorioSemAlocacaoDTO> => {
    if (data.inicio > data.fim) throw new Error("Período inválido");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const roleResult = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleResult.error) throw new Error(roleResult.error.message);
    const roles = (roleResult.data ?? []).map((row) => row.role as Role);
    if (
      !roles.some(
        (role) =>
          role === "assistente" ||
          role === "supervisor" ||
          role === "coordenador" ||
          role === "gerente" ||
          role === "diretor",
      )
    )
      throw new Error("Forbidden: relatório indisponível para este perfil");

    if (data.referencia < data.inicio || data.referencia > data.fim)
      throw new Error("Data de referência fora do período");
    const [
      funcionarios,
      alocacoes,
      ausenciasPlanejadas,
      historicoAlocacoes,
      obras,
      vigenciasCentroCusto,
    ] = await Promise.all([
      buscarTodasPaginas<FuncionarioSemAlocacaoDTO>((from, to) =>
        supabaseAdmin
          .from("funcionarios")
          .select(
            "id,nome,categoria_mo,ativo,data_admissao,data_desligamento,deleted_at,visivel_obras_control",
          )
          .order("id", { ascending: true })
          .range(from, to),
      ),
      buscarTodasPaginas<{ funcionario_id: string; data: string }>((from, to) =>
        supabaseAdmin
          .from("alocacoes")
          .select("funcionario_id,data")
          .gte("data", data.inicio)
          .lte("data", data.referencia)
          .order("data", { ascending: true })
          .order("funcionario_id", { ascending: true })
          .range(from, to),
      ),
      buscarTodasPaginas<{ funcionario_id: string; data: string }>((from, to) =>
        supabaseAdmin
          .from("registros_horas")
          .select("funcionario_id,data")
          .in("tipo_registro", ["ferias", "folga_campo"])
          .gte("data", data.inicio)
          .lte("data", data.referencia)
          .order("data", { ascending: true })
          .order("funcionario_id", { ascending: true })
          .range(from, to),
      ),
      buscarTodasPaginas<AlocacaoHistorica>((from, to) =>
        supabaseAdmin
          .from("alocacoes")
          .select("funcionario_id,obra_id,data")
          .lte("data", data.referencia)
          .order("data", { ascending: false })
          .order("funcionario_id", { ascending: true })
          .range(from, to),
      ),
      buscarTodasPaginas<{ id: string; nome: string }>((from, to) =>
        supabaseAdmin
          .from("obras")
          .select("id,nome")
          .order("id", { ascending: true })
          .range(from, to),
      ),
      buscarTodasPaginas<{
        funcionario_id: string;
        obra_id: string;
        vigencia_inicio: string;
        vigencia_fim: string | null;
      }>(
        (from, to) =>
          supabaseAdmin
            .from("funcionario_cc_vigencias" as never)
            .select("funcionario_id,obra_id,vigencia_inicio,vigencia_fim" as never)
            .lte("vigencia_inicio" as never, data.referencia as never)
            .or(`vigencia_fim.is.null,vigencia_fim.gte.${data.inicio}` as never)
            .order("funcionario_id" as never)
            .order("vigencia_inicio" as never)
            .range(from, to) as never,
      ),
    ]);
    const cobertura = new Map<string, { funcionario_id: string; data: string }>();
    for (const item of [...alocacoes, ...ausenciasPlanejadas]) {
      cobertura.set(`${item.funcionario_id}|${item.data}`, item);
    }
    const obraNome = new Map(obras.map((obra) => [obra.id, obra.nome]));
    const ultimasAlocacoes = Array.from(
      ultimasAlocacoesPorFuncionario(historicoAlocacoes, data.referencia).values(),
      (alocacao) => ({
        ...alocacao,
        obra_nome: obraNome.get(alocacao.obra_id) ?? "Centro de custo não encontrado",
      }),
    );
    return {
      funcionarios,
      alocacoes: Array.from(cobertura.values()),
      ultimasAlocacoes,
      vigenciasCentroCusto,
    };
  });
