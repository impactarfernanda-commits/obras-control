export const TIPOS_REGISTRO = ["horas", "falta", "ferias", "folga_campo"] as const;
export type TipoRegistro = (typeof TIPOS_REGISTRO)[number];
export type TipoAusenciaPlanejada = Extract<TipoRegistro, "ferias" | "folga_campo">;

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

export function registroEhAusenciaPlanejada(registro: { tipo_registro?: string | null }) {
  return registro.tipo_registro === "ferias" || registro.tipo_registro === "folga_campo";
}

export function rotuloTipoRegistro(tipo: string | null | undefined) {
  if (tipo === "falta") return "Falta";
  if (tipo === "ferias") return "Férias";
  if (tipo === "folga_campo") return "Folga de campo";
  return "Horas trabalhadas";
}

export function enumerarDiasCorridos(inicio: string, fim: string): string[] {
  if (!inicio || !fim || fim < inicio) return [];
  const dias: string[] = [];
  const atual = new Date(inicio + "T00:00:00");
  const limite = new Date(fim + "T00:00:00");
  while (atual <= limite) {
    dias.push(
      `${atual.getFullYear()}-${String(atual.getMonth() + 1).padStart(2, "0")}-${String(
        atual.getDate(),
      ).padStart(2, "0")}`,
    );
    atual.setDate(atual.getDate() + 1);
  }
  return dias;
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
  if (registroEhAusenciaPlanejada(registro)) {
    if (totalHorasRegistro(registro) > 0) return "Uma ausência planejada não pode conter horas.";
    if (registro.falta_tipo) {
      return "Uma ausência planejada não pode ter classificação de falta.";
    }
    return null;
  }
  if (registro.falta_tipo) return "Horas trabalhadas não podem ter classificação de falta.";
  if (totalHorasRegistro(registro) <= 0) {
    return "Informe uma jornada válida com horas efetivamente trabalhadas.";
  }
  return null;
}

export function mensagemErroRegistro(error: { message?: string } | null | undefined) {
  const message = error?.message ?? "";
  if (message.includes("REGISTRO_FALTA_JA_EXISTE")) {
    return "Este funcionário já possui uma falta registrada nesta data.";
  }
  if (message.includes("REGISTRO_HORAS_JA_EXISTE")) {
    return "Existem horas trabalhadas lançadas para este funcionário no período selecionado.";
  }
  if (message.includes("REGISTRO_FERIAS_JA_EXISTE")) {
    return "Funcionário está de férias neste período.";
  }
  if (message.includes("REGISTRO_FOLGA_CAMPO_JA_EXISTE")) {
    return "Funcionário está em folga de campo neste período.";
  }
  if (message.includes("REGISTRO_AUSENCIA_JA_EXISTE")) {
    return "Funcionário já possui um registro de ausência no período selecionado.";
  }
  if (message.includes("PERIODO_AUSENCIA_INVALIDO")) {
    return "A data Até deve ser igual ou posterior à data De.";
  }
  if (message.includes("REGISTRO_HORAS_ZERO")) {
    return "Informe uma jornada válida com horas efetivamente trabalhadas.";
  }
  if (message.includes("REGISTRO_FALTA_CLASSIFICACAO")) {
    return "A classificação da falta é obrigatória.";
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
    registro.tipo_registro !== "horas" &&
    outros.some(
      (item) =>
        item.tipo_registro === "horas" &&
        Number(item.horas_normais || 0) + Number(item.horas_extras || 0) > 0,
    )
  ) {
    return mensagemErroRegistro({ message: "REGISTRO_HORAS_JA_EXISTE" });
  }
  const ausenciaExistente = outros.find((item) => item.tipo_registro !== "horas");
  if (registro.tipo_registro === "horas" && ausenciaExistente?.tipo_registro === "ferias") {
    return mensagemErroRegistro({ message: "REGISTRO_FERIAS_JA_EXISTE" });
  }
  if (registro.tipo_registro === "horas" && ausenciaExistente?.tipo_registro === "folga_campo") {
    return mensagemErroRegistro({ message: "REGISTRO_FOLGA_CAMPO_JA_EXISTE" });
  }
  if (
    ausenciaExistente &&
    (registro.tipo_registro === "horas" || registro.tipo_registro === "falta")
  ) {
    return mensagemErroRegistro({ message: "REGISTRO_FALTA_JA_EXISTE" });
  }
  if (ausenciaExistente && registro.tipo_registro !== "horas") {
    return mensagemErroRegistro({ message: "REGISTRO_AUSENCIA_JA_EXISTE" });
  }
  return null;
}
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
