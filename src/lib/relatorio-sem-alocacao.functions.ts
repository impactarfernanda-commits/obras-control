import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buscarTodasPaginas } from "@/lib/paginacao";

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
};

const inputSchema = z.object({
  inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
    if (!roles.some((role) => role === "coordenador" || role === "gerente" || role === "diretor"))
      throw new Error("Forbidden: relatório indisponível para este perfil");

    const [funcionarios, alocacoes] = await Promise.all([
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
          .lte("data", data.fim)
          .order("data", { ascending: true })
          .order("funcionario_id", { ascending: true })
          .range(from, to),
      ),
    ]);
    return { funcionarios, alocacoes };
  });
