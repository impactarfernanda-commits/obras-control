import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ENCARGOS_PCT = 0.368;

export type Beneficios = {
  assistencia_medica: number;
  assistencia_odontologica: number;
  vale_alimentacao: number;
  multibeneficio: number;
};

export const BENEFICIOS_ZERO: Beneficios = {
  assistencia_medica: 0,
  assistencia_odontologica: 0,
  vale_alimentacao: 0,
  multibeneficio: 0,
};

export function totalBeneficios(b: Beneficios | null | undefined): number {
  if (!b) return 0;
  return (
    Number(b.assistencia_medica || 0) +
    Number(b.assistencia_odontologica || 0) +
    Number(b.vale_alimentacao || 0) +
    Number(b.multibeneficio || 0)
  );
}

export type CustoBreakdown = {
  salario: number;
  encargos: number;
  prov13: number;
  provAvisoPrevio: number;
  provFerias: number;
  beneficios: number;
  seguroVida: number;
  total: number;
};

export function calcularCusto(
  salario: number | null | undefined,
  beneficios: Beneficios | null | undefined,
  seguroVida: number | null | undefined = 0,
): CustoBreakdown {
  const s = Number(salario || 0);
  const encargos = s * ENCARGOS_PCT;
  const prov13 = (s + encargos) / 12;
  const provAvisoPrevio = prov13;
  const provFerias = prov13 + prov13 / 3;
  const bnf = totalBeneficios(beneficios);
  const sv = Number(seguroVida || 0);
  const total = s + encargos + prov13 + provAvisoPrevio + provFerias + bnf + sv;
  return { salario: s, encargos, prov13, provAvisoPrevio, provFerias, beneficios: bnf, seguroVida: sv, total };
}

export function useBeneficios() {
  return useQuery({
    queryKey: ["beneficios_config"],
    queryFn: async (): Promise<Beneficios> => {
      const { data, error } = await supabase
        .from("beneficios_config" as any)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? {}) as any;
      return {
        assistencia_medica: Number(row.assistencia_medica ?? 0),
        assistencia_odontologica: Number(row.assistencia_odontologica ?? 0),
        vale_alimentacao: Number(row.vale_alimentacao ?? 0),
        multibeneficio: Number(row.multibeneficio ?? 0),
      };
    },
  });
}

export function useSegurosVida(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["seguros_vida"],
    enabled: options?.enabled ?? true,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase
        .from("categoria_salarios")
        .select("categoria, seguro_vida" as any);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as any[]) {
        m.set(r.categoria, Number(r.seguro_vida ?? 0));
      }
      return m;
    },
  });
}

export function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ============= Rateio por dias úteis =============

export const HE_MULTIPLICADOR = 1.5;

/** Conta dias úteis (seg–sex) no intervalo [start, end] inclusive. */
export function diasUteisNoIntervalo(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (d <= last) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) count += 1;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Horas padrão do dia: seg–qui = 9h, sex = 8h, sáb/dom = 0. */
export function horasPadraoDoDia(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  const dow = dt.getDay();
  if (dow >= 1 && dow <= 4) return 9;
  if (dow === 5) return 8;
  return 0;
}

export type DiaCustoInput = {
  custoMensal: number;
  diasUteis: number;
  dataISO: string;
  horasNormais?: number | null;
  horasExtras?: number | null;
  ausencia?: boolean | null;
};

/** Custo de um dia de alocação, incluindo HE com adicional de 50%. */
export function custoDoDia(input: DiaCustoInput): number {
  const { custoMensal, diasUteis, dataISO, horasNormais, horasExtras, ausencia } = input;
  if (ausencia) return 0;
  if (diasUteis <= 0 || custoMensal <= 0) return 0;
  const custoDiario = custoMensal / diasUteis;
  const padrao = horasPadraoDoDia(dataISO) || 9; // dia atípico (fim de semana alocado): trata como 9h
  // Sem registro de horas: assume jornada padrão integral
  if (horasNormais == null && horasExtras == null) return custoDiario;
  const hn = Number(horasNormais || 0);
  const he = Number(horasExtras || 0);
  const valorHora = custoDiario / padrao;
  return custoDiario * (hn / padrao) + valorHora * he * HE_MULTIPLICADOR;
}
