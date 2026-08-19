import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buscarTodasPaginas } from "@/lib/paginacao";
import { FuncionarioSearchSelect } from "@/components/FuncionarioSearchSelect";
import { dataLancamentoFutura, validarDataLancamento } from "@/lib/data-lancamento";
import { funcionarioElegivelNoPeriodo } from "@/lib/funcionarios";
import { payloadHorasPermitido } from "@/lib/jornada-horas";
import { comporHorasParaVisualizacao, type TipoHoraVisual } from "@/lib/horas-visualizacao";
import {
  AVISO_FALTA_INTEGRAL,
  CLASSIFICACOES_FALTA,
  buscarConflitoRegistroDiario,
  mensagemErroRegistro,
  registroEhAusenciaPlanejada,
  registroEhFalta,
  rotuloFalta,
  rotuloTipoRegistro,
  validarRegistroApontamento,
  type FaltaTipo,
  type TipoRegistro,
} from "@/lib/registro-falta";
import {
  inicioDaSemanaSegunda,
  ordenarFuncionariosPorTipoENome,
} from "@/lib/alocacoes-visualizacao";
import type { Categoria } from "@/lib/categorias-core";
import {
  categoriaEhAjudante,
  competenciaUsaSegmentacaoMod,
  resolverEspecialidadeAjudanteGrade,
  type EspecialidadeAjudante,
} from "@/lib/especialidade-ajudante";

// ---------- helpers ----------
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
  tipo_registro: TipoRegistro;
  falta_tipo: FaltaTipo | null;
  /** Estado local da Grade; pertence à alocação, não ao registro de horas. */
  especialidade_ajudante?: EspecialidadeAjudante | null;
};

type AlocacaoGrade = {
  funcionario_id: string;
  data: string;
  especialidade_ajudante: EspecialidadeAjudante | null;
};

type CellKey = string;
const ck = (f: string, o: string, d: string): CellKey => `${f}|${o}|${d}`;

type Props = {
  obraId: string;
  categorias: Categoria[] | undefined;
  /** Permite controlar a semana de fora (opcional). */
  initialWeekStart?: Date;
};

