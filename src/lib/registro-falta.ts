export const TIPOS_REGISTRO = ["horas", "falta"] as const;
export type TipoRegistro = (typeof TIPOS_REGISTRO)[number];

export const CLASSIFICACOES_FALTA = [
  { value: "nao_justificada", label: "Falta não justificada" },
  { value: "justificada", label: "Falta justificada" },
  { value: "atestado", label: "Atestado" },
  { value: "suspensao", label: "Suspensão" },
  { value: "afastamento", label: "Afastamento" },
  { value: "outro", label: "Outro" },
] as const;

export type FaltaTipo = (typeof CLASSIFICACOES_FALTA)[number]["value"];

export const AVISO_FALTA_INTEGRAL =
  "Use esta opção somente para falta integral. Para ausência parcial, registre as horas efetivamente trabalhadas.";

export function rotuloFalta(tipo: string | null | undefined) {
  return CLASSIFICACOES_FALTA.find((item) => item.value === tipo)?.label ?? "Falta";
}

export function totalHorasRegistro(registro: {
  horas_normais?: number | null;
  horas_extras?: number | null;
}) {
  return Number(registro.horas_normais || 0) + Number(registro.horas_extras || 0);
}

export function registroEhFalta(registro: {
  tipo_registro?: string | null;
  ausencia?: boolean | null;
}) {
  return registro.tipo_registro === "falta";
}

export function validarRegistroApontamento(registro: {
  tipo_registro: TipoRegistro;
  falta_tipo?: string | null;
  horas_normais?: number | null;
  horas_extras?: number | null;
}) {
  if (registro.tipo_registro === "falta") {
    if (!CLASSIFICACOES_FALTA.some(({ value }) => value === registro.falta_tipo)) {
      return "Selecione a classificação da falta.";
    }
    if (totalHorasRegistro(registro) > 0) return "Uma falta integral não pode conter horas.";
    return null;
  }
  if (registro.falta_tipo) return "Horas trabalhadas não podem ter classificação de falta.";
  if (totalHorasRegistro(registro) <= 0) {
    return "Informe um total de horas trabalhadas maior que zero.";
  }
  return null;
}

export function mensagemErroRegistro(error: { message?: string } | null | undefined) {
  const message = error?.message ?? "";
  if (message.includes("REGISTRO_FALTA_JA_EXISTE")) {
    return "Este funcionário já possui uma falta registrada nesta data.";
  }
  if (message.includes("REGISTRO_HORAS_JA_EXISTE")) {
    return "Este funcionário já possui horas registradas nesta data. Corrija ou cancele os apontamentos antes de registrar a falta.";
  }
  if (message.includes("REGISTRO_HORAS_ZERO")) {
    return "Informe um total de horas trabalhadas maior que zero.";
  }
  if (message.includes("REGISTRO_FALTA_CLASSIFICACAO")) {
    return "Selecione a classificação da falta.";
  }
  return message || "Não foi possível salvar o apontamento.";
}

export async function buscarConflitoRegistroDiario(
  supabase: SupabaseClient<Database>,
  registro: {
    id?: string;
    funcionario_id: string;
    data: string;
    tipo_registro: TipoRegistro;
  },
) {
  const { data, error } = await supabase
    .from("registros_horas")
    .select("id,tipo_registro,horas_normais,horas_extras")
    .eq("funcionario_id", registro.funcionario_id)
    .eq("data", registro.data);
  if (error) throw error;
  const outros = data.filter((item) => item.id !== registro.id);
  if (
    registro.tipo_registro === "falta" &&
    outros.some(
      (item) =>
        item.tipo_registro === "horas" &&
        Number(item.horas_normais || 0) + Number(item.horas_extras || 0) > 0,
    )
  ) {
    return mensagemErroRegistro({ message: "REGISTRO_HORAS_JA_EXISTE" });
  }
  if (
    outros.some((item) => item.tipo_registro === "falta") &&
    (registro.tipo_registro === "horas" || registro.tipo_registro === "falta")
  ) {
    return mensagemErroRegistro({ message: "REGISTRO_FALTA_JA_EXISTE" });
  }
  return null;
}
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
