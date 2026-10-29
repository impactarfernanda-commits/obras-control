import { useQuery } from "@tanstack/react-query";
import { logConfigQueryError } from "@/lib/configuracoes-runtime";
import { useAuth } from "@/hooks/use-auth";
import { categoriasOptions, fetchCategorias } from "@/lib/reference-data";

export type CategoriaTipo = "MOI" | "MOD";
export type Categoria = { nome: string; tipo: CategoriaTipo };

export function useCategorias(options?: { configContext?: boolean; enabled?: boolean }) {
  const { user } = useAuth();
  const canonical = categoriasOptions(user?.id);
  return useQuery({
    ...canonical,
    enabled: Boolean(user?.id) && (options?.enabled ?? true),
    queryFn: async (): Promise<Categoria[]> => {
      try {
        return await fetchCategorias();
      } catch (error) {
        if (options?.configContext) logConfigQueryError("categorias", error);
        throw error;
      }
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
