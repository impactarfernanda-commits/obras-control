import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "../integrations/supabase/client.ts";
import type { Database } from "../integrations/supabase/types.ts";

export const REFERENCE_STALE_TIME = {
  categorias: 30 * 60 * 1000,
  feriados: 30 * 60 * 1000,
  obras: 5 * 60 * 1000,
  funcionarios: 5 * 60 * 1000,
} as const;

const scope = (userId: string | null | undefined) => userId ?? "signed-out";

export const referenceDataKeys = {
  root: ["reference-data"] as const,
  obrasRoot: () => [...referenceDataKeys.root, "obras"] as const,
  obrasMinimas: (userId: string | null | undefined) =>
    [...referenceDataKeys.obrasRoot(), "minimal", scope(userId)] as const,
  obrasCompletas: (userId: string | null | undefined) =>
    [...referenceDataKeys.obrasRoot(), "full", scope(userId)] as const,
  obrasComCodigo: (userId: string | null | undefined) =>
    [...referenceDataKeys.obrasRoot(), "id-nome-codigo", scope(userId)] as const,
  categoriasRoot: () => [...referenceDataKeys.root, "categorias"] as const,
  categorias: (userId: string | null | undefined) =>
    [...referenceDataKeys.categoriasRoot(), "nome-tipo", scope(userId)] as const,
  feriadosRoot: () => [...referenceDataKeys.root, "feriados"] as const,
  feriadosAtivos: (userId: string | null | undefined) =>
    [...referenceDataKeys.feriadosRoot(), "ativos-data", scope(userId)] as const,
  funcionariosRoot: () => [...referenceDataKeys.root, "funcionarios"] as const,
  funcionariosSeguros: (userId: string | null | undefined) =>
    [...referenceDataKeys.funcionariosRoot(), "safe-full", scope(userId)] as const,
};

export type ObraMinima = {
  id: string;
  nome: string;
  visivel_obras_control: boolean | null;
};

export type CategoriaReferencia = { nome: string; tipo: "MOI" | "MOD" };
export type FuncionarioSeguro =
  Database["public"]["Functions"]["obras_control_funcionarios_safe"]["Returns"][number];

export async function fetchObrasMinimas(): Promise<ObraMinima[]> {
  const { data, error } = await supabase
    .from("obras")
    .select("id,nome,visivel_obras_control")
    .order("nome");
  if (error) throw error;
  return data;
}

export async function fetchObrasCompletas() {
  const { data, error } = await supabase
    .from("obras")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchObrasComCodigo() {
  const { data, error } = await supabase.from("obras").select("id,nome,codigo").order("nome");
  if (error) throw error;
  return data;
}

export async function fetchCategorias(): Promise<CategoriaReferencia[]> {
  const { data, error } = await supabase
    .from("categorias")
    .select("nome, tipo")
    .order("tipo", { ascending: true })
    .order("nome", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({ nome: row.nome, tipo: row.tipo as "MOI" | "MOD" }));
}

export async function fetchFeriadosAtivos(): Promise<string[]> {
  const { data, error } = await supabase
    .from("feriados_obras_control")
    .select("data")
    .eq("ativo", true)
    .order("data");
  if (error) throw error;
  return data.map((item) => item.data);
}

export async function fetchFuncionariosSeguros(): Promise<FuncionarioSeguro[]> {
  const { data, error } = await supabase.rpc("obras_control_funcionarios_safe");
  if (error) throw error;
  return data;
}

export const obrasMinimasOptions = (userId: string | null | undefined) =>
  queryOptions({
    queryKey: referenceDataKeys.obrasMinimas(userId),
    queryFn: fetchObrasMinimas,
    staleTime: REFERENCE_STALE_TIME.obras,
    enabled: Boolean(userId),
  });

export const obrasCompletasOptions = (userId: string | null | undefined) =>
  queryOptions({
    queryKey: referenceDataKeys.obrasCompletas(userId),
    queryFn: fetchObrasCompletas,
    staleTime: REFERENCE_STALE_TIME.obras,
    enabled: Boolean(userId),
  });

export const obrasComCodigoOptions = (userId: string | null | undefined) =>
  queryOptions({
    queryKey: referenceDataKeys.obrasComCodigo(userId),
    queryFn: fetchObrasComCodigo,
    staleTime: REFERENCE_STALE_TIME.obras,
    enabled: Boolean(userId),
  });

export const categoriasOptions = (userId: string | null | undefined) =>
  queryOptions({
    queryKey: referenceDataKeys.categorias(userId),
    queryFn: fetchCategorias,
    staleTime: REFERENCE_STALE_TIME.categorias,
    enabled: Boolean(userId),
  });

export const feriadosAtivosOptions = (userId: string | null | undefined) =>
  queryOptions({
    queryKey: referenceDataKeys.feriadosAtivos(userId),
    queryFn: fetchFeriadosAtivos,
    staleTime: REFERENCE_STALE_TIME.feriados,
    enabled: Boolean(userId),
  });

export const funcionariosSegurosOptions = (userId: string | null | undefined) =>
  queryOptions({
    queryKey: referenceDataKeys.funcionariosSeguros(userId),
    queryFn: fetchFuncionariosSeguros,
    staleTime: REFERENCE_STALE_TIME.funcionarios,
    enabled: Boolean(userId),
  });

export function invalidateObras(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: referenceDataKeys.obrasRoot() });
}

export function invalidateCategorias(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: referenceDataKeys.categoriasRoot() });
}

export function invalidateFuncionarios(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: referenceDataKeys.funcionariosRoot() });
}

export function removeReferenceDataForUser(queryClient: QueryClient, userId: string) {
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === "reference-data" && query.queryKey.at(-1) === userId,
  });
}
