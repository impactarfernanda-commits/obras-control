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
  .handler(async ({ data }): Promise<LinhaDiariaAlocacaoCc[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return buscarTodasPaginas<LinhaDiariaAlocacaoCc>((inicio, fim) =>
      supabaseAdmin
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
  });
