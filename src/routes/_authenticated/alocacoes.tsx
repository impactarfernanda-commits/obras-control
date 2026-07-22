import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertTriangle,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RegistrosGrid } from "@/components/RegistrosGrid";
import { buscarTodasPaginas } from "@/lib/paginacao";
import { AlocarPeriodoDialog } from "@/components/AlocarPeriodoDialog";
import { ImportarPlanilhaLegadoDialog } from "@/components/ImportarPlanilhaLegadoDialog";
import {
  buscarConflitoAlocacao,
  criarErroConflitoAlocacao,
  erroBancoAlocacao,
  isAlocacaoConflitoError,
  mensagemErroBancoAlocacao,
  type MensagemAlocacaoConflito,
} from "@/lib/alocacoes-conflitos";
import {
  calcularCompetencia,
  formatarPeriodoCompetencia,
  garantirCompetenciaAberta,
  mensagemErroCompetenciaFechada,
} from "@/lib/competencias";

export const Route = createFileRoute("/_authenticated/alocacoes")({
  component: AlocacoesPage,
});

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Total trabalhado em horas, já descontando 1h fixa de almoço. */
function totalHorasTrabalhadas(entrada: string, saida: string): number {
  if (!timeRegex.test(entrada) || !timeRegex.test(saida)) return 0;
  const diff = parseTimeToMinutes(saida) - parseTimeToMinutes(entrada);
  if (diff <= 0) return 0;
  const horas = diff / 60 - 1; // desconta 1h de almoço
  return Math.max(0, Math.round(horas * 100) / 100);
}

/** Jornada normal em horas para a data: 9h seg–qui, 8h sex, 0h fim de semana. */
function jornadaNormal(dateISO: string): number {
  const dow = new Date(dateISO + "T00:00:00").getDay();
  if (dow === 0 || dow === 6) return 0;
  if (dow === 5) return 8;
  return 9;
}

function calcHoras(entrada: string, saida: string, dateISO: string) {
  const total = totalHorasTrabalhadas(entrada, saida);
  const jornada = jornadaNormal(dateISO);
  const hn = Math.min(total, jornada);
  const he = Math.max(0, total - jornada);
  return {
    total,
    hn: Math.round(hn * 100) / 100,
    he: Math.round(he * 100) / 100,
  };
}

const schema = z
  .object({
    funcionario_id: z.string().uuid("Selecione um funcionário"),
    obra_id: z.string().uuid("Selecione um centro de custo"),
    data: z.string().min(1, "Data obrigatória"),
    hora_entrada: z.string().regex(timeRegex, "Horário inválido"),
    hora_saida: z.string().regex(timeRegex, "Horário inválido"),
    observacoes: z.string().optional(),
    justificativa_extras: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const total = totalHorasTrabalhadas(v.hora_entrada, v.hora_saida);
    if (total <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["hora_saida"],
        message: "Saída deve ser depois da entrada (descontado 1h de almoço)",
      });
      return;
    }
    const { he } = calcHoras(v.hora_entrada, v.hora_saida, v.data);
    if (he > 2 && !v.justificativa_extras?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["justificativa_extras"],
        message: "Justificativa obrigatória para mais de 2h extras",
      });
    }
  });
