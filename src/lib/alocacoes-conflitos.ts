import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type AlocacaoConflito = {
  id: string;
  data: string;
  funcionarioId: string;
  obraId: string;
  obraNome: string;
};

export type MensagemAlocacaoConflito = {
  title: string;
  description: string;
};

type AlocacaoComObra = {
  id: string;
  data: string;
  funcionario_id: string;
  obra_id: string;
  obras: { nome: string } | { nome: string }[] | null;
};

function nomeObra(obras: AlocacaoComObra["obras"]) {
  if (Array.isArray(obras)) return obras[0]?.nome ?? "centro de custo sem nome";
  return obras?.nome ?? "centro de custo sem nome";
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

function formatarDataBR(dataISO: string) {
  return new Date(dataISO + "T00:00:00").toLocaleDateString("pt-BR");
}

export const TITULO_CONFLITO_ALOCACAO = "Funcionário já alocado";

export function detalhesConflitoAlocacao(
  conflito?: AlocacaoConflito | null,
): MensagemAlocacaoConflito {
  if (conflito) {
    return {
      title: TITULO_CONFLITO_ALOCACAO,
      description: `Este funcionário já está alocado no centro de custo ${conflito.obraNome} em ${formatarDataBR(conflito.data)}. Remova ou ajuste a alocação existente antes de lançar uma nova.`,
    };
  }

  return {
    title: TITULO_CONFLITO_ALOCACAO,
    description:
      "Este funcionário já está alocado em outro centro de custo nesta data. Remova ou ajuste a alocação existente antes de lançar uma nova.",
  };
}

export function mensagemConflitoAlocacao(conflito: AlocacaoConflito) {
  return detalhesConflitoAlocacao(conflito).description;
}

export class AlocacaoConflitoError extends Error {
  title: string;
  description: string;

  constructor(message: MensagemAlocacaoConflito) {
    super(message.description);
    this.name = "AlocacaoConflitoError";
    this.title = message.title;
    this.description = message.description;
  }
}

export function criarErroConflitoAlocacao(conflito?: AlocacaoConflito | null) {
  return new AlocacaoConflitoError(detalhesConflitoAlocacao(conflito));
}

export function isAlocacaoConflitoError(error: unknown): error is AlocacaoConflitoError {
  return error instanceof AlocacaoConflitoError;
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

function textoErroBanco(error: SupabaseErrorLike) {
  return [error.message, error.details, error.hint, error.constraint].filter(Boolean).join(" ");
}

function pareceConflitoFuncionarioData(error: SupabaseErrorLike) {
  const textoErro = textoErroBanco(error).toLowerCase();
  if (error.code !== "23505") return false;

  return (
    textoErro.includes("alocacoes_funcionario_data_unique") ||
    textoErro.includes("alocacoes_funcionario_id_data_key") ||
    (textoErro.includes("alocacoes") &&
      textoErro.includes("funcionario_id") &&
      textoErro.includes("data")) ||
    (textoErro.includes("funcionario_id") &&
      textoErro.includes("data") &&
      textoErro.includes("duplicate key"))
  );
}

export function detalhesErroBancoAlocacao(error: unknown): MensagemAlocacaoConflito | null {
  if (!error || typeof error !== "object") return null;

  const err = error as SupabaseErrorLike;
  return pareceConflitoFuncionarioData(err) ? detalhesConflitoAlocacao() : null;
}

export function mensagemErroBancoAlocacao(error: unknown) {
  return detalhesErroBancoAlocacao(error)?.description ?? null;
}

export function erroBancoAlocacao(error: unknown) {
  const detalhes = detalhesErroBancoAlocacao(error);
  return detalhes ? new AlocacaoConflitoError(detalhes) : null;
}