export function RegistrosGrid({ obraId, categorias, initialWeekStart }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() =>
    inicioDaSemanaSegunda(initialWeekStart ?? new Date()),
  );
  const initialWeekStartKey = initialWeekStart
    ? isoDate(inicioDaSemanaSegunda(initialWeekStart))
    : null;
  useEffect(() => {
    if (!initialWeekStartKey) return;
    setWeekStart(inicioDaSemanaSegunda(new Date(initialWeekStartKey + "T00:00:00")));
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
        data_admissao: string | null;
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
      ordenarFuncionariosPorTipoENome(
        (funcionariosAll ?? []).filter((f) => funcionarioElegivelNoPeriodo(f, firstDay, lastDay)),
        categorias,
        (funcionario) => funcionario.categoria_mo,
      ),
    [funcionariosAll, firstDay, lastDay, categorias],
  );

  // alocações da obra na semana
  const { data: alocacoes, isLoading: loadingAloc } = useQuery({
    enabled: !!obraId,
    queryKey: ["aloc-week", obraId, firstDay, lastDay],
    queryFn: async () =>
      buscarTodasPaginas<AlocacaoGrade>((from, to) =>
        supabase
          .from("alocacoes")
          .select("funcionario_id, data, especialidade_ajudante")
          .eq("obra_id", obraId)
          .gte("data", firstDay)
          .lte("data", lastDay)
          .order("data")
          .order("funcionario_id")
          .order("obra_id")
          .range(from, to),
      ),
  });

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

  const idsHistoricos = useMemo(
    () =>
      Array.from(
        new Set([
          ...(alocacoes ?? []).map((a) => a.funcionario_id),
          ...(registrosRemote ?? []).map((r) => r.funcionario_id),
        ]),
      ).sort(),
    [alocacoes, registrosRemote],
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
    for (const r of registrosRemote ?? []) {
      const info = infoHistoricoById.get(r.funcionario_id);
      if (info)
        map.set(r.funcionario_id, {
          id: r.funcionario_id,
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
    return ordenarFuncionariosPorTipoENome(
      Array.from(map.values()),
      categorias,
      (funcionario) => funcionario.categoria_mo,
    );
  }, [alocacoes, registrosRemote, infoHistoricoById, extraIds, categorias]);

  const allocSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of alocacoes ?? []) s.add(`${a.funcionario_id}|${a.data}`);
    return s;
  }, [alocacoes]);

  const especialidadePorAlocacao = useMemo(() => {
    const especialidades = new Map<string, EspecialidadeAjudante | null>();
    for (const alocacao of alocacoes ?? []) {
      especialidades.set(
        `${alocacao.funcionario_id}|${alocacao.data}`,
        alocacao.especialidade_ajudante,
      );
    }
    return especialidades;
  }, [alocacoes]);

  // estado local editável
  const [cells, setCells] = useState<Record<CellKey, Registro>>({});
  const [saving, setSaving] = useState<
    Record<CellKey, "idle" | "dirty" | "saving" | "saved" | "error">
  >({});
  const [gridFeedback, setGridFeedback] = useState<MensagemAlocacaoConflito | null>(null);

  useEffect(() => {
    if (!registrosRemote) return;
    setCells((prev) => {
      const next = { ...prev };
      for (const r of registrosRemote) {
        const key = ck(r.funcionario_id, r.obra_id, r.data);
        if (saving[key] === "saving" || saving[key] === "dirty") continue;
        next[key] = r;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrosRemote]);

  const saveCell = useCallback(
    async (key: CellKey, r: Registro) => {
      setSaving((s) => ({ ...s, [key]: "saving" }));
      setGridFeedback(null);
      try {
        if (!registroEhAusenciaPlanejada(r)) validarDataLancamento(r.data, "horas");
      } catch (error) {
        setSaving((s) => ({ ...s, [key]: "error" }));
        toast.error((error as Error).message);
        return;
      }
      const total = (r.horas_normais ?? 0) + (r.horas_extras ?? 0);
      const hasContent = registroEhFalta(r) || total > 0 || !!r.observacoes?.trim();

      if (!r.id && !hasContent) {
        setSaving((s) => ({ ...s, [key]: "idle" }));
        return;
      }

      // Ausência planejada vive somente em registros_horas; horas/falta continuam exigindo alocação.
      if (hasContent && !registroEhAusenciaPlanejada(r)) {
        const categoria = infoHistoricoById.get(r.funcionario_id)?.categoria_mo;
        const exigeEspecialidade =
          categoriaEhAjudante(categoria) && competenciaUsaSegmentacaoMod(r.data);
        const chaveAlocacao = `${r.funcionario_id}|${r.data}`;
        const alocacaoExistente = especialidadePorAlocacao.has(chaveAlocacao);
        const especialidadePersistida = especialidadePorAlocacao.get(chaveAlocacao);
        const especialidadeAjudante = resolverEspecialidadeAjudanteGrade(
          especialidadePersistida,
          r.especialidade_ajudante,
        );
        if (exigeEspecialidade && !especialidadeAjudante) {
          setSaving((s) => ({ ...s, [key]: "error" }));
          toast.error("Informe se o ajudante atuará em Civil ou Montagem.");
          return;
        }

        try {
          await garantirCompetenciaAberta(supabase, r.data);
        } catch (e) {
          setSaving((s) => ({ ...s, [key]: "error" }));
          toast.error(mensagemErroCompetenciaFechada(e) ?? (e as Error).message);
          return;
        }

        let alocErr: { message: string; code?: string | null } | null = null;
        if (!alocacaoExistente) {
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

          const resultado = await supabase.from("alocacoes").upsert(
            [
              {
                funcionario_id: r.funcionario_id,
                obra_id: r.obra_id,
                data: r.data,
                created_by: user?.id ?? null,
                especialidade_ajudante: exigeEspecialidade ? especialidadeAjudante : null,
              },
            ],
            {
              onConflict: "funcionario_id,obra_id,data",
              ignoreDuplicates: true,
            },
          );
          alocErr = resultado.error;
        } else if (exigeEspecialidade && !especialidadePersistida) {
          const resultado = await supabase
            .from("alocacoes")
            .update({ especialidade_ajudante: especialidadeAjudante })
            .eq("funcionario_id", r.funcionario_id)
            .eq("obra_id", r.obra_id)
            .eq("data", r.data);
          alocErr = resultado.error;
        }
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

      const erroValidacao = validarRegistroApontamento(r);
      if (erroValidacao) {
        setSaving((s) => ({ ...s, [key]: "error" }));
        toast.error(erroValidacao);
        return;
      }

      const conflitoRegistro = await buscarConflitoRegistroDiario(supabase, r);
      if (conflitoRegistro) {
        setSaving((s) => ({ ...s, [key]: "error" }));
        toast.error(conflitoRegistro);
        return;
      }

      const { data, error } = await supabase.rpc("obras_salvar_registro_horas", {
        p_id: r.id ?? null,
        p_funcionario_id: r.funcionario_id,
        p_obra_id: r.obra_id,
        p_data: r.data,
        p_tipo_registro: r.tipo_registro,
        p_falta_tipo: r.falta_tipo,
        p_horas_normais: registroEhFalta(r) ? 0 : r.horas_normais,
        p_horas_extras: registroEhFalta(r) ? 0 : r.horas_extras,
        p_justificativa_extras: r.justificativa_extras?.trim() || null,
        p_observacoes: r.observacoes?.trim() || null,
      });
      if (error) {
        setSaving((s) => ({ ...s, [key]: "error" }));
        toast.error(mensagemErroCompetenciaFechada(error) ?? mensagemErroRegistro(error));
        return;
      }
      setCells((prev) => ({
        ...prev,
        [key]: {
          ...(data as Registro),
          especialidade_ajudante: r.especialidade_ajudante,
        },
      }));
      setSaving((s) => ({ ...s, [key]: "saved" }));
      qc.invalidateQueries({ queryKey: ["aloc-week", obraId] });
      qc.invalidateQueries({ queryKey: ["alocacoes-mes"] });
      qc.invalidateQueries({ queryKey: ["registros-mes"] });
      setTimeout(() => {
        setSaving((s) => (s[key] === "saved" ? { ...s, [key]: "idle" } : s));
      }, 1200);
    },
    [user?.id, qc, obraId, infoHistoricoById, especialidadePorAlocacao],
  );

  const updateCell = useCallback((key: CellKey, patch: Partial<Registro>, base: Registro) => {
    const next: Registro = { ...base, ...patch };
    setCells((prev) => ({ ...prev, [key]: next }));
    setSaving((statusAtual) => ({ ...statusAtual, [key]: "dirty" }));
  }, []);

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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWeekStart(inicioDaSemanaSegunda(new Date()))}
          >
            Hoje
          </Button>
        </div>

        {availableToAdd.length > 0 && (
          <FuncionarioSearchSelect
            funcionarios={availableToAdd}
            value=""
            onValueChange={(id) => setExtraIds((cur) => (cur.includes(id) ? cur : [...cur, id]))}
            placeholder="+ Adicionar funcionário"
            formatLabel={(f) =>
              `${f.nome}${
                f.data_desligamento
                  ? ` — desligado em ${new Date(
                      `${f.data_desligamento}T00:00:00`,
                    ).toLocaleDateString("pt-BR")}`
                  : ""
              }`
            }
            className="h-9 w-auto min-w-52"
          />
        )}

        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <LegendDot className="bg-emerald-500" /> Horas normais
          <LegendDot className="bg-amber-500" /> HE 50%
          <LegendDot className="bg-rose-500" /> HE 100%
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
                      tipo_registro: "horas",
                      falta_tipo: null,
                    };
                    const isAlloc = allocSet.has(`${f.id}|${dateStr}`);
                    const especialidadePersistida = especialidadePorAlocacao.get(
                      `${f.id}|${dateStr}`,
                    );
                    const registroComEspecialidade: Registro = {
                      ...base,
                      especialidade_ajudante: resolverEspecialidadeAjudanteGrade(
                        especialidadePersistida,
                        base.especialidade_ajudante,
                      ),
                    };
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
                            registro={registroComEspecialidade}
                            alocado={isAlloc}
                            categoria={f.categoria_mo}
                            especialidadePersistida={especialidadePersistida}
                            status={saving[key] ?? "idle"}
                            onChange={(patch) => updateCell(key, patch, registroComEspecialidade)}
                            onSave={() => void saveCell(key, registroComEspecialidade)}
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
  categoria,
  especialidadePersistida,
  status,
  onChange,
  onSave,
}: {
  registro: Registro;
  alocado: boolean;
  categoria: string | null;
  especialidadePersistida: EspecialidadeAjudante | null | undefined;
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  onChange: (patch: Partial<Registro>) => void;
  onSave: () => void;
}) {
  const composicao = comporHorasParaVisualizacao({
    data: registro.data,
    horasNormais: registro.horas_normais,
    horasExtras: registro.horas_extras,
  });
  const total = composicao.total;
  const bg =
    composicao.destaque === "normal"
      ? "bg-emerald-500/10 border-emerald-500/40"
      : composicao.destaque === "he50"
        ? "bg-amber-500/10 border-amber-500/40"
        : composicao.destaque === "he100"
          ? "bg-rose-500/10 border-rose-500/40"
          : "bg-card border-border";

  const needsJust = registro.horas_extras > 2 && !registro.justificativa_extras?.trim();
  const invalidExtras = !payloadHorasPermitido(
    registro.data,
    registro.horas_normais,
    registro.horas_extras,
  );
  const overflow = total > 16;
  const dataFuturaBloqueada =
    dataLancamentoFutura(registro.data) && !registroEhAusenciaPlanejada(registro);
  const deveSolicitarEspecialidade =
    categoriaEhAjudante(categoria) &&
    competenciaUsaSegmentacaoMod(registro.data) &&
    (!alocado || !especialidadePersistida);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={dataFuturaBloqueada}
          className={cn(
            "relative flex min-h-[76px] w-full flex-col items-center justify-center rounded-md border px-1 py-1 text-xs transition hover:ring-2 hover:ring-ring/40",
            bg,
          )}
          title={
            dataFuturaBloqueada
              ? "Não é permitido lançar horas em datas futuras."
              : !alocado && total === 0 && !registroEhFalta(registro)
                ? "Sem alocação — lançar horas criará automaticamente"
                : undefined
          }
        >
          {registroEhAusenciaPlanejada(registro) ? (
            <span className="font-semibold text-sky-700 dark:text-sky-400">
              {rotuloTipoRegistro(registro.tipo_registro)}
            </span>
          ) : registroEhFalta(registro) ? (
            <>
              <span className="font-semibold text-amber-700 dark:text-amber-400">Falta</span>
              <span className="text-[10px] text-amber-700 dark:text-amber-400">
                {rotuloFalta(registro.falta_tipo)}
              </span>
            </>
          ) : total > 0 ? (
            composicao.linhas.map((linha) => (
              <span
                key={linha.tipo}
                className={cn("text-[11px] font-semibold leading-4", corTextoHora(linha.tipo))}
              >
                {linha.texto}
              </span>
            ))
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

        {registro.tipo_registro === "horas" && composicao.linhas.length > 0 && (
          <div className="rounded-md border bg-muted/20 p-2">
            <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
              Apuração para exibição
            </div>
            {composicao.linhas.map((linha) => (
              <div key={linha.tipo} className={cn("text-xs font-medium", corTextoHora(linha.tipo))}>
                {linha.texto}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Tipo de registro</label>
          <Select
            value={registro.tipo_registro}
            onValueChange={(value: TipoRegistro) => {
              if (value === "horas") {
                onChange({
                  tipo_registro: "horas",
                  ausencia: false,
                  falta_tipo: null,
                  motivo_ausencia: null,
                });
                return;
              }
              onChange({
                tipo_registro: value,
                ausencia: true,
                horas_normais: 0,
                horas_extras: 0,
                justificativa_extras: null,
                falta_tipo: null,
                motivo_ausencia: value === "ferias" || value === "folga_campo" ? value : null,
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="horas">Horas trabalhadas</SelectItem>
              <SelectItem value="falta">Falta</SelectItem>
              <SelectItem value="ferias">Férias</SelectItem>
              <SelectItem value="folga_campo">Folga de campo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {registroEhFalta(registro) ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Classificação da falta *</label>
              <Select
                value={registro.falta_tipo ?? ""}
                onValueChange={(value: FaltaTipo) => onChange({ falta_tipo: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {CLASSIFICACOES_FALTA.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400">{AVISO_FALTA_INTEGRAL}</p>
          </div>
        ) : registroEhAusenciaPlanejada(registro) ? (
          <Alert>
            <AlertDescription>
              {rotuloTipoRegistro(registro.tipo_registro)} — nenhuma hora é lançada.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {deveSolicitarEspecialidade && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Classificação do ajudante *</label>
                <Select
                  value={registro.especialidade_ajudante ?? ""}
                  onValueChange={(value: EspecialidadeAjudante) =>
                    onChange({ especialidade_ajudante: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione Civil ou Montagem" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="civil">Civil</SelectItem>
                    <SelectItem value="montagem">Montagem</SelectItem>
                  </SelectContent>
                </Select>
                {!registro.especialidade_ajudante && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Necessária para esta alocação sem classificação.
                  </p>
                )}
              </div>
            )}
            <div className="text-[10px] font-medium uppercase text-muted-foreground">
              Valores brutos do lançamento
            </div>
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
                      horas_extras: Math.max(0, Math.min(16, Number(e.target.value) || 0)),
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

        <div className="space-y-2 border-t pt-3">
          <Button
            type="button"
            className="w-full"
            disabled={status !== "dirty" && status !== "error"}
            onClick={onSave}
          >
            {status === "saving" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {status === "saving" ? "Salvando..." : "Salvar alterações"}
          </Button>
          <div className="text-xs text-muted-foreground">
            {status === "dirty"
              ? "Alterações pendentes de confirmação"
              : status === "saving"
                ? "Salvando alterações..."
                : status === "saved"
                  ? "Alterações salvas"
                  : status === "error"
                    ? "Revise os dados e tente salvar novamente"
                    : "Altere os campos e confirme para salvar"}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function corTextoHora(tipo: TipoHoraVisual) {
  if (tipo === "he100") return "text-rose-700 dark:text-rose-400";
  if (tipo === "he50") return "text-amber-700 dark:text-amber-400";
  return "text-emerald-700 dark:text-emerald-400";
}
