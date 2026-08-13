export type CategoriaTipo = "MOI" | "MOD";
export type Categoria = { nome: string; tipo: CategoriaTipo };
export function tipoCategoria(
  cat: string | null | undefined,
  categorias: Categoria[] | undefined | null,
): CategoriaTipo | null {
  if (!cat || !categorias) return null;
  return categorias.find((c) => c.nome === cat)?.tipo ?? null;
}
