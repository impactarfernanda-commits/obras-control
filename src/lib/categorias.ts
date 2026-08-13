import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logConfigQueryError } from "@/lib/configuracoes-runtime";

export type CategoriaTipo = "MOI" | "MOD";
export type Categoria = { nome: string; tipo: CategoriaTipo };

export function useCategorias(options?: { configContext?: boolean; enabled?: boolean }) {
  return useQuery({
    queryKey: ["categorias"],
    enabled: options?.enabled ?? true,
    queryFn: async (): Promise<Categoria[]> => {
      const { data, error } = await supabase
        .from("categorias")
        .select("nome, tipo")
        .order("tipo", { ascending: true })
        .order("nome", { ascending: true });
      if (error) {
        if (options?.configContext) logConfigQueryError("categorias", error);
        throw error;
      }
      return (data ?? []).map((row) => ({ nome: row.nome, tipo: row.tipo as CategoriaTipo }));
    },
  });
}

export function tipoCategoria(
  cat: string | null | undefined,
  categorias: Categoria[] | undefined | null,
): CategoriaTipo | null {
  if (!cat || !categorias) return null;
  return categorias.find((c) => c.nome === cat)?.tipo ?? null;
}
