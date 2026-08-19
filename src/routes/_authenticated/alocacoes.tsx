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
  FileSpreadsheet,
  Pencil,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RegistrosGrid } from "@/components/RegistrosGrid";
import { buscarTodasPaginas } from "@/lib/paginacao";
import { dataLocalHoje, validarDataLancamento } from "@/lib/data-lancamento";
import { funcionarioElegivelNoPeriodo } from "@/lib/funcionarios";
import { AlocarPeriodoDialog } from "@/components/AlocarPeriodoDialog";
import { CopiarDiaAnteriorDialog } from "@/components/CopiarDiaAnteriorDialog";
import { ImportarPlanilhaLegadoDialog } from "@/components/ImportarPlanilhaLegadoDialog";
import { canImportarPlanilhaLegado } from "@/lib/permissoes-especiais";
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
import { calcularJornadaDetalhada } from "@/lib/jornada-horas";
import { formatDecimalHours, formatExtraHours, roundHours } from "@/lib/formatacao-horas";
import { comporHorasParaVisualizacao, type DetalheJornadaVisual } from "@/lib/horas-visualizacao";
import {
  AVISO_FALTA_INTEGRAL,
  buscarConflitoRegistroDiario,
  CLASSIFICACOES_FALTA,
  mensagemErroRegistro,
  registroEhAusenciaPlanejada,
  rotuloFalta,
  rotuloTipoRegistro,
  TIPOS_REGISTRO,
  validarRegistroApontamento,
  type FaltaTipo,
  type TipoRegistro,
} from "@/lib/registro-falta";
import {
  logAlocacoesQueryError,
  logLinhasFuncionariosIgnoradas,
  normalizarFuncionariosAlocacao,
  rotuloFuncionarioAlocacao,
} from "@/lib/alocacoes-runtime";
import { useCategorias } from "@/lib/categorias";
import {
  categoriaEhAjudante,
  competenciaUsaSegmentacaoMod,
  type EspecialidadeAjudante,
} from "@/lib/especialidade-ajudante";
import {
  compararCategoriasPorTipoENome,
  ordenarFuncionariosPorTipoENome,
  semanaInicialDaCompetencia,
} from "@/lib/alocacoes-visualizacao";

export const Route = createFileRoute("/_authenticated/alocacoes")({
  component: AlocacoesPage,
});

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const classificacoesFaltaValues = CLASSIFICACOES_FALTA.map(({ value }) => value) as [
  FaltaTipo,
  ...FaltaTipo[],
];

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const schema = z
  .object({
    funcionario_id: z.string().uuid("Selecione um funcionário"),
    obra_id: z.string().uuid("Selecione um centro de custo"),
    data: z.string().min(1, "Data obrigatória"),
    data_fim: z.string().min(1, "Data final obrigatória"),
    tipo_registro: z.enum(TIPOS_REGISTRO),
    falta_tipo: z.enum(classificacoesFaltaValues).nullable(),
    hora_entrada: z.string(),
    hora_saida: z.string(),
    intervalo_minutos: z.number().int("Intervalo inválido").nonnegative("Intervalo inválido"),
    observacoes: z.string().optional(),
    justificativa_extras: z.string().optional(),
    especialidade_ajudante: z.enum(["civil", "montagem"]).nullable(),
  })
  .superRefine((v, ctx) => {
    if (registroEhAusenciaPlanejada(v)) {
      if (v.data_fim < v.data) {
        ctx.addIssue({
          code: "custom",
          path: ["data_fim"],
          message: "A data Até deve ser igual ou posterior à data De.",
        });
      }
      return;
    }
    if (v.tipo_registro === "falta") {
      if (!v.falta_tipo) {
        ctx.addIssue({
          code: "custom",
          path: ["falta_tipo"],
          message: "A classificação da falta é obrigatória.",
        });
      }
      return;
    }
    if (!timeRegex.test(v.hora_entrada)) {
      ctx.addIssue({ code: "custom", path: ["hora_entrada"], message: "Horário inválido" });
      return;
    }
    if (!timeRegex.test(v.hora_saida)) {
      ctx.addIssue({ code: "custom", path: ["hora_saida"], message: "Horário inválido" });
      return;
    }
    const calculo = calcularJornadaDetalhada({
      data: v.data,
      horaEntrada: v.hora_entrada,
      horaSaida: v.hora_saida,
      intervaloMinutos: v.intervalo_minutos,
    });
    if (!calculo.valido) {
      ctx.addIssue({
        code: "custom",
        path: calculo.erro?.includes("intervalo") ? ["intervalo_minutos"] : ["hora_saida"],
        message: calculo.erro ?? "Informe uma jornada válida.",
      });
      return;
    }
    if (calculo.exigeJustificativa && !v.justificativa_extras?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["justificativa_extras"],
        message: "Justificativa obrigatória para jornada superior a 12 horas",
      });
    }
  });
type FormVals = z.infer<typeof schema>;
type ErrorLike = { message?: string };

function LocalReadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{message}</AlertTitle>
      <AlertDescription className="mt-2">
        <Button type="button" size="sm" variant="outline" onClick={retry}>
          Tentar novamente
        </Button>
      </AlertDescription>
    </Alert>
  );
}

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

function competenciaLabel(competencia: string) {
  const [ano, mes] = competencia.split("-").map(Number);
  const rotulo = monthLabel(ano, mes - 1);
  return rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
}

type AlocRow = {
  id: string;
  data: string;
  funcionario_id: string;
  obra_id: string;
  created_by: string | null;
  created_at: string | null;
  hora_entrada: string | null;
  hora_saida: string | null;
  intervalo_padrao_minutos: number;
  especialidade_ajudante?: EspecialidadeAjudante | null;
  obras: { id: string; nome: string } | null;
};
type CalendarRow = AlocRow & { registroOnly?: boolean };

type AllocationAuditUser = {
  id: string;
  full_name: string | null;
  email: string | null;
};

function formatAuditDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AlocacoesPage() {
  const { user, role } = useAuth();
  const canViewAllocationAudit = role === "coordenador" || role === "gerente" || role === "diretor";
  const canEditAllocationHoursByRole =
    role === "coordenador" || role === "gerente" || role === "diretor";
  const canImportarLegado = canImportarPlanilhaLegado(user?.email);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [alocacaoEmEdicao, setAlocacaoEmEdicao] = useState<AlocRow | null>(null);
  const [editEntrada, setEditEntrada] = useState("07:00");
  const [editSaida, setEditSaida] = useState("17:00");
  const [editIntervaloMinutos, setEditIntervaloMinutos] = useState(60);
  const [editJustificativa, setEditJustificativa] = useState("");
  const [editTipoRegistro, setEditTipoRegistro] = useState<TipoRegistro>("horas");
  const [editFaltaTipo, setEditFaltaTipo] = useState<FaltaTipo | null>(null);
  const [editObservacoes, setEditObservacoes] = useState("");
  const [editEspecialidadeAjudante, setEditEspecialidadeAjudante] =
    useState<EspecialidadeAjudante | null>(null);
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
  const semanaInicial = useMemo(() => semanaInicialDaCompetencia(year, month), [year, month]);
  const { data: categorias } = useCategorias();
  const feriadosQuery = useQuery({
    queryKey: ["feriados-obras-control"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feriados_obras_control" as never)
        .select("data" as never)
        .eq("ativo" as never, true);
      if (error) throw error;
      return new Set((data as unknown as Array<{ data: string }>).map((item) => item.data));
    },
  });
  const feriados = useMemo(() => feriadosQuery.data ?? new Set<string>(), [feriadosQuery.data]);

  const funcionariosQuery = useQuery({
    queryKey: ["funcionarios-alocacao-selecao"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obras_control_funcionarios_safe");
      if (error) {
        logAlocacoesQueryError("funcionarios", error);
        throw error;
      }
      const normalizados = normalizarFuncionariosAlocacao(data);
      logLinhasFuncionariosIgnoradas(normalizados.ignorados);
      return normalizados.validos;
    },
  });
  const funcionarios = funcionariosQuery.data;
  // Inclui inativos no select (com marcador) para permitir lançamentos retroativos.
  const funcionariosSelecionaveis = useMemo(
    () =>
      (funcionarios ?? [])
        .filter((f) => funcionarioElegivelNoPeriodo(f, startISO, endISO))
        .slice()
        .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome)),
    [funcionarios, startISO, endISO],
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
  const obrasQuery = useQuery({
    queryKey: ["obras-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("obras")
        .select("id,nome,visivel_obras_control")
        .order("nome");
      if (error) {
        logAlocacoesQueryError("obras", error);
        throw error;
      }
      return data.filter((obra) => obra.visivel_obras_control !== false) as Array<{
        id: string;
        nome: string;
      }>;
    },
  });
  const obras = obrasQuery.data;

  const alocacoesQuery = useQuery({
    queryKey: ["alocacoes-mes", mesKey, obraFiltro],
    queryFn: async () => {
      try {
        return await buscarTodasPaginas<AlocRow>(async (from, to) => {
          let q = supabase
            .from("alocacoes")
            .select(
              "id, data, funcionario_id, obra_id, created_by, created_at, hora_entrada, hora_saida, intervalo_padrao_minutos, especialidade_ajudante, obras(id,nome)",
            )
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
      } catch (error) {
        logAlocacoesQueryError("alocacoes", error);
        throw error;
      }
    },
  });
  const alocacoes = alocacoesQuery.data;
  const registrosQuery = useQuery({
    queryKey: ["registros-mes", mesKey, obraFiltro],
    enabled: true,
    queryFn: async () => {
      type RegistroResumo = {
        id: string;
        funcionario_id: string;
        obra_id: string;
        data: string;
        horas_normais: number;
        horas_extras: number;
        created_by: string | null;
        created_at: string;
        updated_by: string | null;
        updated_at: string;
        justificativa_extras: string | null;
        observacoes: string | null;
        tipo_registro: TipoRegistro;
        falta_tipo: FaltaTipo | null;
      };
      try {
        return await buscarTodasPaginas<RegistroResumo>(async (from, to) => {
          let q = supabase
            .from("registros_horas")
            .select(
              "id, funcionario_id, obra_id, data, horas_normais, horas_extras, created_by, created_at, updated_by, updated_at, justificativa_extras, observacoes, tipo_registro, falta_tipo",
            )
            .gte("data", startISO)
            .lte("data", endISO)
            .order("data", { ascending: true })
            .order("funcionario_id", { ascending: true })
            .order("obra_id", { ascending: true })
            .range(from, to);
          if (obraFiltro !== "all") q = q.eq("obra_id", obraFiltro);
          return q;
        });
      } catch (error) {
        logAlocacoesQueryError("registros", error);
        throw error;
      }
    },
  });
  const registros = registrosQuery.data;
  const detalhesQuery = useQuery({
    queryKey: ["registros-horas-detalhes", mesKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registros_horas_detalhes" as never)
        .select(
          "registro_horas_id,minutos_normais,minutos_he_50,minutos_he_100,minutos_sem_adicional_he,minutos_noturnos_reais,minutos_noturnos_remuneraveis,minutos_noturnos_normais_remuneraveis,minutos_noturnos_he_50_remuneraveis,minutos_noturnos_he_100_remuneraveis,minutos_noturnos_sem_adicional_he_remuneraveis,jornada_excepcional" as never,
        )
        .gte("data_inicio" as never, startISO)
        .lte("data_inicio" as never, endISO);
      if (error) throw error;
      return data as unknown as Array<DetalheJornadaVisual & { registro_horas_id: string }>;
    },
  });
  const detalhePorRegistro = useMemo(
    () =>
      new Map((detalhesQuery.data ?? []).map((detalhe) => [detalhe.registro_horas_id, detalhe])),
    [detalhesQuery.data],
  );

  const funcionarioIdsHistoricos = useMemo(
    () =>
      Array.from(
        new Set([
          ...(alocacoes ?? []).map((a) => a.funcionario_id),
          ...(registros ?? []).map((r) => r.funcionario_id),
        ]),
      ).sort(),
    [alocacoes, registros],
  );
  const funcionariosHistoricosQuery = useQuery({
    queryKey: ["funcionarios-historico-alocacoes", funcionarioIdsHistoricos],
    enabled: funcionarioIdsHistoricos.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obras_control_funcionarios_por_ids", {
        p_ids: funcionarioIdsHistoricos,
      });
      if (error) {
        logAlocacoesQueryError("funcionarios_historicos", error);
        throw error;
      }
      const normalizados = normalizarFuncionariosAlocacao(data);
      logLinhasFuncionariosIgnoradas(normalizados.ignorados);
      return normalizados.validos;
    },
  });
  const funcionariosHistoricos = funcionariosHistoricosQuery.data;

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

  const auditUserIds = useMemo(() => {
    if (!canViewAllocationAudit) return [];
    const ids = new Set<string>();
    for (const allocation of alocacoes ?? []) {
      if (allocation.created_by) ids.add(allocation.created_by);
    }
    for (const record of registros ?? []) {
      if (record.updated_by) ids.add(record.updated_by);
    }
    return Array.from(ids).sort();
  }, [alocacoes, canViewAllocationAudit, registros]);

  const auditUsersQuery = useQuery({
    queryKey: ["allocation-audit-users", auditUserIds],
    enabled: canViewAllocationAudit && auditUserIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_allocation_audit_users", {
        p_user_ids: auditUserIds,
      });
      if (error) {
        logAlocacoesQueryError("auditoria", error);
        throw error;
      }
      return data as AllocationAuditUser[];
    },
  });
  const auditUsers = auditUsersQuery.data;

  const auditUserById = useMemo(() => {
    const users = new Map<string, string>();
    for (const profile of auditUsers ?? []) {
      users.set(
        profile.id,
        profile.full_name?.trim() || profile.email?.trim() || "Usuário não identificado",
      );
    }
    return users;
  }, [auditUsers]);

  const horasMap = useMemo(() => {
    const m = new Map<
      string,
      {
        id: string;
        hn: number;
        he: number;
        createdBy: string | null;
        createdAt: string;
        updatedBy: string | null;
        updatedAt: string;
        justificativaExtras: string | null;
        observacoes: string | null;
        tipoRegistro: TipoRegistro;
        faltaTipo: FaltaTipo | null;
        detalhe: DetalheJornadaVisual | null;
      }
    >();
    for (const r of registros ?? []) {
      m.set(`${r.funcionario_id}|${r.obra_id}|${r.data}`, {
        id: r.id,
        hn: Number(r.horas_normais),
        he: Number(r.horas_extras),
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedBy: r.updated_by,
        updatedAt: r.updated_at,
        justificativaExtras: r.justificativa_extras,
        observacoes: r.observacoes,
        tipoRegistro: r.tipo_registro,
        faltaTipo: r.falta_tipo,
        detalhe: detalhePorRegistro.get(r.id) ?? null,
      });
    }
    return m;
  }, [detalhePorRegistro, registros]);

  // Cada funcionario aparece uma vez por obra, ainda que tenha alocacoes em varias datas.
  const porObra = useMemo(() => {
    const out = new Map<
      string,
      {
        nome: string;
        dias: Map<string, CalendarRow[]>;
        funcs: Map<
          string,
          {
            nome: string;
            categoria: string;
            dias: Set<string>;
            hn: number;
            he50: number;
            he100: number;
            semHe: number;
            noturnasRemuneraveis: number;
            excepcional: boolean;
          }
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
          he50: 0,
          he100: 0,
          semHe: 0,
          noturnasRemuneraveis: 0,
          excepcional: false,
        });
      const fEntry = g.funcs.get(fId)!;
      fEntry.dias.add(a.data);
      const h = horasMap.get(`${fId}|${obraId}|${a.data}`);
      if (h) {
        const composicao = comporHorasParaVisualizacao({
          data: a.data,
          horasNormais: h.hn,
          horasExtras: h.he,
          detalhe: h.detalhe,
        });
        fEntry.hn += composicao.horasNormaisApuradas;
        fEntry.he50 += composicao.horasExtra50Apuradas;
        fEntry.he100 += composicao.horasExtra100Apuradas;
        fEntry.semHe += composicao.horasSemAdicionalHe;
        fEntry.noturnasRemuneraveis += composicao.horasNoturnasRemuneraveis;
        fEntry.excepcional ||= composicao.jornadaExcepcional;
      }
    }
    for (const r of registros ?? []) {
      if (!registroEhAusenciaPlanejada(r)) continue;
      const obraId = r.obra_id;
      const obraNome = obras?.find((obra) => obra.id === obraId)?.nome ?? "—";
      if (!out.has(obraId)) out.set(obraId, { nome: obraNome, dias: new Map(), funcs: new Map() });
      const g = out.get(obraId)!;
      if (!g.dias.has(r.data)) g.dias.set(r.data, []);
      const items = g.dias.get(r.data)!;
      if (!items.some((item) => item.funcionario_id === r.funcionario_id)) {
        items.push({
          id: `registro-${r.id}`,
          data: r.data,
          funcionario_id: r.funcionario_id,
          obra_id: r.obra_id,
          created_by: r.created_by,
          created_at: r.created_at,
          hora_entrada: null,
          hora_saida: null,
          intervalo_padrao_minutos: 0,
          obras: { id: obraId, nome: obraNome },
          registroOnly: true,
        });
      }
      const info = infoHistoricoById.get(r.funcionario_id);
      if (!g.funcs.has(r.funcionario_id))
        g.funcs.set(r.funcionario_id, {
          nome: info?.nome ?? "—",
          categoria: info?.categoria ?? "Sem função",
          dias: new Set(),
          hn: 0,
          he50: 0,
          he100: 0,
          semHe: 0,
          noturnasRemuneraveis: 0,
          excepcional: false,
        });
      g.funcs.get(r.funcionario_id)!.dias.add(r.data);
    }
    for (const grupo of out.values()) {
      for (const funcionario of grupo.funcs.values()) {
        funcionario.hn = roundHours(funcionario.hn);
        funcionario.he50 = roundHours(funcionario.he50);
        funcionario.he100 = roundHours(funcionario.he100);
        funcionario.semHe = roundHours(funcionario.semHe);
        funcionario.noturnasRemuneraveis = roundHours(funcionario.noturnasRemuneraveis);
      }
    }
    return Array.from(out.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [alocacoes, registros, horasMap, infoHistoricoById, obras]);

  const competenciaDays = useMemo(() => {
    const days: string[] = [];
    for (let d = startISO; d <= endISO; d = addDaysISO(d, 1)) days.push(d);
    return days;
  }, [startISO, endISO]);

  const today = dataLocalHoje();

  async function exportarEfetivoDiario(obra: { nome: string }, data: string, items: CalendarRow[]) {
    try {
      const { exportEfetivoDiarioXlsx } = await import("@/lib/efetivo-diario-xlsx");
      exportEfetivoDiarioXlsx({
        data,
        obra: obra.nome,
        linhas: items.map((a) => {
          const h = horasMap.get(`${a.funcionario_id}|${a.obra_id}|${a.data}`);
          const composicao = h
            ? comporHorasParaVisualizacao({
                data: a.data,
                horasNormais: h.hn,
                horasExtras: h.he,
                detalhe: h.detalhe,
              })
            : null;
          const situacao = !h
            ? "Alocado — sem apontamento"
            : h.tipoRegistro === "falta"
              ? `${rotuloTipoRegistro(h.tipoRegistro)} — ${rotuloFalta(h.faltaTipo)}`
              : rotuloTipoRegistro(h.tipoRegistro);

          return {
            funcionario: infoHistoricoById.get(a.funcionario_id)?.nome ?? "—",
            funcao: infoHistoricoById.get(a.funcionario_id)?.categoria ?? "Sem função",
            especialidadeAjudante: a.especialidade_ajudante,
            situacao,
            horasNormais: composicao?.horasNormaisApuradas ?? 0,
            horasExtra50: composicao?.horasExtra50Apuradas ?? 0,
            horasExtra100: composicao?.horasExtra100Apuradas ?? 0,
            totalHoras: composicao?.total ?? 0,
            observacoes: h?.observacoes,
          };
        }),
      });
      toast.success("Efetivo diário exportado");
    } catch {
      toast.error("Não foi possível exportar o efetivo diário");
    }
  }

  const defaultFormValues: FormVals = {
    funcionario_id: "",
    obra_id: "",
    data: today,
    data_fim: today,
    tipo_registro: "horas",
    falta_tipo: null,
    hora_entrada: "07:00",
    hora_saida: "17:00",
    intervalo_minutos: 60,
    observacoes: "",
    justificativa_extras: "",
    especialidade_ajudante: null,
  };
  const form = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: defaultFormValues,
  });
  const watchData = form.watch("data");
  const watchFuncionarioId = form.watch("funcionario_id");
  const funcionarioSelecionado = funcionariosSelecionaveis.find(
    (funcionario) => funcionario.id === watchFuncionarioId,
  );
  const funcionarioSelecionadoEhAjudante = categoriaEhAjudante(
    funcionarioSelecionado?.categoria_mo,
  );
  const funcionarioSelecionadoExigeEspecialidade =
    funcionarioSelecionadoEhAjudante &&
    competenciaUsaSegmentacaoMod(calcularCompetencia(watchData || today).competencia);
  useEffect(() => {
    if (!funcionarioSelecionadoExigeEspecialidade) form.setValue("especialidade_ajudante", null);
  }, [form, funcionarioSelecionadoExigeEspecialidade]);
  const watchTipoRegistro = form.watch("tipo_registro");
  const ausenciaPlanejada = registroEhAusenciaPlanejada({ tipo_registro: watchTipoRegistro });
  const watchEntrada = form.watch("hora_entrada");
  const watchSaida = form.watch("hora_saida");
  const watchIntervaloMinutos = form.watch("intervalo_minutos");
  const watchJustificativa = form.watch("justificativa_extras");
  const previa = useMemo(
    () =>
      watchTipoRegistro === "horas" && timeRegex.test(watchEntrada) && timeRegex.test(watchSaida)
        ? calcularJornadaDetalhada({
            data: watchData || today,
            horaEntrada: watchEntrada,
            horaSaida: watchSaida,
            intervaloMinutos: watchIntervaloMinutos,
            funcao: funcionarioSelecionado?.categoria_mo,
            feriados,
          })
        : null,
    [
      watchEntrada,
      watchSaida,
      watchData,
      watchIntervaloMinutos,
      watchTipoRegistro,
      today,
      funcionarioSelecionado?.categoria_mo,
      feriados,
    ],
  );

  const createMutation = useMutation({
    mutationFn: async (v: FormVals) => {
      setAlocacaoFeedback(null);
      const funcionario = funcionariosSelecionaveis.find((item) => item.id === v.funcionario_id);
      if (
        categoriaEhAjudante(funcionario?.categoria_mo) &&
        competenciaUsaSegmentacaoMod(calcularCompetencia(v.data).competencia) &&
        !v.especialidade_ajudante
      )
        throw new Error("Informe se o ajudante atuará em Civil ou Montagem.");
      if (registroEhAusenciaPlanejada(v)) {
        const { error } = await supabase.rpc("obras_salvar_ausencia_planejada_periodo", {
          p_funcionario_id: v.funcionario_id,
          p_obra_id: v.obra_id,
          p_tipo_registro: v.tipo_registro,
          p_data_inicio: v.data,
          p_data_fim: v.data_fim,
          p_observacoes: v.observacoes?.trim() || null,
        });
        if (error) throw new Error(mensagemErroRegistro(error));
        return { tipoRegistro: v.tipo_registro, faltaTipo: null, hn: 0, he: 0 };
      }
      validarDataLancamento(v.data, "horas");
      const falta = v.tipo_registro === "falta";
      const calculo = falta
        ? null
        : calcularJornadaDetalhada({
            data: v.data,
            horaEntrada: v.hora_entrada,
            horaSaida: v.hora_saida,
            intervaloMinutos: v.intervalo_minutos,
            funcao: funcionario?.categoria_mo,
            feriados,
          });
      if (calculo && !calculo.valido) throw new Error(calculo.erro);
      const hn = calculo ? (calculo.minutosNormais + calculo.minutosSemAdicionalHe) / 60 : 0;
      const he = calculo ? (calculo.minutosHe50 + calculo.minutosHe100) / 60 : 0;
      const erroValidacao = validarRegistroApontamento({
        tipo_registro: v.tipo_registro,
        falta_tipo: v.falta_tipo,
        horas_normais: hn,
        horas_extras: he,
      });
      if (erroValidacao) throw new Error(erroValidacao);

      await garantirCompetenciaAberta(supabase, v.data);

      const conflitoRegistro = await buscarConflitoRegistroDiario(supabase, {
        funcionario_id: v.funcionario_id,
        data: v.data,
        tipo_registro: v.tipo_registro,
      });
      if (conflitoRegistro) throw new Error(conflitoRegistro);

      const conflito = await buscarConflitoAlocacao({
        supabase,
        funcionarioId: v.funcionario_id,
        obraId: v.obra_id,
        data: v.data,
      });
      if (conflito) throw criarErroConflitoAlocacao(conflito);

      if (calculo) {
        const { error } = await supabase.rpc(
          "obras_salvar_jornada_v2" as never,
          {
            p_alocacao_id: null,
            p_registro_id: null,
            p_funcionario_id: v.funcionario_id,
            p_obra_id: v.obra_id,
            p_data: v.data,
            p_hora_entrada: v.hora_entrada,
            p_hora_saida: v.hora_saida,
            p_intervalo_minutos: v.intervalo_minutos,
            p_horas_normais: hn,
            p_horas_extras: he,
            p_justificativa: v.justificativa_extras?.trim() || null,
            p_observacoes: v.observacoes?.trim() || null,
            p_especialidade_ajudante:
              categoriaEhAjudante(funcionario?.categoria_mo) &&
              competenciaUsaSegmentacaoMod(calcularCompetencia(v.data).competencia)
                ? v.especialidade_ajudante
                : null,
            p_detalhe: calculo,
            p_origem_calculo: "aplicacao",
          } as never,
        );
        if (error) throw new Error(mensagemErroRegistro(error));
        return { tipoRegistro: v.tipo_registro, faltaTipo: v.falta_tipo, hn, he };
      }

      const { error: alocErr } = await supabase.from("alocacoes").upsert(
        [
          {
            funcionario_id: v.funcionario_id,
            obra_id: v.obra_id,
            data: v.data,
            created_by: user?.id ?? null,
            hora_entrada: falta ? null : v.hora_entrada,
            hora_saida: falta ? null : v.hora_saida,
            intervalo_padrao_minutos: v.intervalo_minutos,
            especialidade_ajudante:
              categoriaEhAjudante(funcionario?.categoria_mo) &&
              competenciaUsaSegmentacaoMod(calcularCompetencia(v.data).competencia)
                ? v.especialidade_ajudante
                : null,
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

      const { error: regErr } = await supabase.rpc("obras_salvar_registro_horas", {
        p_id: null,
        p_funcionario_id: v.funcionario_id,
        p_obra_id: v.obra_id,
        p_data: v.data,
        p_tipo_registro: v.tipo_registro,
        p_falta_tipo: falta ? v.falta_tipo : null,
        p_horas_normais: falta ? 0 : hn,
        p_horas_extras: falta ? 0 : he,
        p_justificativa_extras: !falta && he > 0 ? v.justificativa_extras?.trim() || null : null,
        p_observacoes: v.observacoes?.trim() || null,
      });
      if (regErr)
        throw new Error(mensagemErroCompetenciaFechada(regErr) ?? mensagemErroRegistro(regErr));
      return { tipoRegistro: v.tipo_registro, faltaTipo: v.falta_tipo, hn, he };
    },
    onSuccess: ({ tipoRegistro, faltaTipo, hn, he }) => {
      toast.success(
        tipoRegistro !== "horas"
          ? tipoRegistro === "falta"
            ? `Falta registrada: ${rotuloFalta(faltaTipo)}`
            : `${rotuloTipoRegistro(tipoRegistro)} registrada`
          : `Lançamento salvo: ${formatDecimalHours(hn)}h normais${he > 0 ? ` ${formatExtraHours(he)} extras` : ""}`,
      );
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
      toast.error(mensagemErroRegistro(e));
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

  const editPrevia = useMemo(
    () =>
      editTipoRegistro === "horas" && timeRegex.test(editEntrada) && timeRegex.test(editSaida)
        ? calcularJornadaDetalhada({
            data: alocacaoEmEdicao?.data ?? new Date().toISOString().slice(0, 10),
            horaEntrada: editEntrada,
            horaSaida: editSaida,
            intervaloMinutos: editIntervaloMinutos,
            funcao: alocacaoEmEdicao
              ? infoHistoricoById.get(alocacaoEmEdicao.funcionario_id)?.categoria
              : null,
            feriados,
          })
        : null,
    [
      alocacaoEmEdicao,
      editEntrada,
      editSaida,
      editIntervaloMinutos,
      editTipoRegistro,
      infoHistoricoById,
      feriados,
    ],
  );
  const editHorariosValidos =
    editTipoRegistro !== "horas" ||
    (timeRegex.test(editEntrada) && timeRegex.test(editSaida) && Boolean(editPrevia?.valido));
  const editJustificativaValida =
    editTipoRegistro !== "horas" ||
    !editPrevia?.exigeJustificativa ||
    editJustificativa.trim().length > 0;
  const editPodeSalvar =
    editHorariosValidos &&
    editJustificativaValida &&
    (editTipoRegistro !== "falta" || editFaltaTipo !== null) &&
    (!alocacaoEmEdicao ||
      !competenciaUsaSegmentacaoMod(calcularCompetencia(alocacaoEmEdicao.data).competencia) ||
      !categoriaEhAjudante(infoHistoricoById.get(alocacaoEmEdicao.funcionario_id)?.categoria) ||
      editEspecialidadeAjudante !== null);

  function abrirEdicao(a: AlocRow) {
    const registro = horasMap.get(`${a.funcionario_id}|${a.obra_id}|${a.data}`);
    const tipoRegistro = registro?.tipoRegistro ?? "horas";
    const entrada = a.hora_entrada?.slice(0, 5) || "07:00";
    const totalAtual = (registro?.hn ?? 0) + (registro?.he ?? 0);
    const saidaInferida = Math.min(parseTimeToMinutes(entrada) + (totalAtual + 1) * 60, 1439);
    setEditTipoRegistro(tipoRegistro);
    setEditFaltaTipo(registro?.faltaTipo ?? null);
    setEditObservacoes(registro?.observacoes ?? "");
    setEditEntrada(tipoRegistro !== "horas" ? "" : entrada);
    setEditSaida(
      tipoRegistro !== "horas"
        ? ""
        : a.hora_saida?.slice(0, 5) ||
            `${pad(Math.floor(saidaInferida / 60))}:${pad(Math.round(saidaInferida % 60))}`,
    );
    setEditJustificativa(registro?.justificativaExtras ?? "");
    setEditIntervaloMinutos(a.intervalo_padrao_minutos ?? 60);
    setEditEspecialidadeAjudante(a.especialidade_ajudante ?? null);
    setAlocacaoEmEdicao(a);
  }

  const editMutation = useMutation({
    mutationFn: async () => {
      const a = alocacaoEmEdicao;
      if (!a) throw new Error("Alocação não selecionada");
      if (!editPodeSalvar) throw new Error("Confira os horários informados");

      await garantirCompetenciaAberta(supabase, a.data);

      const registro = horasMap.get(`${a.funcionario_id}|${a.obra_id}|${a.data}`);
      const editHn = editPrevia
        ? (editPrevia.minutosNormais + editPrevia.minutosSemAdicionalHe) / 60
        : 0;
      const editHe = editPrevia ? (editPrevia.minutosHe50 + editPrevia.minutosHe100) / 60 : 0;
      const erroValidacao = validarRegistroApontamento({
        tipo_registro: editTipoRegistro,
        falta_tipo: editFaltaTipo,
        horas_normais: editHn,
        horas_extras: editHe,
      });
      if (erroValidacao) throw new Error(erroValidacao);

      const conflitoRegistro = await buscarConflitoRegistroDiario(supabase, {
        id: registro?.id,
        funcionario_id: a.funcionario_id,
        data: a.data,
        tipo_registro: editTipoRegistro,
      });
      if (conflitoRegistro) throw new Error(conflitoRegistro);

      if (editTipoRegistro === "horas" && editPrevia) {
        const { error } = await supabase.rpc(
          "obras_salvar_jornada_v2" as never,
          {
            p_alocacao_id: a.id,
            p_registro_id: registro?.id ?? null,
            p_funcionario_id: a.funcionario_id,
            p_obra_id: a.obra_id,
            p_data: a.data,
            p_hora_entrada: editEntrada,
            p_hora_saida: editSaida,
            p_intervalo_minutos: editIntervaloMinutos,
            p_horas_normais: editHn,
            p_horas_extras: editHe,
            p_justificativa: editJustificativa.trim() || null,
            p_observacoes: editObservacoes.trim() || null,
            p_especialidade_ajudante: editEspecialidadeAjudante,
            p_detalhe: editPrevia,
            p_origem_calculo: "aplicacao",
          } as never,
        );
        if (error) throw new Error(mensagemErroRegistro(error));
        return { total: editPrevia.total, tipoRegistro: editTipoRegistro };
      }

      const { error: alocErr } = await supabase
        .from("alocacoes")
        .update({
          hora_entrada: editTipoRegistro !== "horas" ? null : editEntrada,
          hora_saida: editTipoRegistro !== "horas" ? null : editSaida,
          intervalo_padrao_minutos: editIntervaloMinutos,
          ...(competenciaUsaSegmentacaoMod(calcularCompetencia(a.data).competencia)
            ? {
                especialidade_ajudante: categoriaEhAjudante(
                  infoHistoricoById.get(a.funcionario_id)?.categoria,
                )
                  ? editEspecialidadeAjudante
                  : null,
              }
            : {}),
        })
        .eq("id", a.id);
      if (alocErr) throw new Error(mensagemErroCompetenciaFechada(alocErr) ?? alocErr.message);

      const resultadoRegistro = await supabase.rpc("obras_salvar_registro_horas", {
        p_id: registro?.id ?? null,
        p_funcionario_id: a.funcionario_id,
        p_obra_id: a.obra_id,
        p_data: a.data,
        p_tipo_registro: editTipoRegistro,
        p_falta_tipo: editTipoRegistro === "falta" ? editFaltaTipo : null,
        p_horas_normais: editTipoRegistro !== "horas" ? 0 : editHn,
        p_horas_extras: editTipoRegistro !== "horas" ? 0 : editHe,
        p_justificativa_extras:
          editTipoRegistro === "horas" && editHe > 0 ? editJustificativa.trim() || null : null,
        p_observacoes: editObservacoes.trim() || null,
      });
      if (resultadoRegistro.error)
        throw new Error(
          mensagemErroCompetenciaFechada(resultadoRegistro.error) ??
            mensagemErroRegistro(resultadoRegistro.error),
        );
      return { total: editPrevia?.total ?? 0, tipoRegistro: editTipoRegistro };
    },
    onSuccess: ({ total, tipoRegistro }) => {
      toast.success(
        tipoRegistro !== "horas"
          ? `${rotuloTipoRegistro(tipoRegistro)} atualizada`
          : `Horas atualizadas para ${formatDecimalHours(total)}h`,
      );
      setAlocacaoEmEdicao(null);
      qc.invalidateQueries({ queryKey: ["alocacoes-mes"] });
      qc.invalidateQueries({ queryKey: ["registros-mes"] });
      qc.invalidateQueries({ queryKey: ["alocacoes-current"] });
      qc.invalidateQueries({ queryKey: ["registros"] });
      qc.invalidateQueries({ queryKey: ["registros-week"] });
    },
    onError: (e: ErrorLike) => toast.error(e.message ?? "Erro ao editar as horas da alocação"),
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
      const nome = infoHistoricoById.get(last.funcionario_id)?.nome ?? "funcionário";
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
            {canImportarLegado && <ImportarPlanilhaLegadoDialog />}
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
                {funcionariosQuery.isError && (
                  <LocalReadError
                    message="Não foi possível carregar os funcionários."
                    retry={() => void funcionariosQuery.refetch()}
                  />
                )}
                {obrasQuery.isError && (
                  <LocalReadError
                    message="Não foi possível carregar os centros de custo."
                    retry={() => void obrasQuery.refetch()}
                  />
                )}
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
                                  {rotuloFuncionarioAlocacao(f)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {funcionarioSelecionadoExigeEspecialidade && (
                      <FormField
                        control={form.control}
                        name="especialidade_ajudante"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Atuação do ajudante *</FormLabel>
                            <Select
                              value={field.value ?? ""}
                              onValueChange={(value: EspecialidadeAjudante) =>
                                field.onChange(value)
                              }
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="civil">Civil</SelectItem>
                                <SelectItem value="montagem">Montagem</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
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
                          <FormLabel>{ausenciaPlanejada ? "De" : "Data"}</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              max={ausenciaPlanejada ? undefined : today}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="tipo_registro"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo de registro</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={(value: TipoRegistro) => {
                              field.onChange(value);
                              form.setValue("hora_entrada", "");
                              form.setValue("hora_saida", "");
                              form.setValue("justificativa_extras", "");
                              form.setValue("falta_tipo", null);
                              form.clearErrors([
                                "hora_entrada",
                                "hora_saida",
                                "justificativa_extras",
                                "falta_tipo",
                              ]);
                            }}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="horas">Horas trabalhadas</SelectItem>
                              <SelectItem value="falta">Falta</SelectItem>
                              <SelectItem value="ferias">Férias</SelectItem>
                              <SelectItem value="folga_campo">Folga de campo</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {watchTipoRegistro === "horas" ? (
                      <>
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
                                {previa?.atravessaMeiaNoite && (
                                  <div className="text-xs text-muted-foreground">
                                    Saída em{" "}
                                    {new Date(`${previa.dataSaida}T00:00:00`).toLocaleDateString(
                                      "pt-BR",
                                    )}{" "}
                                    — dia seguinte
                                  </div>
                                )}
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          control={form.control}
                          name="intervalo_minutos"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Intervalo (minutos)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min={0}
                                  step={1}
                                  {...field}
                                  onChange={(event) => field.onChange(event.target.valueAsNumber)}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="rounded-md border bg-muted/40 p-3 text-sm">
                          <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                            Cálculo automático estimado
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">
                              Permanência:{" "}
                              {formatDecimalHours((previa?.permanenciaMinutos ?? 0) / 60)}h
                            </Badge>
                            <Badge variant="outline">
                              Intervalo: {formatDecimalHours((previa?.intervaloMinutos ?? 0) / 60)}h
                            </Badge>
                            <Badge variant="secondary">
                              Total trabalhado: {formatDecimalHours(previa?.total ?? 0)}h
                            </Badge>
                            <Badge variant="outline">
                              Normais: {formatDecimalHours((previa?.minutosNormais ?? 0) / 60)}h
                            </Badge>
                            {(previa?.minutosHe50 ?? 0) > 0 && (
                              <Badge>
                                HE 50%: {formatDecimalHours((previa?.minutosHe50 ?? 0) / 60)}h
                              </Badge>
                            )}
                            {(previa?.minutosHe100 ?? 0) > 0 && (
                              <Badge>
                                HE 100%: {formatDecimalHours((previa?.minutosHe100 ?? 0) / 60)}h
                              </Badge>
                            )}
                            {(previa?.minutosSemAdicionalHe ?? 0) > 0 && (
                              <Badge variant="outline">
                                Sem adicional de HE:{" "}
                                {formatDecimalHours((previa?.minutosSemAdicionalHe ?? 0) / 60)}h
                              </Badge>
                            )}
                            <Badge variant="outline">
                              Noturnas reais:{" "}
                              {formatDecimalHours((previa?.minutosNoturnosReais ?? 0) / 60)}h
                            </Badge>
                            <Badge variant="outline">
                              Noturnas remuneráveis:{" "}
                              {formatDecimalHours((previa?.minutosNoturnosRemuneraveis ?? 0) / 60)}h
                            </Badge>
                            <Badge variant="outline">Adicional noturno: 20%</Badge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Estimativa calculada com rateio proporcional do intervalo entre os
                            períodos da jornada.
                          </div>
                        </div>
                        {previa?.excepcionalAcima12h && (
                          <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                              Jornada excepcional superior a 12 horas. Informe uma justificativa
                              para registrar o lançamento. O registro representa as horas informadas
                              e não constitui validação de conformidade trabalhista.
                            </AlertDescription>
                          </Alert>
                        )}
                        {previa?.excepcionalAcima10h && !previa.excepcionalAcima12h && (
                          <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                              Jornada superior a 10 horas. Confirme o regime autorizado.
                            </AlertDescription>
                          </Alert>
                        )}
                        {previa?.exigeJustificativa && (
                          <FormField
                            control={form.control}
                            name="justificativa_extras"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Justificativa da jornada excepcional *</FormLabel>
                                <FormControl>
                                  <Textarea rows={2} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                      </>
                    ) : watchTipoRegistro === "falta" ? (
                      <div className="space-y-3">
                        <FormField
                          control={form.control}
                          name="falta_tipo"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Classificação da falta *</FormLabel>
                              <Select
                                value={field.value ?? ""}
                                onValueChange={(value: FaltaTipo) => field.onChange(value)}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecione" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {CLASSIFICACOES_FALTA.map((item) => (
                                    <SelectItem key={item.value} value={item.value}>
                                      {item.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Alert>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>{AVISO_FALTA_INTEGRAL}</AlertDescription>
                        </Alert>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <FormField
                          control={form.control}
                          name="data_fim"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Até</FormLabel>
                              <FormControl>
                                <Input type="date" min={watchData} {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Alert>
                          <AlertDescription>
                            Todos os dias corridos do período serão registrados, incluindo sábados e
                            domingos. Não serão lançadas horas.
                          </AlertDescription>
                        </Alert>
                      </div>
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
                      <Button
                        type="submit"
                        disabled={
                          createMutation.isPending ||
                          (watchTipoRegistro === "horas" &&
                            (!previa?.valido ||
                              (previa.exigeJustificativa && !watchJustificativa?.trim())))
                        }
                      >
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

      <Dialog
        open={alocacaoEmEdicao !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !editMutation.isPending) setAlocacaoEmEdicao(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar alocação</DialogTitle>
            <DialogDescription>Ajuste a jornada somente do registro selecionado.</DialogDescription>
          </DialogHeader>
          {alocacaoEmEdicao && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Funcionário</dt>
                  <dd className="font-medium">
                    {infoHistoricoById.get(alocacaoEmEdicao.funcionario_id)?.nome ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Função</dt>
                  <dd className="font-medium">
                    {infoHistoricoById.get(alocacaoEmEdicao.funcionario_id)?.categoria ??
                      "Sem função"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Centro de custo</dt>
                  <dd className="font-medium">{alocacaoEmEdicao.obras?.nome ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Data</dt>
                  <dd className="font-medium">
                    {new Date(alocacaoEmEdicao.data + "T00:00:00").toLocaleDateString("pt-BR")}
                  </dd>
                </div>
              </dl>
              {competenciaUsaSegmentacaoMod(
                calcularCompetencia(alocacaoEmEdicao.data).competencia,
              ) &&
                categoriaEhAjudante(
                  infoHistoricoById.get(alocacaoEmEdicao.funcionario_id)?.categoria,
                ) && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Atuação do ajudante *</label>
                    <Select
                      value={editEspecialidadeAjudante ?? ""}
                      onValueChange={(value: EspecialidadeAjudante) =>
                        setEditEspecialidadeAjudante(value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="civil">Civil</SelectItem>
                        <SelectItem value="montagem">Montagem</SelectItem>
                      </SelectContent>
                    </Select>
                    {!editEspecialidadeAjudante && (
                      <p className="text-sm text-destructive">
                        Informe se o ajudante atuará em Civil ou Montagem.
                      </p>
                    )}
                  </div>
                )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo de registro</label>
                <Select
                  value={editTipoRegistro}
                  onValueChange={(value: TipoRegistro) => {
                    setEditTipoRegistro(value);
                    setEditEntrada("");
                    setEditSaida("");
                    setEditJustificativa("");
                    setEditFaltaTipo(null);
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
              {editTipoRegistro === "horas" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label htmlFor="edit-hora-entrada" className="text-sm font-medium">
                        Hora de entrada
                      </label>
                      <Input
                        id="edit-hora-entrada"
                        type="time"
                        value={editEntrada}
                        onChange={(e) => setEditEntrada(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="edit-hora-saida" className="text-sm font-medium">
                        Hora de saída
                      </label>
                      <Input
                        id="edit-hora-saida"
                        type="time"
                        value={editSaida}
                        onChange={(e) => setEditSaida(e.target.value)}
                      />
                      {editPrevia?.atravessaMeiaNoite && (
                        <div className="text-xs text-muted-foreground">
                          Saída em{" "}
                          {new Date(`${editPrevia.dataSaida}T00:00:00`).toLocaleDateString("pt-BR")}{" "}
                          — dia seguinte
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="edit-intervalo" className="text-sm font-medium">
                      Intervalo (minutos)
                    </label>
                    <Input
                      id="edit-intervalo"
                      type="number"
                      min={0}
                      step={1}
                      value={editIntervaloMinutos}
                      onChange={(e) => setEditIntervaloMinutos(e.target.valueAsNumber)}
                    />
                  </div>
                  {!editHorariosValidos && (
                    <p className="text-sm text-destructive">
                      {editPrevia?.erro ?? "Informe horários e intervalo válidos."}
                    </p>
                  )}
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <div className="text-xs text-muted-foreground">
                      Estimativa com rateio proporcional do intervalo entre os períodos da jornada.
                    </div>
                    <div className="mt-1 font-semibold">
                      Permanência: {formatDecimalHours((editPrevia?.permanenciaMinutos ?? 0) / 60)}h
                      · Intervalo: {formatDecimalHours((editPrevia?.intervaloMinutos ?? 0) / 60)}h ·
                      Total: {formatDecimalHours(editPrevia?.total ?? 0)}h
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDecimalHours((editPrevia?.minutosNormais ?? 0) / 60)}h normais ·{" "}
                      {formatDecimalHours((editPrevia?.minutosHe50 ?? 0) / 60)}h HE 50% ·{" "}
                      {formatDecimalHours((editPrevia?.minutosHe100 ?? 0) / 60)}h HE 100% ·{" "}
                      {formatDecimalHours((editPrevia?.minutosNoturnosRemuneraveis ?? 0) / 60)}h
                      noturnas remuneráveis
                    </div>
                  </div>
                  {editPrevia?.excepcionalAcima12h && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Jornada excepcional acima de 12h</AlertTitle>
                      <AlertDescription>
                        Jornada excepcional superior a 12 horas. Informe uma justificativa para
                        registrar o lançamento. O registro representa as horas informadas e não
                        constitui validação de conformidade trabalhista.
                      </AlertDescription>
                    </Alert>
                  )}
                  {editPrevia?.excepcionalAcima10h && !editPrevia.excepcionalAcima12h && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Jornada superior a 10 horas. Confirme o regime autorizado.
                      </AlertDescription>
                    </Alert>
                  )}
                  {editPrevia?.exigeJustificativa && (
                    <div className="space-y-2">
                      <label htmlFor="edit-justificativa" className="text-sm font-medium">
                        Justificativa da jornada excepcional *
                      </label>
                      <Textarea
                        id="edit-justificativa"
                        rows={2}
                        value={editJustificativa}
                        onChange={(e) => setEditJustificativa(e.target.value)}
                      />
                      {!editJustificativaValida && (
                        <p className="text-sm text-destructive">Informe a justificativa.</p>
                      )}
                    </div>
                  )}
                </>
              ) : editTipoRegistro === "falta" ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Classificação da falta *</label>
                    <Select
                      value={editFaltaTipo ?? ""}
                      onValueChange={(value: FaltaTipo) => setEditFaltaTipo(value)}
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
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{AVISO_FALTA_INTEGRAL}</AlertDescription>
                  </Alert>
                </div>
              ) : (
                <Alert>
                  <AlertDescription>
                    {rotuloTipoRegistro(editTipoRegistro)} — nenhuma hora será lançada neste dia.
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <label htmlFor="edit-observacoes" className="text-sm font-medium">
                  Observações (opcional)
                </label>
                <Textarea
                  id="edit-observacoes"
                  rows={2}
                  value={editObservacoes}
                  onChange={(e) => setEditObservacoes(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAlocacaoEmEdicao(null)}
                  disabled={editMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => editMutation.mutate()}
                  disabled={!editPodeSalvar || editMutation.isPending}
                >
                  {editMutation.isPending ? "Salvando..." : "Salvar alteração"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      {obrasQuery.isError && (
        <div className="mb-4">
          <LocalReadError
            message="Não foi possível carregar os centros de custo."
            retry={() => void obrasQuery.refetch()}
          />
        </div>
      )}

      {(alocacoesQuery.isError || registrosQuery.isError) && (
        <div className="mb-4 space-y-2">
          {alocacoesQuery.isError && (
            <LocalReadError
              message="Não foi possível carregar as alocações desta competência."
              retry={() => void alocacoesQuery.refetch()}
            />
          )}
          {registrosQuery.isError && (
            <LocalReadError
              message="Não foi possível carregar os registros desta competência."
              retry={() => void registrosQuery.refetch()}
            />
          )}
        </div>
      )}

      {(funcionariosHistoricosQuery.isError || auditUsersQuery.isError) && (
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Alguns detalhes complementares não foram carregados.</AlertTitle>
          <AlertDescription>
            As alocações permanecem disponíveis; nomes históricos ou dados de auditoria podem
            aparecer indisponíveis.
          </AlertDescription>
        </Alert>
      )}

      {alocacoesQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : alocacoesQuery.isError || registrosQuery.isError ? null : porObra.length === 0 ? (
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
            const funcsArr = ordenarFuncionariosPorTipoENome(
              Array.from(obra.funcs.entries()).map(([id, v]) => ({ id, ...v })),
              categorias,
              (funcionario) => funcionario.categoria,
            );
            const composicaoEquipe = Array.from(
              funcsArr.reduce((acc, f) => {
                acc.set(f.categoria, (acc.get(f.categoria) ?? 0) + 1);
                return acc;
              }, new Map<string, number>()),
            ).sort(([categoriaA], [categoriaB]) =>
              compararCategoriasPorTipoENome(categoriaA, categoriaB, categorias),
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
                      <div className="flex flex-wrap gap-2">
                        <AlocarPeriodoDialog obraId={obra.id} obraNome={obra.nome} />
                        <CopiarDiaAnteriorDialog obraId={obra.id} obraNome={obra.nome} />
                      </div>
                    </div>

                    <TabsContent value="calendario" className="mt-3 space-y-4">
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                          Funcionários na competência
                        </div>
                        <div className="overflow-hidden rounded-md border bg-background">
                          <div className="hidden grid-cols-[minmax(12rem,2fr)_minmax(9rem,1.25fr)_5rem_7rem_7rem_7rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground sm:grid">
                            <div>Funcionário</div>
                            <div>Função</div>
                            <div>Dias</div>
                            <div>Horas normais</div>
                            <div>HE 50%</div>
                            <div>HE 100%</div>
                          </div>
                          <ul className="divide-y">
                            {funcsArr.map((f) => (
                              <li
                                key={f.id}
                                className="grid grid-cols-3 items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm sm:grid-cols-[minmax(12rem,2fr)_minmax(9rem,1.25fr)_5rem_7rem_7rem_7rem]"
                              >
                                <div className="col-span-3 min-w-0 sm:col-span-1">
                                  <div className="truncate font-medium">{f.nome}</div>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {f.semHe > 0 && (
                                      <Badge variant="outline" className="text-[9px]">
                                        {formatDecimalHours(f.semHe)}h sem adicional de HE
                                      </Badge>
                                    )}
                                    {f.noturnasRemuneraveis > 0 && (
                                      <Badge variant="outline" className="text-[9px]">
                                        {formatDecimalHours(f.noturnasRemuneraveis)}h noturnas
                                        remuneráveis
                                      </Badge>
                                    )}
                                    {f.excepcional && (
                                      <Badge variant="destructive" className="text-[9px]">
                                        Jornada excepcional
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="col-span-3 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1 sm:text-sm">
                                  {f.categoria}
                                </div>
                                <div>
                                  <div className="mb-1 text-[10px] text-muted-foreground sm:hidden">
                                    Dias
                                  </div>
                                  <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400">
                                    {f.dias.size}d
                                  </Badge>
                                </div>
                                <div>
                                  <div className="mb-1 text-[10px] text-muted-foreground sm:hidden">
                                    Horas normais
                                  </div>
                                  <Badge variant="secondary">{formatDecimalHours(f.hn)}h</Badge>
                                </div>
                                <div>
                                  <div className="mb-1 text-[10px] text-muted-foreground sm:hidden">
                                    HE 50%
                                  </div>
                                  {f.he50 > 0 ? (
                                    <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">
                                      {formatDecimalHours(f.he50)}h
                                    </Badge>
                                  ) : (
                                    <span className="pl-2 text-muted-foreground">-</span>
                                  )}
                                </div>
                                <div>
                                  <div className="mb-1 text-[10px] text-muted-foreground sm:hidden">
                                    HE 100%
                                  </div>
                                  {f.he100 > 0 ? (
                                    <Badge className="bg-rose-500/15 text-rose-700 hover:bg-rose-500/15 dark:text-rose-400">
                                      {formatDecimalHours(f.he100)}h
                                    </Badge>
                                  ) : (
                                    <span className="pl-2 text-muted-foreground">-</span>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
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
                                    <Dialog key={d}>
                                      <DialogTrigger asChild>
                                        <button
                                          type="button"
                                          className={`${base} ${tone}${todayRing}`}
                                        >
                                          <span className="font-medium">{dayNum}</span>
                                          <span className="text-[10px] text-primary">{count}</span>
                                        </button>
                                      </DialogTrigger>
                                      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
                                        <DialogHeader>
                                          <DialogTitle>
                                            Efetivo de{" "}
                                            {new Date(d + "T00:00:00").toLocaleDateString("pt-BR", {
                                              weekday: "long",
                                              day: "2-digit",
                                              month: "long",
                                            })}
                                          </DialogTitle>
                                          <DialogDescription>
                                            {obra.nome} · {count}{" "}
                                            {count === 1 ? "registro" : "registros"}
                                          </DialogDescription>
                                        </DialogHeader>
                                        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
                                          {items.map((a) => {
                                            const h = horasMap.get(
                                              `${a.funcionario_id}|${a.obra_id}|${a.data}`,
                                            );
                                            const composicaoHoras = h
                                              ? comporHorasParaVisualizacao({
                                                  data: a.data,
                                                  horasNormais: h.hn,
                                                  horasExtras: h.he,
                                                  detalhe: h.detalhe,
                                                })
                                              : null;
                                            const podeEditar =
                                              canEditAllocationHoursByRole ||
                                              (a.created_by === user?.id &&
                                                (!h || h.createdBy === user?.id));
                                            const creatorName = a.created_by
                                              ? (auditUserById.get(a.created_by) ??
                                                "Usuário não identificado")
                                              : "Usuário não identificado";
                                            const createdAt = formatAuditDate(a.created_at);
                                            const hasRecordedEdit =
                                              !!h?.updatedBy &&
                                              !!h.updatedAt &&
                                              !!h.createdAt &&
                                              new Date(h.updatedAt).getTime() >
                                                new Date(h.createdAt).getTime() + 1000;
                                            const editorName =
                                              hasRecordedEdit && h?.updatedBy
                                                ? (auditUserById.get(h.updatedBy) ??
                                                  "Usuário não identificado")
                                                : null;
                                            const updatedAt = hasRecordedEdit
                                              ? formatAuditDate(h?.updatedAt)
                                              : null;
                                            return (
                                              <li
                                                key={a.id}
                                                className="flex items-center justify-between gap-2 rounded border p-2"
                                              >
                                                <div className="min-w-0 flex-1">
                                                  <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                                                    <span className="truncate">
                                                      {infoHistoricoById.get(a.funcionario_id)
                                                        ?.nome ?? "—"}
                                                    </span>
                                                    {infoHistoricoById.get(a.funcionario_id)
                                                      ?.ativo === false && (
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
                                                      h.tipoRegistro !== "horas" ? (
                                                        <>
                                                          <Badge
                                                            variant={
                                                              h.tipoRegistro === "falta"
                                                                ? "destructive"
                                                                : "secondary"
                                                            }
                                                            className="text-[10px]"
                                                          >
                                                            {rotuloTipoRegistro(h.tipoRegistro)}
                                                          </Badge>
                                                          {h.tipoRegistro === "falta" && (
                                                            <Badge
                                                              variant="outline"
                                                              className="text-[10px]"
                                                            >
                                                              {rotuloFalta(h.faltaTipo)}
                                                            </Badge>
                                                          )}
                                                          {h.observacoes && (
                                                            <span className="w-full text-[10px] text-muted-foreground">
                                                              {h.observacoes}
                                                            </span>
                                                          )}
                                                        </>
                                                      ) : (
                                                        composicaoHoras?.linhas.map((linha) => (
                                                          <Badge
                                                            key={linha.tipo}
                                                            variant="secondary"
                                                            className={
                                                              linha.tipo === "he100"
                                                                ? "bg-rose-500/15 text-rose-700 text-[10px] dark:text-rose-400"
                                                                : linha.tipo === "he50"
                                                                  ? "bg-amber-500/15 text-amber-700 text-[10px] dark:text-amber-400"
                                                                  : "bg-emerald-500/15 text-emerald-700 text-[10px] dark:text-emerald-400"
                                                            }
                                                          >
                                                            {linha.texto}
                                                          </Badge>
                                                        ))
                                                      )
                                                    ) : (
                                                      <Badge
                                                        variant="outline"
                                                        className="text-[10px] text-muted-foreground"
                                                      >
                                                        sem horas
                                                      </Badge>
                                                    )}
                                                  </div>
                                                  {composicaoHoras?.jornadaExcepcional && (
                                                    <Badge
                                                      variant="destructive"
                                                      className="mt-1 text-[10px]"
                                                    >
                                                      Jornada excepcional
                                                    </Badge>
                                                  )}
                                                  {canViewAllocationAudit && (
                                                    <div className="mt-1.5 border-t pt-1.5 text-[10px] leading-4 text-muted-foreground">
                                                      {editorName ? (
                                                        <>
                                                          Última edição: {editorName}
                                                          {updatedAt && <> em {updatedAt}</>}
                                                        </>
                                                      ) : (
                                                        <>
                                                          Lançado por: {creatorName}
                                                          {createdAt && <> em {createdAt}</>}
                                                        </>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                                <div className="flex flex-shrink-0 items-center gap-1">
                                                  {podeEditar && !a.registroOnly && (
                                                    <Button
                                                      size="sm"
                                                      variant="ghost"
                                                      onClick={() => abrirEdicao(a)}
                                                    >
                                                      <Pencil className="mr-1 h-3.5 w-3.5" />
                                                      Editar
                                                    </Button>
                                                  )}
                                                  {!a.registroOnly && (
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
                                                  )}
                                                </div>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                        <DialogFooter className="border-t pt-4">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() =>
                                              void exportarEfetivoDiario(obra, d, items)
                                            }
                                          >
                                            <FileSpreadsheet className="mr-2 h-4 w-4" />
                                            Exportar efetivo
                                          </Button>
                                        </DialogFooter>
                                      </DialogContent>
                                    </Dialog>
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
                        categorias={categorias}
                        initialWeekStart={semanaInicial}
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