type FormVals = z.infer<typeof schema>;
type ErrorLike = { message?: string };

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function monthStart(y: number, m: number) {
  return `${y}-${pad(m + 1)}-01`;
}
function addDaysISO(dateISO: string, days: number) {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function monthLabel(y: number, m: number) {
  return new Date(y, m, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

type AlocRow = {
  id: string;
  data: string;
  funcionario_id: string;
  obra_id: string;
  obras: { id: string; nome: string } | null;
};

function AlocacoesPage() {
  const { user, isManagerOrAbove } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [obraFiltro, setObraFiltro] = useState<string>("all");
  const [alocacaoFeedback, setAlocacaoFeedback] = useState<MensagemAlocacaoConflito | null>(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed

  const competenciaPeriodo = useMemo(
    () => calcularCompetencia(monthStart(year, month)),
    [year, month],
  );
  const startISO = competenciaPeriodo.data_inicio;
  const endISO = competenciaPeriodo.data_fim;
  const mesKey = `${year}-${pad(month + 1)}`;
  const periodoLabel = formatarPeriodoCompetencia(competenciaPeriodo);

  const { data: funcionarios, error: funcionariosError } = useQuery({
    queryKey: ["funcionarios-alocacao-selecao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios_safe" as unknown as "funcionarios")
        .select("id,nome,categoria_mo,ativo,data_desligamento,deleted_at")
        .order("nome");
      if (error) throw error;
      return data as unknown as Array<{
        id: string;
        nome: string;
        categoria_mo: string | null;
        ativo: boolean;
        data_desligamento: string | null;
        deleted_at: string | null;
      }>;
    },
  });
  // Inclui inativos no select (com marcador) para permitir lançamentos retroativos.
  const funcionariosSelecionaveis = useMemo(
    () =>
      (funcionarios ?? [])
        .filter((f) => !f.deleted_at)
        .slice()
        .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome)),
    [funcionarios],
  );
  const infoById = useMemo(() => {
    const m = new Map<
      string,
      { nome: string; categoria: string; ativo: boolean; dataDesligamento: string | null }
    >();
    for (const f of funcionarios ?? [])
      m.set(f.id, {
        nome: f.nome,
        categoria: f.categoria_mo?.trim() || "Sem função",
        ativo: f.ativo,
        dataDesligamento: f.data_desligamento,
      });
    return m;
  }, [funcionarios]);
  const nomeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of funcionarios ?? []) m.set(f.id, f.nome);
    return m;
  }, [funcionarios]);

  const { data: obras, error: obrasError } = useQuery({
    queryKey: ["obras-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obras").select("id,nome").order("nome");
      if (error) throw error;
      return data as Array<{ id: string; nome: string }>;
    },
  });

  const {
    data: alocacoes,
    isLoading,
    error: alocacoesError,
  } = useQuery({
    queryKey: ["alocacoes-mes", mesKey, obraFiltro],
    queryFn: async () => {
      return buscarTodasPaginas<AlocRow>(async (from, to) => {
        let q = supabase
          .from("alocacoes")
          .select("id, data, funcionario_id, obra_id, obras(id,nome)")
          .gte("data", startISO)
          .lte("data", endISO)
          .order("data", { ascending: true })
          .order("funcionario_id", { ascending: true })
          .order("obra_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (obraFiltro !== "all") q = q.eq("obra_id", obraFiltro);
        return q;
      });
    },
  });

  const { data: registros, error: registrosError } = useQuery({
    queryKey: ["registros-mes", mesKey, obraFiltro],
    enabled: !!alocacoes && alocacoes.length > 0,
    queryFn: async () => {
      type RegistroResumo = {
        funcionario_id: string;
        obra_id: string;
        data: string;
        horas_normais: number;
        horas_extras: number;
      };
      return buscarTodasPaginas<RegistroResumo>(async (from, to) => {
        let q = supabase
          .from("registros_horas")
          .select("funcionario_id, obra_id, data, horas_normais, horas_extras")
          .gte("data", startISO)
          .lte("data", endISO)
          .order("data", { ascending: true })
          .order("funcionario_id", { ascending: true })
          .order("obra_id", { ascending: true })
          .range(from, to);
        if (obraFiltro !== "all") q = q.eq("obra_id", obraFiltro);
        return q;
      });
    },
  });

  const funcionarioIdsHistoricos = useMemo(
    () => Array.from(new Set((alocacoes ?? []).map((a) => a.funcionario_id))).sort(),
    [alocacoes],
  );
  const { data: funcionariosHistoricos, error: funcionariosHistoricosError } = useQuery({
    queryKey: ["funcionarios-historico-alocacoes", funcionarioIdsHistoricos],
    enabled: funcionarioIdsHistoricos.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios_safe" as unknown as "funcionarios")
        .select("id,nome,categoria_mo,ativo,data_desligamento")
        .in("id", funcionarioIdsHistoricos);
      if (error) throw error;
      return data;
    },
  });

  const infoHistoricoById = useMemo(() => {
    const infos = new Map(infoById);
    for (const f of funcionariosHistoricos ?? [])
      infos.set(f.id, {
        nome: f.nome,
        categoria: f.categoria_mo?.trim() || "Sem função",
        ativo: f.ativo,
        dataDesligamento: f.data_desligamento,
      });
    return infos;
  }, [infoById, funcionariosHistoricos]);

  useEffect(() => {
    const errs = [
      funcionariosError && `Funcionários: ${(funcionariosError as ErrorLike).message}`,
      funcionariosHistoricosError &&
        `Funcionários do histórico: ${(funcionariosHistoricosError as ErrorLike).message}`,
      obrasError && `Centros de custo: ${(obrasError as ErrorLike).message}`,
      alocacoesError && `Alocações: ${(alocacoesError as ErrorLike).message}`,
      registrosError && `Registros: ${(registrosError as ErrorLike).message}`,
    ].filter(Boolean) as string[];
    for (const m of errs) toast.error(m);
  }, [funcionariosError, funcionariosHistoricosError, obrasError, alocacoesError, registrosError]);

  const horasMap = useMemo(() => {
    const m = new Map<string, { hn: number; he: number }>();
    for (const r of registros ?? []) {
      m.set(`${r.funcionario_id}|${r.obra_id}|${r.data}`, {
        hn: Number(r.horas_normais),
        he: Number(r.horas_extras),
      });
    }
    return m;
  }, [registros]);

  // Cada funcionario aparece uma vez por obra, ainda que tenha alocacoes em varias datas.
  const porObra = useMemo(() => {
    const out = new Map<
      string,
      {
        nome: string;
        dias: Map<string, AlocRow[]>;
        funcs: Map<
          string,
          { nome: string; categoria: string; dias: Set<string>; hn: number; he: number }
        >;
      }
    >();
    for (const a of alocacoes ?? []) {
      const obraId = a.obra_id;
      const obraNome = a.obras?.nome ?? "—";
      if (!out.has(obraId)) out.set(obraId, { nome: obraNome, dias: new Map(), funcs: new Map() });
      const g = out.get(obraId)!;
      if (!g.dias.has(a.data)) g.dias.set(a.data, []);
      g.dias.get(a.data)!.push(a);
      const fId = a.funcionario_id;
      const info = infoHistoricoById.get(fId);
      if (!g.funcs.has(fId))
        g.funcs.set(fId, {
          nome: info?.nome ?? "—",
          categoria: info?.categoria ?? "Sem função",
          dias: new Set(),
          hn: 0,
          he: 0,
        });
      const fEntry = g.funcs.get(fId)!;
      fEntry.dias.add(a.data);
      const h = horasMap.get(`${fId}|${obraId}|${a.data}`);
      if (h) {
        fEntry.hn += h.hn;
        fEntry.he += h.he;
      }
    }
    return Array.from(out.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [alocacoes, horasMap, infoHistoricoById]);

  const competenciaDays = useMemo(() => {
    const days: string[] = [];
    for (let d = startISO; d <= endISO; d = addDaysISO(d, 1)) days.push(d);
    return days;
  }, [startISO, endISO]);

  const today = new Date().toISOString().slice(0, 10);
  const defaultFormValues: FormVals = {
    funcionario_id: "",
    obra_id: "",
    data: today,
    hora_entrada: "07:00",
    hora_saida: "17:00",
    observacoes: "",
    justificativa_extras: "",
  };
  const form = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: defaultFormValues,
  });
  const watchData = form.watch("data");
  const watchEntrada = form.watch("hora_entrada");
  const watchSaida = form.watch("hora_saida");
  const previa = useMemo(
    () => calcHoras(watchEntrada, watchSaida, watchData || today),
    [watchEntrada, watchSaida, watchData, today],
  );
  const previaDow = useMemo(
    () => new Date((watchData || today) + "T00:00:00").getDay(),
    [watchData, today],
  );
  const previaIsFds = previaDow === 0 || previaDow === 6;

  const createMutation = useMutation({
    mutationFn: async (v: FormVals) => {
      setAlocacaoFeedback(null);
      const { total, hn, he } = calcHoras(v.hora_entrada, v.hora_saida, v.data);
      if (total <= 0) throw new Error("Horário inválido");

      await garantirCompetenciaAberta(supabase, v.data);

      const conflito = await buscarConflitoAlocacao({
        supabase,
        funcionarioId: v.funcionario_id,
        obraId: v.obra_id,
        data: v.data,
      });
      if (conflito) throw criarErroConflitoAlocacao(conflito);

      const { error: alocErr } = await supabase.from("alocacoes").upsert(
        [
          {
            funcionario_id: v.funcionario_id,
            obra_id: v.obra_id,
            data: v.data,
            created_by: user?.id ?? null,
          },
        ],
        { onConflict: "funcionario_id,obra_id,data", ignoreDuplicates: true },
      );
      if (alocErr) {
        const erroAmigavel = erroBancoAlocacao(alocErr);
        if (erroAmigavel) throw erroAmigavel;
        throw new Error(
          mensagemErroCompetenciaFechada(alocErr) ??
            mensagemErroBancoAlocacao(alocErr) ??
            alocErr.message,
        );
      }

      const { error: regErr } = await supabase.from("registros_horas").upsert(
        [
          {
            funcionario_id: v.funcionario_id,
            obra_id: v.obra_id,
            data: v.data,
            horas_normais: hn,
            horas_extras: he,
            justificativa_extras: he > 0 ? v.justificativa_extras?.trim() || null : null,
            observacoes: v.observacoes?.trim() || null,
            ausencia: false,
            created_by: user?.id ?? null,
            updated_by: user?.id ?? null,
          },
        ],
        { onConflict: "funcionario_id,obra_id,data" },
      );
      if (regErr) throw new Error(mensagemErroCompetenciaFechada(regErr) ?? regErr.message);
      return { hn, he };
    },
    onSuccess: ({ hn, he }) => {
      toast.success(`Lançamento salvo: ${hn}h normais${he > 0 ? ` + ${he}h extras` : ""}`);
      qc.invalidateQueries({ queryKey: ["alocacoes-mes"] });
      qc.invalidateQueries({ queryKey: ["registros-mes"] });
      qc.invalidateQueries({ queryKey: ["alocacoes-current"] });
      qc.invalidateQueries({ queryKey: ["registros"] });
      setOpen(false);
      form.reset(defaultFormValues);
    },
    onError: (e: ErrorLike) => {
      if (isAlocacaoConflitoError(e)) {
        setAlocacaoFeedback({ title: e.title, description: e.description });
        toast.error(e.title, { description: e.description, duration: 10000 });
        return;
      }
      toast.error(e.message ?? "Erro ao salvar lançamento");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (a: {
      id: string;
      funcionario_id: string;
      obra_id: string;
      data: string;
    }) => {
      await garantirCompetenciaAberta(supabase, a.data);
      const { error } = await supabase.from("alocacoes").delete().eq("id", a.id);
      if (error) throw new Error(mensagemErroCompetenciaFechada(error) ?? error.message);
      const { error: regDelErr } = await supabase.from("registros_horas").delete().match({
        funcionario_id: a.funcionario_id,
        obra_id: a.obra_id,
        data: a.data,
      });
      if (regDelErr)
        throw new Error(mensagemErroCompetenciaFechada(regDelErr) ?? regDelErr.message);
    },
    onSuccess: () => {
      toast.success("Alocação removida");
      qc.invalidateQueries({ queryKey: ["alocacoes-mes"] });
      qc.invalidateQueries({ queryKey: ["registros-mes"] });
      qc.invalidateQueries({ queryKey: ["alocacoes-current"] });
      qc.invalidateQueries({ queryKey: ["registros"] });
    },
    onError: (e: ErrorLike) => toast.error(e.message ?? "Erro ao remover"),
  });

  const undoLastMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sessão expirada");
      const { data: last, error: selErr } = await supabase
        .from("alocacoes")
        .select("id, funcionario_id, obra_id, data")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (selErr) throw selErr;
      if (!last) throw new Error("Nenhum lançamento seu para desfazer");
      await garantirCompetenciaAberta(supabase, last.data);
      const nome = nomeById.get(last.funcionario_id) ?? "funcionário";
      const dataBr = new Date(last.data + "T00:00:00").toLocaleDateString("pt-BR");
      const ok = window.confirm(`Desfazer o último lançamento?\n\n${nome} em ${dataBr}`);
      if (!ok) return { skipped: true as const };
      const { error: delErr } = await supabase.from("alocacoes").delete().eq("id", last.id);
      if (delErr) throw new Error(mensagemErroCompetenciaFechada(delErr) ?? delErr.message);
      const { error: regDelErr } = await supabase.from("registros_horas").delete().match({
        funcionario_id: last.funcionario_id,
        obra_id: last.obra_id,
        data: last.data,
      });
      if (regDelErr)
        throw new Error(mensagemErroCompetenciaFechada(regDelErr) ?? regDelErr.message);
      return { skipped: false as const };
    },
    onSuccess: (res) => {
      if (res?.skipped) return;
      toast.success("Último lançamento desfeito");
      qc.invalidateQueries({ queryKey: ["alocacoes-mes"] });
      qc.invalidateQueries({ queryKey: ["registros-mes"] });
      qc.invalidateQueries({ queryKey: ["alocacoes-current"] });
      qc.invalidateQueries({ queryKey: ["registros"] });
    },
    onError: (e: ErrorLike) => toast.error(e.message ?? "Erro ao desfazer"),
  });

  function prevMonth() {
    const d = new Date(year, month - 1, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }
  function nextMonth() {
    const d = new Date(year, month + 1, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }
  function thisMonth() {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  return (
    <div>
      <PageHeader
        title="Alocações"
        description="Visualize as alocações agrupadas por centro de custo na competência 25-24."
        actions={
          <div className="flex gap-2">
            {isManagerOrAbove && <ImportarPlanilhaLegadoDialog />}
            <Button
              variant="outline"
              onClick={() => undoLastMutation.mutate()}
              disabled={undoLastMutation.isPending}
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Desfazer último
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <CalendarPlus className="mr-2 h-4 w-4" />
                  Nova alocação
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Lançar dia trabalhado</DialogTitle>
                  <DialogDescription>
                    Informe entrada e saída. Jornada normal: 9h seg–qui, 8h sex. Almoço de 1h
                    descontado automaticamente. Fim de semana conta como hora extra.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
                    className="space-y-4"
                  >
                    <FormField
                      control={form.control}
                      name="funcionario_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Funcionário</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {funcionariosSelecionaveis.map((f) => (
                                <SelectItem key={f.id} value={f.id}>
                                  {f.nome} — {f.categoria_mo?.trim() || "Sem função"}
                                  {!f.ativo ? " (inativo)" : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="obra_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Centro de custo</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(obras ?? []).map((o) => (
                                <SelectItem key={o.id} value={o.id}>
                                  {o.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="data"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Data</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="hora_entrada"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Hora de entrada</FormLabel>
                            <FormControl>
                              <Input type="time" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="hora_saida"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Hora de saída</FormLabel>
                            <FormControl>
                              <Input type="time" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="rounded-md border bg-muted/40 p-3 text-sm">
                      <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                        Cálculo automático (1h almoço descontada)
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">Total: {previa.total}h</Badge>
                        <Badge variant="outline">Normais: {previa.hn}h</Badge>
                        {previa.he > 0 && (
                          <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">
                            Extras: +{previa.he}h
                          </Badge>
                        )}
                      </div>
                      {previaIsFds && (
                        <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                          Fim de semana: todo o tempo trabalhado será contado como hora extra.
                        </div>
                      )}
                    </div>
                    {previa.he > 2 && (
                      <FormField
                        control={form.control}
                        name="justificativa_extras"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Justificativa para extras &gt; 2h</FormLabel>
                            <FormControl>
                              <Textarea rows={2} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <FormField
                      control={form.control}
                      name="observacoes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Observações (opcional)</FormLabel>
                          <FormControl>
                            <Textarea rows={2} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <DialogFooter>
                      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                        Cancelar
                      </Button>
                      <Button type="submit" disabled={createMutation.isPending}>
                        {createMutation.isPending ? "Salvando..." : "Salvar lançamento"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {alocacaoFeedback && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{alocacaoFeedback.title}</AlertTitle>
          <AlertDescription>{alocacaoFeedback.description}</AlertDescription>
        </Alert>
      )}

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" onClick={prevMonth} aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[220px] text-center text-sm font-medium capitalize">
              {monthLabel(year, month)}
              <div className="text-[11px] font-normal normal-case text-muted-foreground">
                {periodoLabel}
              </div>
            </div>
            <Button size="icon" variant="outline" onClick={nextMonth} aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={thisMonth}>
              Hoje
            </Button>
          </div>
          <div className="min-w-[220px]">
            <label className="text-xs text-muted-foreground">Filtrar por centro de custo</label>
            <Select value={obraFiltro} onValueChange={setObraFiltro}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os centros de custo</SelectItem>
                {(obras ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : porObra.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma alocação nesta competência.
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-3">
          {porObra.map((obra) => {
            const totalDias = obra.dias.size;
            const totalFuncs = obra.funcs.size;
            const funcsArr = Array.from(obra.funcs.entries())
              .map(([id, v]) => ({ id, ...v }))
              .sort((a, b) => a.nome.localeCompare(b.nome));
            const composicaoEquipe = Array.from(
              funcsArr.reduce((acc, f) => {
                acc.set(f.categoria, (acc.get(f.categoria) ?? 0) + 1);
                return acc;
              }, new Map<string, number>()),
            ).sort(([categoriaA, totalA], [categoriaB, totalB]) =>
              totalB === totalA ? categoriaA.localeCompare(categoriaB) : totalB - totalA,
            );
            const totalFuncoes = composicaoEquipe.length;
            return (
              <AccordionItem key={obra.id} value={obra.id} className="rounded-md border bg-card">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex w-full flex-wrap items-center justify-between gap-2 pr-2">
                    <div className="text-left">
                      <div className="font-semibold">{obra.nome}</div>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="secondary">
                        {totalDias} {totalDias === 1 ? "dia" : "dias"}
                      </Badge>
                      <Badge variant="outline">
                        {totalFuncs} {totalFuncs === 1 ? "funcionário" : "funcionários"}
                      </Badge>
                      <Badge variant="outline">
                        {totalFuncoes} {totalFuncoes === 1 ? "função" : "funções"}
                      </Badge>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="mb-4 rounded-md border bg-muted/20 p-3">
                    <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                      Composição da equipe
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {composicaoEquipe.map(([categoria, total]) => (
                        <Badge key={categoria} variant="secondary" className="font-normal">
                          {categoria}: {total}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Tabs defaultValue="calendario" className="w-full">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <TabsList>
                        <TabsTrigger value="calendario">Calendário</TabsTrigger>
                        <TabsTrigger value="grade">Grade semanal (horas)</TabsTrigger>
                      </TabsList>
                      <AlocarPeriodoDialog obraId={obra.id} obraNome={obra.nome} />
                    </div>

                    <TabsContent value="calendario" className="mt-3 space-y-4">
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                          Funcionários na competência
                        </div>
                        <ul className="divide-y rounded-md border">
                          {funcsArr.map((f) => (
                            <li
                              key={f.id}
                              className="flex items-center justify-between gap-2 p-2 text-sm"
                            >
                              <div className="min-w-0">
                                <div className="truncate font-medium">{f.nome}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {f.categoria}
                                </div>
                              </div>
                              <div className="flex flex-shrink-0 gap-1.5">
                                <Badge variant="secondary">{f.dias.size}d</Badge>
                                <Badge variant="outline">{f.hn}h</Badge>
                                {f.he > 0 && (
                                  <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">
                                    +{f.he}h
                                  </Badge>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                          Calendário
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
                          {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                            <div key={i}>{d}</div>
                          ))}
                        </div>
                        <div className="mt-1 grid grid-cols-7 gap-1">
                          {(() => {
                            const firstDow = new Date(startISO + "T00:00:00").getDay();
                            const blanks = Array.from({ length: firstDow });
                            return (
                              <>
                                {blanks.map((_, i) => (
                                  <div key={`b${i}`} />
                                ))}
                                {competenciaDays.map((d) => {
                                  const dayNum = Number(d.slice(-2));
                                  const items = obra.dias.get(d) ?? [];
                                  const count = items.length;
                                  const dow = new Date(d + "T00:00:00").getDay();
                                  const isWeekend = dow === 0 || dow === 6;
                                  const isToday = d === today;
                                  const base =
                                    "relative flex h-12 flex-col items-center justify-center rounded border text-xs transition-colors";
                                  const tone =
                                    count > 0
                                      ? "bg-primary/10 border-primary/30 hover:bg-primary/20 cursor-pointer"
                                      : isWeekend
                                        ? "bg-muted/30 text-muted-foreground/60"
                                        : "bg-background text-muted-foreground";
                                  const todayRing = isToday ? " ring-2 ring-primary/50" : "";
                                  if (count === 0) {
                                    return (
                                      <div key={d} className={`${base} ${tone}${todayRing}`}>
                                        <span>{dayNum}</span>
                                      </div>
                                    );
                                  }
                                  return (
                                    <Popover key={d}>
                                      <PopoverTrigger asChild>
                                        <button
                                          type="button"
                                          className={`${base} ${tone}${todayRing}`}
                                        >
                                          <span className="font-medium">{dayNum}</span>
                                          <span className="text-[10px] text-primary">{count}</span>
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-72 p-3" align="center">
                                        <div className="mb-2 text-xs font-medium">
                                          {new Date(d + "T00:00:00").toLocaleDateString("pt-BR", {
                                            weekday: "long",
                                            day: "2-digit",
                                            month: "long",
                                          })}
                                        </div>
                                        <ul className="space-y-2">
                                          {items.map((a) => {
                                            const h = horasMap.get(
                                              `${a.funcionario_id}|${a.obra_id}|${a.data}`,
                                            );
                                            return (
                                              <li
                                                key={a.id}
                                                className="flex items-center justify-between gap-2 rounded border p-2"
                                              >
                                                <div className="min-w-0 flex-1">
                                                  <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                                                    <span className="truncate">
                                                      {nomeById.get(a.funcionario_id) ?? "—"}
                                                    </span>
                                                    {infoById.get(a.funcionario_id)?.ativo ===
                                                      false && (
                                                      <span className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase text-muted-foreground">
                                                        Inativo
                                                      </span>
                                                    )}
                                                  </div>
                                                  <div className="truncate text-xs text-muted-foreground">
                                                    {infoHistoricoById.get(a.funcionario_id)
                                                      ?.categoria ?? "Sem função"}
                                                  </div>
                                                  <div className="mt-0.5 flex flex-wrap gap-1">
                                                    {h ? (
                                                      <>
                                                        <Badge
                                                          variant="secondary"
                                                          className="text-[10px]"
                                                        >
                                                          {h.hn}h
                                                        </Badge>
                                                        {h.he > 0 && (
                                                          <Badge className="bg-amber-500/15 text-amber-700 text-[10px] dark:text-amber-400">
                                                            +{h.he}h
                                                          </Badge>
                                                        )}
                                                      </>
                                                    ) : (
                                                      <Badge
                                                        variant="outline"
                                                        className="text-[10px] text-muted-foreground"
                                                      >
                                                        sem horas
                                                      </Badge>
                                                    )}
                                                  </div>
                                                </div>
                                                <Button
                                                  size="icon"
                                                  variant="ghost"
                                                  onClick={() =>
                                                    deleteMutation.mutate({
                                                      id: a.id,
                                                      funcionario_id: a.funcionario_id,
                                                      obra_id: a.obra_id,
                                                      data: a.data,
                                                    })
                                                  }
                                                  aria-label="Remover"
                                                >
                                                  <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      </PopoverContent>
                                    </Popover>
                                  );
                                })}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="grade" className="mt-3">
                      <RegistrosGrid
                        obraId={obra.id}
                        initialWeekStart={new Date(startISO + "T00:00:00")}
                      />
                    </TabsContent>
                  </Tabs>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
