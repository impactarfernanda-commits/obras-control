import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, AlertTriangle, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buscarTodasPaginas } from "@/lib/paginacao";

export const Route = createFileRoute("/_authenticated/registros")({
  component: RegistrosPage,
});

// ---------- helpers ----------
function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // Monday as start
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    return x;
  });
}
const DOW_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// ---------- payroll cycle (25 -> 24) ----------
type PayrollCycle = { start: Date; end: Date };
function payrollCycleOf(d: Date): PayrollCycle {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDate();
  const startYear = date.getFullYear();
  const startMonth = day >= 25 ? date.getMonth() : date.getMonth() - 1;
  const start = new Date(startYear, startMonth, 25);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 24);
  end.setHours(0, 0, 0, 0);
  return { start, end };
}
function addCycles(c: PayrollCycle, n: number): PayrollCycle {
  const ref = new Date(c.start.getFullYear(), c.start.getMonth() + n, 25);
  return payrollCycleOf(ref);
}
function cycleLabel(c: PayrollCycle): string {
  const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  return `${fmt(c.start)} — ${fmt(c.end)}`;
}

type Registro = {
  id?: string;
  funcionario_id: string;
  obra_id: string;
  data: string;
  horas_normais: number;
  horas_extras: number;
  justificativa_extras: string | null;
  ausencia: boolean;
  motivo_ausencia: string | null;
  observacoes: string | null;
};

type CellKey = string; // `${func_id}|${obra_id}|${date}`
const ck = (f: string, o: string, d: string): CellKey => `${f}|${o}|${d}`;

type CellStatus = "empty" | "ok" | "warn" | "error";
function cellStatus(r: Registro | undefined): CellStatus {
  if (!r) return "empty";
  if (r.ausencia) return "warn";
  const total = (r.horas_normais ?? 0) + (r.horas_extras ?? 0);
  if (total <= 0) return "empty";
  if (total > 16) return "error";
  if (r.horas_extras > 0 && r.horas_normais < 9) return "error";
  if (r.horas_extras > 2 && !r.justificativa_extras?.trim()) return "error";
  if (r.horas_extras > 0) return "warn";
  return "ok";
}

