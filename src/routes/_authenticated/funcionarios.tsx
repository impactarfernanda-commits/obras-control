import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CalendarClock, Pencil, Plus, Search, Trash2, UserMinus } from "lucide-react";
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
import { useAuth } from "@/hooks/use-auth";
import { calcularCusto, ENCARGOS_PCT, fmtBRL, useBeneficios, useSegurosVida } from "@/lib/custos";
import { Separator } from "@/components/ui/separator";
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

const funcSchema = z.object({
  nome: z.string().trim().min(3, "Mínimo 3 caracteres").max(120),
  categoria_mo: z.string().min(1, "Categoria obrigatória"),
  salario: z.coerce.number().positive("Salário deve ser maior que zero"),
  data_admissao: z.string(),
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
};

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
  const { isManagerOrAbove } = useAuth();
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

  const { data: categorias } = useCategorias();
  const moi = useMemo(() => (categorias ?? []).filter((c) => c.tipo === "MOI"), [categorias]);
  const mod = useMemo(() => (categorias ?? []).filter((c) => c.tipo === "MOD"), [categorias]);

  const { data: funcionarios, isLoading } = useQuery({
    queryKey: ["funcionarios-cadastro"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios_safe" as unknown as "funcionarios")
        .select("*")
        .order("nome");
      if (error) throw error;
      return data as unknown as Array<Funcionario>;
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
      const { data, error } = await supabase.from("obras").select("id,nome").order("nome");
      if (error) throw error;
      return data;
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
    const list = (funcionarios ?? []).filter((f) => !f.deleted_at);
    return list.filter((f) => {
      if (search && !f.nome.toLowerCase().includes(search.toLowerCase())) return false;
      if (tipoFilter !== "all" && tipoCategoria(f.categoria_mo, categorias) !== tipoFilter)
        return false;
      if (statusFilter === "ativo" && !f.ativo) return false;
      if (statusFilter === "inativo" && f.ativo) return false;
      if (obraFilter !== "all") {
        const cur = currentAlocs?.get(f.id);
        if (!cur || cur.obra_id !== obraFilter) return false;
      }
      return true;
    });
  }, [funcionarios, search, tipoFilter, statusFilter, obraFilter, currentAlocs, categorias]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const { data: beneficios } = useBeneficios();
  const { data: segurosVida } = useSegurosVida({ enabled: canSeeSalario });

  const form = useForm<FuncForm>({
    resolver: zodResolver(funcSchema),
    defaultValues: {
      nome: "",
      salario: canSeeSalario ? 0 : 1,
      categoria_mo: "",
      data_admissao: "",
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
      form.setValue("salario", padrao.salario || (canSeeSalario ? 0 : 1));
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
    form.reset({ nome: "", salario: canSeeSalario ? 0 : 1, categoria_mo: "", data_admissao: "" });
    setOpen(true);
  }

  function openEdit(f: Funcionario) {
    setEditing(f);
    setSalarioDirty(false);
    form.reset({
      nome: f.nome,
      categoria_mo: f.categoria_mo,
      salario: f.salario != null ? Number(f.salario) : canSeeSalario ? 0 : 1,
      data_admissao: f.data_admissao ?? "",
    });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FuncForm) => {
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
          ...values,
          data_admissao: values.data_admissao || null,
          ativo: true,
        };
        if (canSeeSalario) payload.encargos = Number(values.salario) * ENCARGOS_PCT;
        const { error } = await supabase.from("funcionarios").insert(payload);
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

      {isLoading ? (
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
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Centro de custo atual</TableHead>
                  <TableHead>Admissão</TableHead>
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
                      colSpan={canSeeSalario ? 8 : 6}
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
                        <TableCell className="font-medium">{f.nome}</TableCell>
                        <TableCell>{f.categoria_mo}</TableCell>
                        <TableCell>{tipo && <Badge variant="outline">{tipo}</Badge>}</TableCell>
                        <TableCell className="text-sm">
                          {cur?.nome ?? <span className="text-muted-foreground">—</span>}
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
                            {isManagerOrAbove && f.ativo && (
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
                            {isManagerOrAbove && !f.ativo && (
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
    </div>
  );
}
