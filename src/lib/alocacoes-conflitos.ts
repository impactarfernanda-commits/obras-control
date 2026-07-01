import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type AlocacaoConflito = {
  id: string;
  data: string;
  funcionarioId: string;
  obraId: string;
  obraNome: string;
};

type AlocacaoComObra = {
  id: string;
  data: string;
  funcionario_id: string;
  obra_id: string;
  obras: { nome: string } | { nome: string }[] | null;
};

function nomeObra(obras: AlocacaoComObra["obras"]) {
  if (Array.isArray(obras)) return obras[0]?.nome ?? "obra sem nome";
  return obras?.nome ?? "obra sem nome";
}

function mapRow(row: AlocacaoComObra): AlocacaoConflito {
  return {
    id: row.id,
    data: row.data,
    funcionarioId: row.funcionario_id,
    obraId: row.obra_id,
    obraNome: nomeObra(row.obras),
  };
}

export function mensagemConflitoAlocacao(conflito: AlocacaoConflito) {
  return `Funcionário já lançado nesta data na obra: ${conflito.obraNome}. Não é permitido lançar o mesmo funcionário em duas obras no mesmo dia.`;
}

export async function buscarConflitoAlocacao(params: {
  supabase: SupabaseClient<Database>;
  funcionarioId: string;
  obraId: string;
  data: string;
}) {
  const conflitos = await buscarConflitosAlocacao({
    supabase: params.supabase,
    funcionarioId: params.funcionarioId,
    obraId: params.obraId,
    datas: [params.data],
  });
  return conflitos[0] ?? null;
}

export async function buscarConflitosAlocacao(params: {
  supabase: SupabaseClient<Database>;
  funcionarioId: string;
  obraId: string;
  datas: string[];
}) {
  if (params.datas.length === 0) return [];

  const { data, error } = await params.supabase
    .from("alocacoes")
    .select("id,data,funcionario_id,obra_id,obras(nome)")
    .eq("funcionario_id", params.funcionarioId)
    .in("data", params.datas);

  if (error) throw error;

  return ((data ?? []) as unknown as AlocacaoComObra[])
    .filter((row) => row.obra_id !== params.obraId)
    .map(mapRow)
    .sort((a, b) => a.data.localeCompare(b.data) || a.obraNome.localeCompare(b.obraNome));
}

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  constraint?: string;
};

const MENSAGEM_CONFLITO_BANCO =
  "Funcionário já lançado nesta data. Não é permitido lançar o mesmo funcionário em duas obras no mesmo dia.";

export function mensagemErroBancoAlocacao(error: unknown) {
  if (!error || typeof error !== "object") return null;

  const err = error as SupabaseErrorLike;
  const textoErro = [err.message, err.details, err.hint, err.constraint].filter(Boolean).join(" ");
  const violaConstraintFuncionarioData =
    err.code === "23505" &&
    (textoErro.includes("alocacoes_funcionario_data_unique") ||
      textoErro.includes("alocacoes_funcionario_id_data_key"));

  return violaConstraintFuncionarioData ? MENSAGEM_CONFLITO_BANCO : null;
}
