import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { calcularCompetencia, formatarPeriodoCompetencia } from "@/lib/competencias";
import {
  mensagemErroCriacaoCentroCusto,
  normalizarCodigoCentroCusto,
  normalizarDescricaoCentroCusto,
  podeCriarCentroCusto,
} from "@/lib/centros-custo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/obras")({
  component: ObrasPage,
});

const STATUS_OPTIONS = ["Planejada", "Em andamento", "Concluída", "Paralisada"] as const;
type StatusOpt = (typeof STATUS_OPTIONS)[number];

const schema = z.object({
  nome: z.string().trim().min(3, "Mínimo 3 caracteres").max(120),
  data_inicio: z.string().optional().or(z.literal("")),
  status: z.enum(STATUS_OPTIONS),
});
type FormVals = z.infer<typeof schema>;

const createSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, "Informe o código")
    .max(30, "Máximo 30 caracteres")
    .refine((codigo) => normalizarCodigoCentroCusto(codigo).length > 0, "Código inválido"),
  descricao: z.string().trim().min(1, "Informe a descrição").max(120, "Máximo 120 caracteres"),
});
type CreateFormVals = z.infer<typeof createSchema>;

const PAGE_SIZE = 10;

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "Em andamento":
      return "default";
    case "Concluída":
      return "secondary";
    case "Paralisada":
      return "destructive";
    default:
      return "outline";
  }
}

type Obra = {
  id: string;
  nome: string;
  status: string;
  data_inicio: string | null;
  created_at: string;
  visivel_obras_control?: boolean | null;
};

type EquipeRow = {
  id: string;
  nome: string;
  categoria_mo: string | null;
};

