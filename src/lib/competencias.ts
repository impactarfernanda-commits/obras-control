import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export const MENSAGEM_COMPETENCIA_FECHADA =
  "Competência fechada. Solicite reabertura ao gerente para alterar este período.";

export type CompetenciaPeriodo = {
  competencia: string;
  data_inicio: string;
  data_fim: string;
};

export type FechamentoCompetencia = CompetenciaPeriodo & {
  id: string;
  fechada: boolean;
  fechado_por: string | null;
  fechado_em: string | null;
  reaberto_por: string | null;
  reaberto_em: string | null;
  motivo_reabertura: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseLike = SupabaseClient<Database>;
type ErrorLike = { code?: string; message?: string; details?: string; hint?: string };

function pad(n: number) {
  return n < 10 ? "0" + n : String(n);
}

function isoDateLocal(d: Date) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function calcularCompetencia(dateISO: string): CompetenciaPeriodo {
  const [year, month, day] = dateISO.split("-").map(Number);
  const competenciaBase = new Date(year, month - 1, 1);
  if (day >= 25) competenciaBase.setMonth(competenciaBase.getMonth() + 1);

  const competencia = competenciaBase.getFullYear() + "-" + pad(competenciaBase.getMonth() + 1);
  const inicio = new Date(competenciaBase.getFullYear(), competenciaBase.getMonth() - 1, 25);
  const fim = new Date(competenciaBase.getFullYear(), competenciaBase.getMonth(), 24);

  return {
    competencia,
    data_inicio: isoDateLocal(inicio),
    data_fim: isoDateLocal(fim),
  };
}

export function formatarPeriodoCompetencia(
  c: Pick<CompetenciaPeriodo, "data_inicio" | "data_fim">,
) {
  const inicio = new Date(c.data_inicio + "T00:00:00").toLocaleDateString("pt-BR");
  const fim = new Date(c.data_fim + "T00:00:00").toLocaleDateString("pt-BR");
  return inicio + " a " + fim;
}

function tabelaFechamentos(supabase: SupabaseLike) {
  return supabase.from("fechamentos_competencia" as never);
}

export async function buscarFechamentosPorCompetencia(
  supabase: SupabaseLike,
  competencias: string[],
) {
  if (competencias.length === 0) return [] as FechamentoCompetencia[];

  const { data, error } = await tabelaFechamentos(supabase)
    .select("*")
    .in("competencia", competencias);
  if (error) throw error;
  return (data ?? []) as unknown as FechamentoCompetencia[];
}

export async function buscarCompetenciasFechadasPorDatas(supabase: SupabaseLike, datas: string[]) {
  const periodos = new Map<string, CompetenciaPeriodo>();
  for (const data of datas) {
    const periodo = calcularCompetencia(data);
    periodos.set(periodo.competencia, periodo);
  }

  const fechamentos = await buscarFechamentosPorCompetencia(supabase, Array.from(periodos.keys()));
  return fechamentos.filter((f) => f.fechada);
}

export async function garantirCompetenciaAberta(supabase: SupabaseLike, data: string) {
  const fechadas = await buscarCompetenciasFechadasPorDatas(supabase, [data]);
  if (fechadas.length > 0) throw new Error(MENSAGEM_COMPETENCIA_FECHADA);
}

export function mensagemErroCompetenciaFechada(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const err = error as ErrorLike;
  const texto = [err.message, err.details, err.hint].filter(Boolean).join(" ");
  return texto.includes(MENSAGEM_COMPETENCIA_FECHADA) ? MENSAGEM_COMPETENCIA_FECHADA : null;
}
