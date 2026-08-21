import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarClock, History, Pencil, Plus, Search, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { tipoCategoria, useCategorias } from "@/lib/categorias";
import { canDeactivateEmployee, canEditEmployeeTerminationDate } from "@/lib/access-control";
import { useAuth } from "@/hooks/use-auth";
import { calcularCusto, ENCARGOS_PCT, fmtBRL, useBeneficios, useSegurosVida } from "@/lib/custos";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/funcionarios")({
  component: FuncionariosPage,
});

const PAGE_SIZE = 10;

const funcSchema = z
  .object({
    nome: z.string().trim().min(3, "Mínimo 3 caracteres").max(120),
    categoria_mo: z.string().min(1, "Categoria obrigatória"),
    salario: z.coerce.number().nonnegative("Salário inválido"),
    data_admissao: z.string(),
    regime: z.enum(["", "local", "alojado"]),
    regime_vigencia_inicio: z.string(),
  })
  .refine((value) => !value.regime || Boolean(value.regime_vigencia_inicio), {
    path: ["regime_vigencia_inicio"],
    message: "Informe o início da vigência do regime",
  });
type FuncForm = z.infer<typeof funcSchema>;
type FuncionarioInsert = Database["public"]["Tables"]["funcionarios"]["Insert"];
type FuncionarioUpdate = Database["public"]["Tables"]["funcionarios"]["Update"];
type Funcionario = {
  id: string;
  nome: string;
  categoria_mo: string;
  ativo: boolean;
  created_at: string;
  salario: number | null;
  encargos: number | null;
  data_admissao: string | null;
  data_desligamento: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  visivel_obras_control: boolean | null;
  regime: "local" | "alojado" | null;
  regime_vigencia_inicio: string | null;
};

type Regime = "local" | "alojado";
type RegimeVigencia = Database["public"]["Tables"]["funcionario_regime_vigencias"]["Row"];

const hojeISO = () => new Date().toISOString().slice(0, 10);
const regimeLabel = (regime: Regime | null) =>
  regime === "local" ? "Local" : regime === "alojado" ? "Alojado" : "Não informado";

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}
    >
      <span>{label}</span>
      <span className={bold ? "text-foreground" : "text-foreground"}>{fmtBRL(value)}</span>
    </div>
  );
}

function databaseError(error: unknown) {
  if (typeof error !== "object" || error === null) return { message: "", code: "" };
  const candidate = error as { message?: unknown; code?: unknown };
  return {
    message: typeof candidate.message === "string" ? candidate.message : "",
    code: typeof candidate.code === "string" ? candidate.code : "",
  };
}

