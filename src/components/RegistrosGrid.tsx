import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  buscarConflitoAlocacao,
  detalhesConflitoAlocacao,
  erroBancoAlocacao,
  mensagemErroBancoAlocacao,
  type MensagemAlocacaoConflito,
} from "@/lib/alocacoes-conflitos";
import { garantirCompetenciaAberta, mensagemErroCompetenciaFechada } from "@/lib/competencias";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buscarTodasPaginas } from "@/lib/paginacao";

// ---------- helpers ----------
function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day + 6) % 7;
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

type RegistroPayload = Omit<Registro, "id"> & {
  created_by?: string | null;
  updated_by: string | null;
};

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

type CellKey = string;
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

type Props = {
  obraId: string;
  /** Permite controlar a semana de fora (opcional). */
  initialWeekStart?: Date;
};

export function RegistrosGrid({ obraId, initialWeekStart }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(initialWeekStart ?? new Date()),
  );
  const initialWeekStartKey = initialWeekStart ? isoDate(startOfWeek(initialWeekStart)) : null;

  useEffect(() => {
    if (!initialWeekStartKey) return;
    setWeekStart(startOfWeek(new Date(initialWeekStartKey + "T00:00:00")));
  }, [initialWeekStartKey]);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const firstDay = isoDate(days[0]);
  const lastDay = isoDate(days[6]);

  // nomes seguros (visível a assistentes)
  const { data: funcionariosAll } = useQuery({
    queryKey: ["funcionarios-registros-selecao"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obras_control_funcionarios_safe");
      if (error) throw error;
      return data as unknown as Array<{
        id: string;
        nome: string;
        categoria_mo: string | null;
        ativo: boolean;
        data_desligamento: string | null;
        deleted_at: string | null;
        visivel_obras_control: boolean | null;
      }>;
    },
  });
  const infoById = useMemo(() => {
    const m = new Map<
      string,
      {
        nome: string;
        categoria_mo: string | null;
        ativo: boolean;
        dataDesligamento: string | null;
      }
    >();
    for (const f of funcionariosAll ?? [])
      m.set(f.id, {
        nome: f.nome,
        categoria_mo: f.categoria_mo,
        ativo: f.ativo,
        dataDesligamento: f.data_desligamento,
      });
    return m;
  }, [funcionariosAll]);
  const funcionariosAtivos = useMemo(
    () =>
      (funcionariosAll ?? [])
        .filter(
          (f) =>
            f.ativo &&
            !f.deleted_at &&
            f.visivel_obras_control !== false &&
            (!f.data_desligamento || f.data_desligamento > new Date().toISOString().slice(0, 10)),
        )
        .slice()
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    [funcionariosAll],
  );

  // alocações da obra na semana
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

  const idsHistoricos = useMemo(
    () => Array.from(new Set((alocacoes ?? []).map((a) => a.funcionario_id))).sort(),
    [alocacoes],
  );
  const { data: funcionariosHistoricos } = useQuery({
    queryKey: ["funcionarios-historico-registros-grid", idsHistoricos],
    enabled: idsHistoricos.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obras_control_funcionarios_por_ids", {
        p_ids: idsHistoricos,
      });
      if (error) throw error;
      return data;
    },
  });
  const infoHistoricoById = useMemo(() => {
    const result = new Map(infoById);
    for (const f of funcionariosHistoricos ?? [])
      result.set(f.id, {
        nome: f.nome,
        categoria_mo: f.categoria_mo,
        ativo: f.ativo,
        dataDesligamento: f.data_desligamento,
      });
    return result;
  }, [infoById, funcionariosHistoricos]);

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

  // funcionários a mostrar: alocados na semana
  const [extraIds, setExtraIds] = useState<string[]>([]);
  useEffect(() => {
    setExtraIds([]);
  }, [obraId, firstDay]);

  const funcionarios = useMemo(() => {
    type Row = {
      id: string;
      nome: string;
      categoria_mo: string | null;
      ativo: boolean;
      dataDesligamento: string | null;
    };
    const map = new Map<string, Row>();
    for (const a of alocacoes ?? []) {
      const info = infoHistoricoById.get(a.funcionario_id);
      if (info)
        map.set(a.funcionario_id, {
          id: a.funcionario_id,
          nome: info.nome,
          categoria_mo: info.categoria_mo,
          ativo: info.ativo,
          dataDesligamento: info.dataDesligamento,
        });
    }
    for (const id of extraIds) {
      if (!map.has(id)) {
        const info = infoHistoricoById.get(id);
        if (info)
          map.set(id, {
            id,
            nome: info.nome,
            categoria_mo: info.categoria_mo,
            ativo: info.ativo,
            dataDesligamento: info.dataDesligamento,
          });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [alocacoes, infoHistoricoById, extraIds]);

  const allocSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of alocacoes ?? []) s.add(`${a.funcionario_id}|${a.data}`);
    return s;
  }, [alocacoes]);

  // estado local editável
  const [cells, setCells] = useState<Record<CellKey, Registro>>({});
  const [saving, setSaving] = useState<Record<CellKey, "idle" | "saving" | "saved" | "error">>({});
  const [gridFeedback, setGridFeedback] = useState<MensagemAlocacaoConflito | null>(null);

  useEffect(() => {
    if (!registrosRemote) return;
    setCells((prev) => {
      const next = { ...prev };
      for (const r of registrosRemote) {
        const key = ck(r.funcionario_id, r.obra_id, r.data);
        if (saving[key] === "saving") continue;
        next[key] = r;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrosRemote]);

  const timersRef = useRef<Record<CellKey, ReturnType<typeof setTimeout>>>({});

  const saveCell = useCallback(
    async (key: CellKey, r: Registro) => {
      setSaving((s) => ({ ...s, [key]: "saving" }));
      setGridFeedback(null);
      const total = (r.horas_normais ?? 0) + (r.horas_extras ?? 0);
      const hasContent = r.ausencia || total > 0 || !!r.observacoes?.trim();

      if (!r.id && !hasContent) {
        setSaving((s) => ({ ...s, [key]: "idle" }));
        return;
      }

      // Garante alocação antes de gravar horas/ausência
      if (hasContent) {
        try {
          await garantirCompetenciaAberta(supabase, r.data);
        } catch (e) {
          setSaving((s) => ({ ...s, [key]: "error" }));
          toast.error(mensagemErroCompetenciaFechada(e) ?? (e as Error).message);
          return;
        }

        const conflito = await buscarConflitoAlocacao({
          supabase,
          funcionarioId: r.funcionario_id,
          obraId: r.obra_id,
          data: r.data,
        });
        if (conflito) {
          const mensagem = detalhesConflitoAlocacao(conflito);
          setSaving((s) => ({ ...s, [key]: "error" }));
          setGridFeedback(mensagem);
          toast.error(mensagem.title, { description: mensagem.description, duration: 10000 });
          return;
        }

        const { error: alocErr } = await supabase.from("alocacoes").upsert(
          [
            {
              funcionario_id: r.funcionario_id,
              obra_id: r.obra_id,
              data: r.data,
              created_by: user?.id ?? null,
            },
          ],
          {
            onConflict: "funcionario_id,obra_id,data",
            ignoreDuplicates: true,
          },
        );
        if (alocErr) {
          const erroAmigavel = erroBancoAlocacao(alocErr);
          setSaving((s) => ({ ...s, [key]: "error" }));
          if (erroAmigavel) {
            setGridFeedback({ title: erroAmigavel.title, description: erroAmigavel.description });
            toast.error(erroAmigavel.title, {
              description: erroAmigavel.description,
              duration: 10000,
            });
            return;
          }
          toast.error(
            mensagemErroCompetenciaFechada(alocErr) ??
              mensagemErroBancoAlocacao(alocErr) ??
              alocErr.message,
          );
          return;
        }
      }

      const payload: RegistroPayload = {
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
        toast.error(mensagemErroCompetenciaFechada(error) ?? error.message);
        return;
      }
      setCells((prev) => ({ ...prev, [key]: data as Registro }));
      setSaving((s) => ({ ...s, [key]: "saved" }));
      qc.invalidateQueries({ queryKey: ["aloc-week", obraId] });
      qc.invalidateQueries({ queryKey: ["alocacoes-mes"] });
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

  const availableToAdd = useMemo(() => {
    const present = new Set(funcionarios.map((f) => f.id));
    return funcionariosAtivos.filter((f) => !present.has(f.id));
  }, [funcionarios, funcionariosAtivos]);

  return (
    <div className="space-y-3">
      {gridFeedback && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{gridFeedback.title}</AlertTitle>
          <AlertDescription>{gridFeedback.description}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
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
            {days[0].toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
            })}
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
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            Hoje
          </Button>
        </div>

        {availableToAdd.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                + Adicionar funcionário
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="end">
              <div className="max-h-72 overflow-y-auto p-1">
                {availableToAdd.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() =>
                      setExtraIds((cur) => (cur.includes(f.id) ? cur : [...cur, f.id]))
                    }
                  >
                    {f.nome}
                    {!f.ativo ? (
                      <span className="ml-2 text-[10px] text-muted-foreground">(inativo)</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <LegendDot className="bg-emerald-500" /> Normal
          <LegendDot className="bg-amber-500" /> H. extras
          <LegendDot className="bg-rose-500" /> Excesso
        </div>
      </div>

      {loadingAloc || loadingReg ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : funcionarios.length === 0 ? (
        <div className="rounded-md border bg-muted/20 py-10 text-center text-sm text-muted-foreground">
          Nenhum funcionário alocado nesta semana. Use “+ Adicionar funcionário” para lançar horas —
          a alocação é criada automaticamente.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
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
                    <div className="flex items-center gap-2">
                      <span>{f.nome}</span>
                      {!f.ativo && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          Inativo
                        </span>
                      )}
                    </div>
                    {f.categoria_mo && (
                      <div className="text-xs font-normal text-muted-foreground">
                        {f.categoria_mo}
                      </div>
                    )}
                    {!f.ativo && f.dataDesligamento && (
                      <div className="text-[10px] text-muted-foreground">
                        Desligado em{" "}
                        {new Date(f.dataDesligamento + "T00:00:00").toLocaleDateString("pt-BR")}
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
                    const bloqueado =
                      !f.ativo && f.dataDesligamento != null && dateStr > f.dataDesligamento;
                    return (
                      <td key={i} className="border-l p-1 align-top">
                        {bloqueado ? (
                          <div
                            className="flex h-[68px] w-full items-center justify-center rounded-md border border-dashed bg-muted/30 px-1 text-[10px] text-muted-foreground"
                            title="Funcionário desligado nesta data"
                          >
                            —
                          </div>
                        ) : (
                          <DayCell
                            registro={base}
                            alocado={isAlloc}
                            status={saving[key] ?? "idle"}
                            onChange={(patch) => updateCell(key, patch, base)}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
          )}
          title={
            !alocado && total === 0 && !registro.ausencia
              ? "Sem alocação — lançar horas criará automaticamente"
              : undefined
          }
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
                  ? {
                      horas_normais: 0,
                      horas_extras: 0,
                      justificativa_extras: null,
                    }
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

        <div className="text-xs text-muted-foreground">
          {status === "saving"
            ? "Salvando..."
            : status === "saved"
              ? "Salvo"
              : status === "error"
                ? "Erro ao salvar"
                : "Edições salvas automaticamente"}
        </div>
      </PopoverContent>
    </Popover>
  );
}
