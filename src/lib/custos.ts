import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { beneficiosOuZero, logConfigQueryError } from "@/lib/configuracoes-runtime";
import type { Beneficios } from "@/lib/custos-core";

export * from "@/lib/custos-core";

export function useBeneficios(options?: { configContext?: boolean; enabled?: boolean }) {
  return useQuery({
    queryKey: ["beneficios_config"],
    enabled: options?.enabled ?? true,
    queryFn: async (): Promise<Beneficios> => {
      const { data, error } = await supabase.from("beneficios_config").select("*").maybeSingle();
      if (error) {
        if (options?.configContext) logConfigQueryError("beneficios_config", error);
        throw error;
      }
      return beneficiosOuZero(data as Partial<Beneficios> | null);
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
        .select("categoria, seguro_vida");
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of data ?? []) m.set(r.categoria, Number(r.seguro_vida ?? 0));
      return m;
    },
  });
}

export function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