function FuncionariosPage() {
  const qc = useQueryClient();
  const { isManagerOrAbove, role } = useAuth();
  const canSeeSalario = isManagerOrAbove;
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<"all" | "MOI" | "MOD">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "ativo" | "inativo">("ativo");
  const [obraFilter, setObraFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Funcionario | null>(null);
  const [deleting, setDeleting] = useState<Funcionario | null>(null);
  const [deactivating, setDeactivating] = useState<Funcionario | null>(null);
  const [terminationDate, setTerminationDate] = useState("");
  const [salarioDirty, setSalarioDirty] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRegime, setBulkRegime] = useState<Regime>("local");
  const [bulkVigencia, setBulkVigencia] = useState(hojeISO());
  const [historyEmployee, setHistoryEmployee] = useState<Funcionario | null>(null);

  const { data: categorias } = useCategorias();
  const moi = useMemo(() => (categorias ?? []).filter((c) => c.tipo === "MOI"), [categorias]);
  const mod = useMemo(() => (categorias ?? []).filter((c) => c.tipo === "MOD"), [categorias]);

  const {
    data: funcionarios,
    isLoading,
    error: funcionariosError,
  } = useQuery({
    queryKey: ["funcionarios-cadastro"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obras_control_funcionarios_safe");
      if (error) throw error;
      return data satisfies Array<Funcionario>;
    },
  });

  const { data: tabelaSalarios } = useQuery({
    queryKey: ["categoria_salarios"],
    enabled: canSeeSalario,
    queryFn: async () => {
      const { data, error } = await supabase.from("categoria_salarios").select("*");
      if (error) throw error;
      const map = new Map<string, { salario: number; encargos: number }>();
      for (const r of data ?? [])
        map.set(r.categoria, { salario: Number(r.salario), encargos: Number(r.encargos) });
      return map;
    },
  });

  const { data: obras } = useQuery({
    queryKey: ["obras"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("obras")
        .select("id,nome,visivel_obras_control")
        .order("nome");
      if (error) throw error;
      return data.filter((obra) => obra.visivel_obras_control !== false);
    },
  });

  const { data: currentAlocs } = useQuery({
    queryKey: ["alocacoes-current"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alocacoes")
        .select("funcionario_id, obra_id, data, obras(nome)")
        .order("data", { ascending: false });
      if (error) throw error;
      const map = new Map<string, { obra_id: string; nome: string; data: string }>();
      for (const a of data ?? []) {
        if (!map.has(a.funcionario_id)) {
          map.set(a.funcionario_id, {
            obra_id: a.obra_id,
            nome: a.obras?.nome ?? "—",
            data: a.data,
          });
        }
      }
      return map;
    },
  });

  const filtered = useMemo(() => {
    const brutos = funcionarios ?? [];
    const naoExcluidos = brutos.filter((f) => f.deleted_at == null);
    const visiveis = naoExcluidos.filter((f) => f.visivel_obras_control === true);
    const porStatus = visiveis.filter((f) => {
      if (statusFilter === "ativo") return f.ativo === true;
      if (statusFilter === "inativo") return f.ativo === false;
      return true;
    });
    const porCategoria = porStatus.filter(
      (f) => tipoFilter === "all" || tipoCategoria(f.categoria_mo, categorias) === tipoFilter,
    );
    const porCentroCusto =
      obraFilter === "all"
        ? porCategoria
        : porCategoria.filter((f) => currentAlocs?.get(f.id)?.obra_id === obraFilter);
    const termo = search.trim().toLocaleLowerCase("pt-BR");
    const porBusca = porCentroCusto.filter(
      (f) => !termo || f.nome.toLocaleLowerCase("pt-BR").includes(termo),
    );

    return porBusca;
  }, [funcionarios, search, tipoFilter, statusFilter, obraFilter, currentAlocs, categorias]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    if (page >= totalPages) setPage(totalPages - 1);
  }, [page, totalPages]);

  const { data: beneficios } = useBeneficios();
  const { data: segurosVida } = useSegurosVida({ enabled: canSeeSalario });

  const form = useForm<FuncForm>({
    resolver: zodResolver(funcSchema),
    defaultValues: {
      nome: "",
      salario: 0,
      categoria_mo: "",
      data_admissao: "",
      regime: "",
      regime_vigencia_inicio: "",
    },
  });

  const watchedCategoria = form.watch("categoria_mo");
  const watchedSalario = form.watch("salario");
  useEffect(() => {
    if (!open || !watchedCategoria || !tabelaSalarios) return;
    if (editing) return;
    if (salarioDirty) return;
    const padrao = tabelaSalarios.get(watchedCategoria);
    if (padrao && canSeeSalario) {
      form.setValue("salario", padrao.salario);
    }
  }, [watchedCategoria, tabelaSalarios, open, editing, salarioDirty, canSeeSalario, form]);

  const seguroAtual = segurosVida?.get(watchedCategoria) ?? 0;
  const breakdown = useMemo(
    () => calcularCusto(Number(watchedSalario) || 0, beneficios ?? null, seguroAtual),
    [watchedSalario, beneficios, seguroAtual],
  );

  function openCreate() {
    setEditing(null);
    setSalarioDirty(false);
    form.reset({
      nome: "",
      salario: 0,
      categoria_mo: "",
      data_admissao: "",
      regime: "",
      regime_vigencia_inicio: "",
    });
    setOpen(true);
  }

  function openEdit(f: Funcionario) {
    setEditing(f);
    setSalarioDirty(false);
    form.reset({
      nome: f.nome,
      categoria_mo: f.categoria_mo,
      salario: f.salario != null ? Number(f.salario) : 0,
      data_admissao: f.data_admissao ?? "",
      regime: f.regime ?? "",
      regime_vigencia_inicio: f.regime_vigencia_inicio ?? "",
    });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FuncForm) => {
      if (canSeeSalario && values.salario <= 0) {
        throw new Error("Informe um salário válido para a função selecionada.");
      }
      let funcionarioId = editing?.id;
      if (editing) {
        const patch: FuncionarioUpdate = {
          nome: values.nome,
          categoria_mo: values.categoria_mo,
          data_admissao: values.data_admissao || null,
        };
        if (canSeeSalario) {
          patch.salario = values.salario;
          patch.encargos = Number(values.salario) * ENCARGOS_PCT;
        }
        const { error } = await supabase.from("funcionarios").update(patch).eq("id", editing.id);
        if (error) throw error;
      } else {
        const payload: FuncionarioInsert = {
          nome: values.nome,
          categoria_mo: values.categoria_mo,
          data_admissao: values.data_admissao || null,
          ativo: true,
          visivel_obras_control: true,
        };
        if (canSeeSalario) {
          payload.salario = values.salario;
          payload.encargos = Number(values.salario) * ENCARGOS_PCT;
        }
        const { data, error } = await supabase
          .from("funcionarios")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        funcionarioId = data.id;
      }
      if (values.regime && values.regime_vigencia_inicio && funcionarioId) {
        const { error } = await supabase.rpc("definir_regime_funcionarios", {
          p_funcionario_ids: [funcionarioId],
          p_regime: values.regime,
          p_vigencia_inicio: values.regime_vigencia_inicio,
          p_origem: editing ? "edicao" : "cadastro",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Funcionário atualizado" : "Funcionário cadastrado");
      qc.invalidateQueries({ queryKey: ["funcionarios-cadastro"] });
      setOpen(false);
      setEditing(null);
      form.reset();
    },
    onError: (error: unknown) => {
      const { message, code } = databaseError(error);
      if (message.includes("FUNCIONARIO_DUPLICADO_EXCLUIDO")) {
        toast.error(
          "Existe um funcionário excluído com este nome. Verifique se o cadastro anterior foi excluído por erro antes de criar um novo.",
        );
      } else if (message.includes("FUNCIONARIO_DUPLICADO_CADASTRADO") || code === "23505") {
        toast.error(
          "Já existe um funcionário cadastrado com este nome. Verifique o cadastro antes de adicionar novamente.",
        );
      } else toast.error(message || "Erro ao salvar");
    },
  });

  const bulkRegimeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedIds.size) throw new Error("Selecione ao menos um funcionário.");
      if (!bulkVigencia) throw new Error("Informe a data de vigência.");
      const { error } = await supabase.rpc("definir_regime_funcionarios", {
        p_funcionario_ids: [...selectedIds],
        p_regime: bulkRegime,
        p_vigencia_inicio: bulkVigencia,
        p_origem: "lote",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Regime definido para ${selectedIds.size} funcionário(s).`);
      setSelectedIds(new Set());
      setBulkOpen(false);
      qc.invalidateQueries({ queryKey: ["funcionarios-cadastro"] });
    },
    onError: (error: unknown) =>
      toast.error(databaseError(error).message || "Erro ao definir regime em lote"),
  });

  const { data: regimeHistory = [], isLoading: regimeHistoryLoading } = useQuery({
    queryKey: ["funcionario-regime-historico", historyEmployee?.id],
    enabled: Boolean(historyEmployee),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionario_regime_vigencias")
        .select("*")
        .eq("funcionario_id", historyEmployee!.id)
        .order("vigencia_inicio", { ascending: false });
      if (error) throw error;
      return data satisfies RegimeVigencia[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (funcionario: Funcionario) => {
      const { error } = await supabase
        .from("funcionarios")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", funcionario.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Funcionário excluído. O histórico foi preservado.");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["funcionarios-cadastro"] });
      qc.invalidateQueries({ queryKey: ["funcionarios-min-all"] });
    },
    onError: (error: unknown) =>
      toast.error(databaseError(error).message || "Erro ao excluir funcionário"),
  });

  const deactivateMutation = useMutation({
    mutationFn: async ({ funcionario, date }: { funcionario: Funcionario; date: string }) => {
      if (!date) throw new Error("Informe a data real de desligamento.");
      if (funcionario.data_admissao && date < funcionario.data_admissao) {
        throw new Error("A data de desligamento não pode ser anterior à data de admissão.");
      }
      const { data: ultimaAlocacao, error: alocacaoError } = await supabase
        .from("alocacoes")
        .select("data")
        .eq("funcionario_id", funcionario.id)
        .order("data", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (alocacaoError) throw alocacaoError;
      if (ultimaAlocacao?.data && date < ultimaAlocacao.data) {
        const dataFormatada = new Date(ultimaAlocacao.data + "T00:00:00").toLocaleDateString(
          "pt-BR",
        );
        throw new Error(
          `Este funcionário possui alocações até ${dataFormatada}. A data de desligamento não pode ser anterior à última alocação registrada.`,
        );
      }
      const { error } = await supabase
        .from("funcionarios")
        .update({ ativo: false, data_desligamento: date, deleted_at: null, deleted_by: null })
        .eq("id", funcionario.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        deactivating?.ativo
          ? "Funcionário desligado. O histórico foi preservado."
          : "Data de desligamento atualizada. O histórico foi preservado.",
      );
      setDeactivating(null);
      setTerminationDate("");
      qc.invalidateQueries({ queryKey: ["funcionarios-cadastro"] });
      qc.invalidateQueries({ queryKey: ["funcionarios-min-all"] });
    },
    onError: (error: unknown) => {
      const message = databaseError(error).message;
      if (message.includes("DATA_DESLIGAMENTO_ANTERIOR_ADMISSAO")) {
        toast.error("A data de desligamento não pode ser anterior à data de admissão.");
      } else if (message.includes("ULTIMA_ALOCACAO_FUNCIONARIO:")) {
        const data = message.split("ULTIMA_ALOCACAO_FUNCIONARIO:")[1]?.split(/[\s\n]/)[0];
        toast.error(
          `Este funcionário possui alocações até ${data}. A data de desligamento não pode ser anterior à última alocação registrada.`,
        );
      } else {
        toast.error(message || "Erro ao salvar data de desligamento");
      }
    },
  });

  return (
    <div>
      <PageHeader
        title="Funcionários"
        description="Cadastro de colaboradores e categorias de mão de obra."
        actions={
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) setEditing(null);
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Novo funcionário
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Editar funcionário" : "Cadastrar funcionário"}
                </DialogTitle>
                <DialogDescription>
                  {editing
                    ? "Atualize os dados do colaborador."
                    : "Preencha os dados do colaborador. Salário e encargos são preenchidos automaticamente conforme a categoria."}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="nome"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome completo</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="João da Silva" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="categoria_mo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categoria</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {moi.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>MOI – Mão de obra indireta</SelectLabel>
                                {moi.map((c) => (
                                  <SelectItem key={c.nome} value={c.nome}>
                                    {c.nome}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {mod.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>MOD – Mão de obra direta</SelectLabel>
                                {mod.map((c) => (
                                  <SelectItem key={c.nome} value={c.nome}>
                                    {c.nome}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="data_admissao"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data de admissão</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="regime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Regime</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Não informado" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="local">Local</SelectItem>
                              <SelectItem value="alojado">Alojado</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="regime_vigencia_inicio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Início da vigência</FormLabel>
                          <FormControl>
                            <Input type="date" max={hojeISO()} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {editing && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryEmployee(editing)}
                    >
                      <History className="mr-2 h-4 w-4" />
                      Ver histórico de regime
                    </Button>
                  )}
                  {canSeeSalario && (
                    <>
                      <FormField
                        control={form.control}
                        name="salario"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Salário (R$)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                {...field}
                                onChange={(e) => {
                                  setSalarioDirty(true);
                                  field.onChange(e);
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5">
                        <div className="font-medium text-foreground mb-1">
                          Composição do custo mensal (calculado)
                        </div>
                        <Row
                          label={`Encargos (${(ENCARGOS_PCT * 100).toFixed(1)}%)`}
                          value={breakdown.encargos}
                        />
                        <Row label="Provisão 13º (1/12)" value={breakdown.prov13} />
                        <Row
                          label="Provisão aviso prévio (1/12)"
                          value={breakdown.provAvisoPrevio}
                        />
                        <Row label="Provisão férias + 1/3" value={breakdown.provFerias} />
                        <Row
                          label="Benefícios (médica, odonto, VA, multi)"
                          value={breakdown.beneficios}
                        />
                        <Row label="Seguro de vida (por categoria)" value={breakdown.seguroVida} />
                        <Separator className="my-2" />
                        <Row label="Custo total mensal" value={breakdown.total} bold />
                      </div>
                    </>
                  )}
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? "Salvando..." : "Salvar"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[200px] flex-1">
            <label className="text-xs text-muted-foreground">Buscar</label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Nome"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Categoria</label>
            <Select
              value={tipoFilter}
              onValueChange={(v) => {
                setTipoFilter(v as "all" | "MOI" | "MOD");
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="MOI">MOI</SelectItem>
                <SelectItem value="MOD">MOD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as "all" | "ativo" | "inativo");
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Centro de custo atual</label>
            <Select
              value={obraFilter}
              onValueChange={(v) => {
                setObraFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
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

      {selectedIds.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3">
          <span className="text-sm font-medium">
            {selectedIds.size} funcionário(s) selecionado(s)
          </span>
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            Definir regime
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}

      {funcionariosError ? (
        <Card>
          <CardContent className="py-10 text-center text-destructive">
            Não foi possível carregar os funcionários: {databaseError(funcionariosError).message}
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Selecionar funcionários desta página"
                      checked={
                        pageItems.length > 0 && pageItems.every((item) => selectedIds.has(item.id))
                      }
                      onCheckedChange={(checked) => {
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          for (const item of pageItems)
                            if (checked) next.add(item.id);
                            else next.delete(item.id);
                          return next;
                        });
                      }}
                    />
                  </TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Centro de custo atual</TableHead>
                  <TableHead>Admissão</TableHead>
                  <TableHead>Regime</TableHead>
                  {canSeeSalario && <TableHead className="text-right">Salário</TableHead>}
                  {canSeeSalario && <TableHead className="text-right">Custo total</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={canSeeSalario ? 11 : 9}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Nenhum funcionário encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageItems.map((f) => {
                    const cur = currentAlocs?.get(f.id);
                    const tipo = tipoCategoria(f.categoria_mo, categorias);
                    const custo = canSeeSalario
                      ? calcularCusto(
                          f.salario,
                          beneficios ?? null,
                          segurosVida?.get(f.categoria_mo) ?? 0,
                        )
                      : null;
                    return (
                      <TableRow key={f.id}>
                        <TableCell>
                          <Checkbox
                            aria-label={`Selecionar ${f.nome}`}
                            checked={selectedIds.has(f.id)}
                            onCheckedChange={(checked) =>
                              setSelectedIds((current) => {
                                const next = new Set(current);
                                if (checked) next.add(f.id);
                                else next.delete(f.id);
                                return next;
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="font-medium">{f.nome}</TableCell>
                        <TableCell>{f.categoria_mo}</TableCell>
                        <TableCell>{tipo && <Badge variant="outline">{tipo}</Badge>}</TableCell>
                        <TableCell className="text-sm">
                          {cur?.nome ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={f.regime ? "outline" : "destructive"}>
                            {regimeLabel(f.regime)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {f.data_admissao
                            ? new Date(f.data_admissao + "T00:00:00").toLocaleDateString("pt-BR")
                            : "—"}
                        </TableCell>
                        {canSeeSalario && (
                          <TableCell className="text-right">
                            {f.salario != null ? fmtBRL(Number(f.salario)) : "—"}
                          </TableCell>
                        )}
                        {canSeeSalario && (
                          <TableCell className="text-right font-medium">
                            {custo && f.salario != null ? fmtBRL(custo.total) : "—"}
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex flex-col items-start gap-0.5">
                            <Badge variant={f.ativo ? "default" : "secondary"}>
                              {f.ativo ? "Ativo" : "Desligado"}
                            </Badge>
                            {!f.ativo && f.data_desligamento && (
                              <span className="text-[10px] text-muted-foreground">
                                desde{" "}
                                {new Date(f.data_desligamento + "T00:00:00").toLocaleDateString(
                                  "pt-BR",
                                )}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(f)}
                              aria-label="Editar"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setHistoryEmployee(f)}
                              aria-label="Histórico de regime"
                            >
                              <History className="h-4 w-4" />
                            </Button>
                            {canDeactivateEmployee(role, f.ativo) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setDeactivating(f);
                                  setTerminationDate("");
                                }}
                                aria-label="Desligar"
                              >
                                <UserMinus className="h-4 w-4" />
                              </Button>
                            )}
                            {canEditEmployeeTerminationDate(role, f.ativo) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setDeactivating(f);
                                  setTerminationDate(f.data_desligamento ?? "");
                                }}
                                aria-label="Editar data de desligamento"
                              >
                                <CalendarClock className="h-4 w-4" />
                              </Button>
                            )}
                            {isManagerOrAbove && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleting(f)}
                                aria-label="Excluir"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <div>{filtered.length} funcionário(s)</div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span>
            Página {page + 1} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(value) => {
          if (!value) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir funcionário</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este funcionário? Use esta opção apenas para cadastro
              incorreto. O funcionário não aparecerá mais na listagem padrão nem ficará disponível
              para novas alocações.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={Boolean(deactivating)}
        onOpenChange={(value) => {
          if (!value) {
            setDeactivating(null);
            setTerminationDate("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deactivating?.ativo ? "Desligar funcionário" : "Editar data de desligamento"}
            </DialogTitle>
            <DialogDescription>
              Informe a data real de desligamento deste funcionário. O histórico será preservado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm font-medium">{deactivating?.nome}</div>
            <label className="text-sm font-medium">Data de desligamento</label>
            <Input
              type="date"
              value={terminationDate}
              onChange={(e) => setTerminationDate(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeactivating(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!terminationDate || deactivateMutation.isPending}
              onClick={() =>
                deactivating &&
                deactivateMutation.mutate({ funcionario: deactivating, date: terminationDate })
              }
            >
              {deactivateMutation.isPending
                ? "Salvando..."
                : deactivating?.ativo
                  ? "Desligar"
                  : "Salvar data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Definir regime em lote</DialogTitle>
            <DialogDescription>
              A nova vigência será registrada para {selectedIds.size} funcionário(s), preservando o
              histórico anterior.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Regime</label>
              <Select value={bulkRegime} onValueChange={(value: Regime) => setBulkRegime(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="alojado">Alojado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Início da vigência</label>
              <Input
                type="date"
                max={hojeISO()}
                value={bulkVigencia}
                onChange={(event) => setBulkVigencia(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!bulkVigencia || bulkRegimeMutation.isPending}
              onClick={() => bulkRegimeMutation.mutate()}
            >
              {bulkRegimeMutation.isPending ? "Salvando..." : "Salvar regime"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(historyEmployee)}
        onOpenChange={(value) => {
          if (!value) setHistoryEmployee(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Histórico de regime</DialogTitle>
            <DialogDescription>{historyEmployee?.nome}</DialogDescription>
          </DialogHeader>
          {regimeHistoryLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : regimeHistory.length === 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Regime não informado.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Regime</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Fim</TableHead>
                  <TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regimeHistory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{regimeLabel(item.regime)}</TableCell>
                    <TableCell>
                      {new Date(`${item.vigencia_inicio}T00:00:00`).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      {item.vigencia_fim
                        ? new Date(`${item.vigencia_fim}T00:00:00`).toLocaleDateString("pt-BR")
                        : "Atual"}
                    </TableCell>
                    <TableCell className="capitalize">{item.origem}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