// ---------- page ----------
function RegistrosPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [obraId, setObraId] = useState<string>("");

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const firstDay = isoDate(days[0]);
  const lastDay = isoDate(days[6]);

  // Ciclo de folha (25 -> 24) que contém esta semana
  const cycle = useMemo(() => payrollCycleOf(days[3]), [days]);
  const cycleStartISO = isoDate(cycle.start);
  const cycleEndISO = isoDate(cycle.end);

  const { data: obras } = useQuery({
    queryKey: ["obras-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obras").select("id,nome").eq("visivel_obras_control", true).order("nome");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!obraId && obras && obras.length > 0) setObraId(obras[0].id);
  }, [obras, obraId]);

  // Mapa global de nomes via view segura (funcionarios_safe não expõe salário p/ assistente/supervisor)
  const { data: funcionariosAll } = useQuery({
    queryKey: ["funcionarios-registros-historico-global"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios_safe" as unknown as "funcionarios")
        .select("id,nome,categoria_mo")
        .order("nome");
      if (error) throw error;
      return data as unknown as Array<{ id: string; nome: string; categoria_mo: string | null }>;
    },
  });
  const infoById = useMemo(() => {
    const m = new Map<string, { nome: string; categoria_mo: string | null }>();
    for (const f of funcionariosAll ?? [])
      m.set(f.id, { nome: f.nome, categoria_mo: f.categoria_mo });
    return m;
  }, [funcionariosAll]);

  // Funcionários alocados nesta obra na semana
  const { data: alocacoes, isLoading: loadingAloc } = useQuery({
    enabled: !!obraId,
    queryKey: ["aloc-week", obraId, firstDay, lastDay],
    queryFn: async () =>
      buscarTodasPaginas<{ funcionario_id: string; data: string }>((from, to) =>
        supabase
          .from("alocacoes")
          .select("funcionario_id, data")
          .eq("obra_id", obraId)
          .gte("data", firstDay)
          .lte("data", lastDay)
          .order("data")
          .order("funcionario_id")
          .order("obra_id")
          .range(from, to),
      ),
  });

  const funcionarios = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; categoria_mo: string | null }>();
    for (const a of alocacoes ?? []) {
      const info = infoById.get(a.funcionario_id);
      if (info)
        map.set(a.funcionario_id, {
          id: a.funcionario_id,
          nome: info.nome,
          categoria_mo: info.categoria_mo,
        });
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [alocacoes, infoById]);

  const allocSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of alocacoes ?? []) s.add(`${a.funcionario_id}|${a.data}`);
    return s;
  }, [alocacoes]);

  // Registros existentes da semana
  const { data: registrosRemote, isLoading: loadingReg } = useQuery({
    enabled: !!obraId,
    queryKey: ["registros-week", obraId, firstDay, lastDay],
    queryFn: async () =>
      buscarTodasPaginas<Registro>((from, to) =>
        supabase
          .from("registros_horas")
          .select("*")
          .eq("obra_id", obraId)
          .gte("data", firstDay)
          .lte("data", lastDay)
          .order("data")
          .order("funcionario_id")
          .order("obra_id")
          .range(from, to),
      ),
  });

  // Resumo do ciclo de folha (25 -> 24)
  const { data: registrosCycle } = useQuery({
    enabled: !!obraId,
    queryKey: ["registros-cycle", obraId, cycleStartISO, cycleEndISO],
    queryFn: async () =>
      buscarTodasPaginas<Registro>((from, to) =>
        supabase
          .from("registros_horas")
          .select("*")
          .eq("obra_id", obraId)
          .gte("data", cycleStartISO)
          .lte("data", cycleEndISO)
          .order("data")
          .order("funcionario_id")
          .order("obra_id")
          .range(from, to),
      ),
  });

  const { data: alocCycle } = useQuery({
    enabled: !!obraId,
    queryKey: ["aloc-cycle", obraId, cycleStartISO, cycleEndISO],
    queryFn: async () =>
      buscarTodasPaginas<{ funcionario_id: string; data: string }>((from, to) =>
        supabase
          .from("alocacoes")
          .select("funcionario_id, data")
          .eq("obra_id", obraId)
          .gte("data", cycleStartISO)
          .lte("data", cycleEndISO)
          .order("data")
          .order("funcionario_id")
          .order("obra_id")
          .range(from, to),
      ),
  });

  // Estado local editável
  const [cells, setCells] = useState<Record<CellKey, Registro>>({});
  const [saving, setSaving] = useState<Record<CellKey, "idle" | "saving" | "saved" | "error">>({});

  // hydrate from remote
  useEffect(() => {
    if (!registrosRemote) return;
    setCells((prev) => {
      const next = { ...prev };
      for (const r of registrosRemote) {
        const key = ck(r.funcionario_id, r.obra_id, r.data);
        // Don't clobber an in-flight local edit
        if (saving[key] === "saving") continue;
        next[key] = r;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrosRemote]);

  // Realtime subscription
  useEffect(() => {
    if (!obraId) return;
    const channel = supabase
      .channel(`registros_horas_${obraId}_${firstDay}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "registros_horas", filter: `obra_id=eq.${obraId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["registros-week", obraId, firstDay, lastDay] });
          qc.invalidateQueries({
            queryKey: ["registros-cycle", obraId, cycleStartISO, cycleEndISO],
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [obraId, firstDay, lastDay, cycleStartISO, cycleEndISO, qc]);

  // Debounced save
  const timersRef = useRef<Record<CellKey, ReturnType<typeof setTimeout>>>({});
  const saveCell = useCallback(
    async (key: CellKey, r: Registro) => {
      setSaving((s) => ({ ...s, [key]: "saving" }));
      const total = (r.horas_normais ?? 0) + (r.horas_extras ?? 0);
      // Skip persisting completely empty rows that have no id
      if (!r.id && !r.ausencia && total === 0 && !r.observacoes?.trim()) {
        setSaving((s) => ({ ...s, [key]: "idle" }));
        return;
      }
      const payload: Database["public"]["Tables"]["registros_horas"]["Insert"] = {
        funcionario_id: r.funcionario_id,
        obra_id: r.obra_id,
        data: r.data,
        horas_normais: r.ausencia ? 0 : r.horas_normais,
        horas_extras: r.ausencia ? 0 : r.horas_extras,
        justificativa_extras: r.justificativa_extras?.trim() || null,
        ausencia: r.ausencia,
        motivo_ausencia: r.motivo_ausencia?.trim() || null,
        observacoes: r.observacoes?.trim() || null,
        updated_by: user?.id ?? null,
      };
      if (!r.id) payload.created_by = user?.id ?? null;

      const { data, error } = await supabase
        .from("registros_horas")
        .upsert(payload, { onConflict: "funcionario_id,obra_id,data" })
        .select()
        .single();
      if (error) {
        setSaving((s) => ({ ...s, [key]: "error" }));
        toast.error(error.message);
        return;
      }
      setCells((prev) => ({ ...prev, [key]: data as Registro }));
      setSaving((s) => ({ ...s, [key]: "saved" }));
      qc.invalidateQueries({ queryKey: ["registros-week", obraId] });
      qc.invalidateQueries({ queryKey: ["registros-cycle", obraId] });
      qc.invalidateQueries({ queryKey: ["registros-mes"] });
      setTimeout(() => {
        setSaving((s) => (s[key] === "saved" ? { ...s, [key]: "idle" } : s));
      }, 1200);
    },
    [user?.id, qc, obraId],
  );

  const updateCell = useCallback(
    (key: CellKey, patch: Partial<Registro>, base: Registro) => {
      const next: Registro = { ...base, ...patch };
      setCells((prev) => ({ ...prev, [key]: next }));
      if (timersRef.current[key]) clearTimeout(timersRef.current[key]);
      timersRef.current[key] = setTimeout(() => saveCell(key, next), 700);
    },
    [saveCell],
  );

  // ---------- weekly summary ----------
  const summary = useMemo(() => {
    return funcionarios.map((f) => {
      let normais = 0,
        extras = 0,
        ausencias = 0,
        dias = 0;
      for (const d of days) {
        const key = ck(f.id, obraId, isoDate(d));
        const r = cells[key];
        if (!r) continue;
        if (r.ausencia) ausencias++;
        else {
          normais += Number(r.horas_normais) || 0;
          extras += Number(r.horas_extras) || 0;
          if ((r.horas_normais || 0) + (r.horas_extras || 0) > 0) dias++;
        }
      }
      return { f, normais, extras, ausencias, dias, alerta: extras > 10 };
    });
  }, [funcionarios, cells, days, obraId]);

  // ---------- cycle summary (folha 25 -> 24) ----------
  const cycleSummary = useMemo(() => {
    const funcMap = new Map<string, { id: string; nome: string; categoria_mo: string | null }>();
    for (const a of alocCycle ?? []) {
      const info = infoById.get(a.funcionario_id);
      funcMap.set(a.funcionario_id, {
        id: a.funcionario_id,
        nome: info?.nome ?? "—",
        categoria_mo: info?.categoria_mo ?? null,
      });
    }
    const byFunc = new Map<
      string,
      { normais: number; extras: number; ausencias: number; dias: number }
    >();
    for (const r of registrosCycle ?? []) {
      const cur = byFunc.get(r.funcionario_id) ?? { normais: 0, extras: 0, ausencias: 0, dias: 0 };
      if (r.ausencia) cur.ausencias++;
      else {
        cur.normais += Number(r.horas_normais) || 0;
        cur.extras += Number(r.horas_extras) || 0;
        if ((r.horas_normais || 0) + (r.horas_extras || 0) > 0) cur.dias++;
      }
      byFunc.set(r.funcionario_id, cur);
      if (!funcMap.has(r.funcionario_id)) {
        const info = infoById.get(r.funcionario_id);
        funcMap.set(r.funcionario_id, {
          id: r.funcionario_id,
          nome: info?.nome ?? "—",
          categoria_mo: info?.categoria_mo ?? null,
        });
      }
    }
    return Array.from(funcMap.values())
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((f) => {
        const t = byFunc.get(f.id) ?? { normais: 0, extras: 0, ausencias: 0, dias: 0 };
        return { f, ...t, alerta: t.extras > 40 };
      });
  }, [alocCycle, registrosCycle, infoById]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Registros de horas"
        description="Apontamento diário por centro de custo com salvamento automático e colaboração em tempo real."
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[260px]">
            <label className="mb-1 block text-xs text-muted-foreground">Centro de custo</label>
            <Select value={obraId} onValueChange={setObraId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um centro de custo" />
              </SelectTrigger>
              <SelectContent>
                {(obras ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Ciclo de folha (25 → 24)
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  const prev = addCycles(cycle, -1);
                  setWeekStart(startOfWeek(prev.start));
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-[180px] text-center text-sm font-medium">
                {cycleLabel(cycle)}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  const next = addCycles(cycle, 1);
                  setWeekStart(startOfWeek(next.start));
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const cur = payrollCycleOf(new Date());
                  setWeekStart(startOfWeek(cur.start));
                }}
              >
                Atual
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Semana</label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  const d = new Date(weekStart);
                  d.setDate(d.getDate() - 7);
                  setWeekStart(d);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-[200px] text-center text-sm font-medium">
                {days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                {" — "}
                {days[6].toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  const d = new Date(weekStart);
                  d.setDate(d.getDate() + 7);
                  setWeekStart(d);
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWeekStart(startOfWeek(new Date()))}
              >
                Hoje
              </Button>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <LegendDot className="bg-emerald-500" /> Normal
            <LegendDot className="bg-amber-500" /> Horas extras
            <LegendDot className="bg-rose-500" /> Excesso/inválido
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Semana</CardTitle>
          <Badge variant="outline" className="font-normal">
            Ciclo: {cycleLabel(cycle)}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {!obraId ? (
            <div className="py-10 text-center text-muted-foreground">
              Selecione um centro de custo para começar.
            </div>
          ) : loadingAloc || loadingReg ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : funcionarios.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              Nenhum funcionário alocado neste centro de custo na semana selecionada.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="sticky left-0 z-10 w-56 bg-muted/30 px-3 py-2 text-left font-medium">
                      Funcionário
                    </th>
                    {days.map((d, i) => (
                      <th key={i} className="border-l px-2 py-2 text-center font-medium">
                        <div className="text-[11px] uppercase text-muted-foreground">
                          {DOW_LABELS[i]}
                        </div>
                        <div>
                          {d.getDate().toString().padStart(2, "0")}/
                          {(d.getMonth() + 1).toString().padStart(2, "0")}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {funcionarios.map((f) => (
                    <tr key={f.id} className="border-b last:border-b-0">
                      <td className="sticky left-0 z-10 w-56 bg-background px-3 py-2 font-medium">
                        <div>{f.nome}</div>
                        {f.categoria_mo && (
                          <div className="text-xs font-normal text-muted-foreground">
                            {f.categoria_mo}
                          </div>
                        )}
                      </td>
                      {days.map((d, i) => {
                        const dateStr = isoDate(d);
                        const key = ck(f.id, obraId, dateStr);
                        const base: Registro = cells[key] ?? {
                          funcionario_id: f.id,
                          obra_id: obraId,
                          data: dateStr,
                          horas_normais: 0,
                          horas_extras: 0,
                          justificativa_extras: null,
                          ausencia: false,
                          motivo_ausencia: null,
                          observacoes: null,
                        };
                        const isAlloc = allocSet.has(`${f.id}|${dateStr}`);
                        return (
                          <td key={i} className="border-l p-1 align-top">
                            <DayCell
                              registro={base}
                              alocado={isAlloc}
                              status={saving[key] ?? "idle"}
                              onChange={(patch) => updateCell(key, patch, base)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {obraId && funcionarios.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resumo semanal</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="px-3 py-2 font-medium">Funcionário</th>
                    <th className="px-3 py-2 text-right font-medium">Dias trab.</th>
                    <th className="px-3 py-2 text-right font-medium">H. normais</th>
                    <th className="px-3 py-2 text-right font-medium">H. extras</th>
                    <th className="px-3 py-2 text-right font-medium">Ausências</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={row.f.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-medium">
                        <div>{row.f.nome}</div>
                        {row.f.categoria_mo && (
                          <div className="text-xs font-normal text-muted-foreground">
                            {row.f.categoria_mo}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{row.dias}</td>
                      <td className="px-3 py-2 text-right">{row.normais.toFixed(2)}h</td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right",
                          row.alerta && "text-rose-600 font-semibold",
                        )}
                      >
                        {row.extras.toFixed(2)}h
                      </td>
                      <td className="px-3 py-2 text-right">{row.ausencias}</td>
                      <td className="px-3 py-2 text-right">
                        {(row.normais + row.extras).toFixed(2)}h
                      </td>
                      <td className="px-3 py-2">
                        {row.alerta ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> Horas extras excessivas
                          </Badge>
                        ) : row.extras > 0 ? (
                          <Badge className="bg-amber-500 text-white hover:bg-amber-500/90">
                            Com horas extras
                          </Badge>
                        ) : (
                          <Badge variant="outline">OK</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {obraId && cycleSummary.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Resumo do ciclo de folha</CardTitle>
            <Badge variant="outline" className="font-normal">
              {cycleLabel(cycle)}
            </Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="px-3 py-2 font-medium">Funcionário</th>
                    <th className="px-3 py-2 text-right font-medium">Dias trab.</th>
                    <th className="px-3 py-2 text-right font-medium">H. normais</th>
                    <th className="px-3 py-2 text-right font-medium">H. extras</th>
                    <th className="px-3 py-2 text-right font-medium">Ausências</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cycleSummary.map((row) => (
                    <tr key={row.f.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-medium">
                        <div>{row.f.nome}</div>
                        {row.f.categoria_mo && (
                          <div className="text-xs font-normal text-muted-foreground">
                            {row.f.categoria_mo}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{row.dias}</td>
                      <td className="px-3 py-2 text-right">{row.normais.toFixed(2)}h</td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right",
                          row.alerta && "text-rose-600 font-semibold",
                        )}
                      >
                        {row.extras.toFixed(2)}h
                      </td>
                      <td className="px-3 py-2 text-right">{row.ausencias}</td>
                      <td className="px-3 py-2 text-right">
                        {(row.normais + row.extras).toFixed(2)}h
                      </td>
                      <td className="px-3 py-2">
                        {row.alerta ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> Horas extras excessivas no ciclo
                          </Badge>
                        ) : row.extras > 0 ? (
                          <Badge className="bg-amber-500 text-white hover:bg-amber-500/90">
                            Com horas extras
                          </Badge>
                        ) : row.dias > 0 || row.ausencias > 0 ? (
                          <Badge variant="outline">OK</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Sem registros
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------- subcomponents ----------
function LegendDot({ className }: { className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full", className)} />;
}

function DayCell({
  registro,
  alocado,
  status,
  onChange,
}: {
  registro: Registro;
  alocado: boolean;
  status: "idle" | "saving" | "saved" | "error";
  onChange: (patch: Partial<Registro>) => void;
}) {
  const s = cellStatus(registro);
  const total = (Number(registro.horas_normais) || 0) + (Number(registro.horas_extras) || 0);
  const bg =
    s === "ok"
      ? "bg-emerald-500/10 border-emerald-500/40"
      : s === "warn"
        ? "bg-amber-500/10 border-amber-500/40"
        : s === "error"
          ? "bg-rose-500/10 border-rose-500/40"
          : "bg-card border-border";

  const needsJust = registro.horas_extras > 2 && !registro.justificativa_extras?.trim();
  const invalidExtras = registro.horas_extras > 0 && registro.horas_normais < 9;
  const overflow = total > 16;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex h-[68px] w-full flex-col items-center justify-center rounded-md border px-1 text-xs transition hover:ring-2 hover:ring-ring/40",
            bg,
            !alocado && "opacity-60",
          )}
          title={!alocado ? "Funcionário não está alocado neste dia" : undefined}
        >
          {registro.ausencia ? (
            <span className="font-semibold text-amber-700 dark:text-amber-400">Ausente</span>
          ) : total > 0 ? (
            <>
              <span className="text-base font-semibold leading-tight">{total.toFixed(1)}h</span>
              {registro.horas_extras > 0 && (
                <span className="text-[10px] text-amber-700 dark:text-amber-400">
                  +{Number(registro.horas_extras).toFixed(1)}h ext
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          <span className="absolute right-1 top-1">
            {status === "saving" && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
            {status === "saved" && <Check className="h-3 w-3 text-emerald-600" />}
            {status === "error" && <AlertTriangle className="h-3 w-3 text-rose-600" />}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="start">
        <div className="text-sm font-semibold">
          {new Date(registro.data + "T00:00:00").toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "2-digit",
            month: "long",
          })}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={registro.ausencia}
            onChange={(e) =>
              onChange({
                ausencia: e.target.checked,
                ...(e.target.checked
                  ? { horas_normais: 0, horas_extras: 0, justificativa_extras: null }
                  : {}),
              })
            }
          />
          Marcar ausência
        </label>

        {registro.ausencia ? (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Motivo da ausência *</label>
            <Input
              value={registro.motivo_ausencia ?? ""}
              onChange={(e) => onChange({ motivo_ausencia: e.target.value })}
              placeholder="Ex.: atestado médico, falta justificada..."
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Horas normais (máx 9)</label>
                <Input
                  type="number"
                  min={0}
                  max={9}
                  step={0.5}
                  value={registro.horas_normais}
                  onChange={(e) =>
                    onChange({
                      horas_normais: Math.max(0, Math.min(9, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Horas extras</label>
                <Input
                  type="number"
                  min={0}
                  max={7}
                  step={0.5}
                  value={registro.horas_extras}
                  onChange={(e) =>
                    onChange({
                      horas_extras: Math.max(0, Math.min(7, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>
            </div>

            {invalidExtras && (
              <p className="text-xs text-rose-600">
                Só é possível registrar horas extras se as normais atingirem 9h.
              </p>
            )}
            {overflow && (
              <p className="text-xs text-rose-600">Total diário não pode ultrapassar 16h.</p>
            )}

            {registro.horas_extras > 2 && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Justificativa das horas extras *
                </label>
                <Textarea
                  rows={2}
                  value={registro.justificativa_extras ?? ""}
                  onChange={(e) => onChange({ justificativa_extras: e.target.value })}
                  placeholder="Obrigatória quando extras > 2h"
                />
                {needsJust && <p className="text-xs text-rose-600">Justificativa obrigatória.</p>}
              </div>
            )}
          </>
        )}

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Observações</label>
          <Textarea
            rows={2}
            value={registro.observacoes ?? ""}
            onChange={(e) => onChange({ observacoes: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {status === "saving"
              ? "Salvando..."
              : status === "saved"
                ? "Salvo"
                : status === "error"
                  ? "Erro ao salvar"
                  : "Edições salvas automaticamente"}
          </span>
          {!alocado && <span className="text-amber-600">Sem alocação neste dia</span>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