function dataLocalISO(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function ObrasPage() {
  const { user, isManagerOrAbove } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Obra | null>(null);
  const [selectedObra, setSelectedObra] = useState<Obra | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);

  const competenciaAtual = useMemo(() => calcularCompetencia(dataLocalISO(new Date())), []);

  const { data, isLoading } = useQuery({
    queryKey: ["obras"],
    queryFn: async () => {
      const { data: obras, error } = await supabase
        .from("obras")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (obras as Obra[]).filter((obra) => obra.visivel_obras_control !== false);
    },
  });

  const form = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: { nome: "", data_inicio: "", status: "Em andamento" },
  });

  const createForm = useForm<CreateFormVals>({
    resolver: zodResolver(createSchema),
    defaultValues: { codigo: "", descricao: "" },
  });

  function openCreate() {
    createForm.reset({ codigo: "", descricao: "" });
    setCreateOpen(true);
  }

  function openEdit(obra: Obra) {
    setEditing(obra);
    form.reset({
      nome: obra.nome,
      data_inicio: obra.data_inicio ?? "",
      status: STATUS_OPTIONS.includes(obra.status as StatusOpt)
        ? (obra.status as StatusOpt)
        : "Em andamento",
    });
    setFormOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormVals) => {
      const payload = {
        nome: values.nome.trim(),
        status: values.status,
        data_inicio: values.data_inicio || null,
      };
      if (!editing) throw new Error("Centro de custo não selecionado para edição.");
      const result = await supabase.from("obras").update(payload).eq("id", editing.id);
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      toast.success("Centro de custo atualizado");
      queryClient.invalidateQueries({ queryKey: ["obras"] });
      queryClient.invalidateQueries({ queryKey: ["obras-min"] });
      setFormOpen(false);
      setEditing(null);
    },
    onError: (error: Error) => toast.error(error.message || "Erro ao salvar"),
  });

  const createMutation = useMutation({
    mutationFn: async (values: CreateFormVals) => {
      const codigo = normalizarCodigoCentroCusto(values.codigo);
      const descricao = normalizarDescricaoCentroCusto(values.descricao);
      const { error } = await supabase.rpc("obras_criar_centro_custo", {
        p_codigo: codigo,
        p_descricao: descricao,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Centro de custo cadastrado");
      queryClient.invalidateQueries({ queryKey: ["obras"] });
      queryClient.invalidateQueries({ queryKey: ["obras-min"] });
      queryClient.invalidateQueries({ queryKey: ["obras-planejamento"] });
      setCreateOpen(false);
      createForm.reset();
    },
    onError: (error: { code?: string | null; message?: string | null }) =>
      toast.error(mensagemErroCriacaoCentroCusto(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("obras").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Centro de custo removido");
      queryClient.invalidateQueries({ queryKey: ["obras"] });
      queryClient.invalidateQueries({ queryKey: ["obras-min"] });
    },
    onError: (error: Error) => toast.error(error.message || "Erro ao remover"),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StatusOpt }) => {
      const { error } = await supabase.from("obras").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status atualizado");
      queryClient.invalidateQueries({ queryKey: ["obras"] });
      queryClient.invalidateQueries({ queryKey: ["obras-min"] });
    },
    onError: (error: Error) => toast.error(error.message || "Erro ao atualizar status"),
  });

  const {
    data: equipe = [],
    isLoading: equipeLoading,
    error: equipeError,
  } = useQuery({
    queryKey: [
      "equipe-centro-custo",
      selectedObra?.id,
      competenciaAtual.data_inicio,
      competenciaAtual.data_fim,
    ],
    enabled: Boolean(selectedObra),
    queryFn: async () => {
      const { data: alocacoes, error: alocacoesError } = await supabase
        .from("alocacoes")
        .select("funcionario_id")
        .eq("obra_id", selectedObra!.id)
        .gte("data", competenciaAtual.data_inicio)
        .lte("data", competenciaAtual.data_fim);
      if (alocacoesError) throw alocacoesError;

      const ids = Array.from(new Set((alocacoes ?? []).map((item) => item.funcionario_id)));
      if (ids.length === 0) return [] as EquipeRow[];

      const { data: funcionarios, error: funcionariosError } = await supabase.rpc(
        "obras_control_funcionarios_por_ids",
        { p_ids: ids },
      );
      if (funcionariosError) throw funcionariosError;

      return (funcionarios as EquipeRow[]).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    },
  });

  const filtered = useMemo(
    () =>
      (data ?? []).filter((obra) => {
        if (search && !obra.nome.toLowerCase().includes(search.toLowerCase())) return false;
        return statusFilter === "all" || obra.status === statusFilter;
      }),
    [data, search, statusFilter],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Centros de custo"
        description="Centros de custo e alocação de equipes."
        actions={
          podeCriarCentroCusto(Boolean(user)) ? (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Novo centro de custo
            </Button>
          ) : undefined
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cadastrar centro de custo</DialogTitle>
            <DialogDescription>
              Informe o código e a descrição do centro de custo.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form
              onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
              className="space-y-4"
            >
              <FormField
                control={createForm.control}
                name="codigo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Código</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ex.: 230" autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="descricao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ex.: ETE Sul" autoComplete="off" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar centro de custo</DialogTitle>
            <DialogDescription>Informe os dados principais do centro de custo.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ex.: Edifício Solar" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="data_inicio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Data de início{" "}
                        <span className="font-normal text-muted-foreground">(opcional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {STATUS_OPTIONS.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
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

      <Dialog
        open={Boolean(selectedObra)}
        onOpenChange={(open) => {
          if (!open) setSelectedObra(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Equipe do centro de custo</DialogTitle>
            <DialogDescription>
              {selectedObra?.nome} · competência atual (
              {formatarPeriodoCompetencia(competenciaAtual)})
            </DialogDescription>
          </DialogHeader>
          {equipeLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando equipe...
            </div>
          ) : equipeError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Não foi possível carregar a equipe deste centro de custo.
            </p>
          ) : equipe.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum funcionário alocado neste centro de custo na competência atual.
            </p>
          ) : (
            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Funcionário</TableHead>
                    <TableHead>Função</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipe.map((funcionario) => (
                    <TableRow key={funcionario.id}>
                      <TableCell className="font-medium">{funcionario.nome}</TableCell>
                      <TableCell>{funcionario.categoria_mo || "Não informada"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedObra(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[200px] flex-1">
            <label className="text-xs text-muted-foreground">Buscar</label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Nome do centro de custo"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
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
                  <TableHead>Status</TableHead>
                  {isManagerOrAbove && (
                    <TableHead className="w-[100px] text-right">Ações</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={isManagerOrAbove ? 3 : 2}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Nenhum centro de custo encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageItems.map((obra) => (
                    <TableRow key={obra.id}>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setSelectedObra(obra)}
                        >
                          {obra.nome}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={obra.status}
                          disabled={statusMutation.isPending}
                          onValueChange={(status: StatusOpt) =>
                            statusMutation.mutate({ id: obra.id, status })
                          }
                        >
                          <SelectTrigger className="h-8 w-[160px] border-0 px-2 shadow-none">
                            <SelectValue>
                              <Badge variant={statusVariant(obra.status)}>{obra.status}</Badge>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((status) => (
                              <SelectItem key={status} value={status}>
                                {status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {isManagerOrAbove && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(obra)}
                              aria-label="Editar"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" aria-label="Remover">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remover centro de custo?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Esta ação não pode ser desfeita. O centro de custo &quot;
                                    {obra.nome}&quot; será removido permanentemente.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMutation.mutate(obra.id)}>
                                    Remover
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <div>{filtered.length} centro(s) de custo</div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((current) => current - 1)}
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
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
