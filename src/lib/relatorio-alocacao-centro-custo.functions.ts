import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buscarTodasPaginas } from "@/lib/paginacao";
import type { LinhaDiariaAlocacaoCc } from "@/lib/relatorio-alocacao-centro-custo";

const inputSchema = z.object({
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  funcionarioId: z.string().uuid().nullable().optional(),
  obraId: z.string().uuid().nullable().optional(),
  categoria: z.string().trim().min(1).max(200).nullable().optional(),
  somentePendencias: z.boolean().optional().default(false),
});

export const getRelatorioAlocacaoCentroCusto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<LinhaDiariaAlocacaoCc[]> => {
    try {
      return await buscarTodasPaginas<LinhaDiariaAlocacaoCc>((inicio, fim) =>
        context.supabase
          .rpc(
            "relatorio_alocacao_centro_custo" as never,
            {
              p_competencia: `${data.competencia}-01`,
              p_funcionario_id: data.funcionarioId ?? null,
              p_obra_id: data.obraId ?? null,
              p_categoria: data.categoria ?? null,
              p_somente_pendencias: data.somentePendencias,
            } as never,
          )
          .range(inicio, fim),
      );
    } catch (error) {
      if (error instanceof Error) throw error;
      if (
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string" &&
        error.message.trim()
      )
        throw new Error(error.message);
      throw new Error("Não foi possível carregar o relatório.");
    }
  });
