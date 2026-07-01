import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CategoriaTipo = "MOI" | "MOD";
export type Categoria = { nome: string; tipo: CategoriaTipo };

export function useCategorias() {
  return useQuery({
    queryKey: ["categorias"],
    queryFn: async (): Promise<Categoria[]> => {
      const { data, error } = await supabase
        .from("categorias" as any)
        .select("nome, tipo")
        .order("tipo", { ascending: true })
        .order("nome", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown) as Categoria[];
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
