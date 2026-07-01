import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { tipoCategoria, useCategorias } from "@/lib/categorias";
import { useAuth } from "@/hooks/use-auth";
import { calcularCusto, ENCARGOS_PCT, fmtBRL, useBeneficios, useSegurosVida } from "@/lib/custos";
import { Separator } from "@/components/ui/separator";


export const Route = createFileRoute("/_authenticated/funcionarios")({
  component: FuncionariosPage,
});

const PAGE_SIZE = 10;

const funcSchema = z.object({
  nome: z.string().trim().min(3, "Mínimo 3 caracteres").max(120),
  categoria_mo: z.string().min(1, "Categoria obrigatória"),
  salario: z.coerce.number().positive("Salário deve ser maior que zero"),
  ativo: z.boolean(),
});
type FuncForm = z.infer<typeof funcSchema>;
type Funcionario = { id: string; nome: string; categoria_mo: string; ativo: boolean; created_at: string; salario: number | null; encargos: number | null; data_desligamento: string | null };

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={bold ? "text-foreground" : "text-foreground"}>{fmtBRL(value)}</span>
    </div>
  );
}

function FuncionariosPage() {
  const qc = useQueryClient();
  const { isManagerOrAbove } = useAuth();
  const canSeeSalario = isManagerOrAbove;
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<"all" | "MOI" | "MOD">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "ativo" | "inativo">("all");
  const [obraFilter, setObraFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Funcionario | null>(null);
  const [salarioDirty, setSalarioDirty] = useState(false);

  const { data: categorias } = useCategorias();
  const moi = useMemo(() => (categorias ?? []).filter((c) => c.tipo === "MOI"), [categorias]);
  const mod = useMemo(() => (categorias ?? []).filter((c) => c.tipo === "MOD"), [categorias]);

  const { data: funcionarios, isLoading } = useQuery({
    queryKey: ["funcionarios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios_safe" as any)
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data as unknown) as Array<Funcionario>;
    },
  });

  const { data: tabelaSalarios } = useQuery({
    queryKey: ["categoria_salarios"],
    enabled: canSeeSalario,
    queryFn: async () => {
      const { data, error } = await supabase.from("categoria_salarios").select("*");
      if (error) throw error;
      const map = new Map<string, { salario: number; encargos: number }>();
      for (const r of data ?? []) map.set(r.categoria, { salario: Number(r.salario), encargos: Number(r.encargos) });
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
          map.set(a.funcionario_id, { obra_id: a.obra_id, nome: a.obras?.nome ?? "—", data: a.data });
        }
      }
      return map;
    },
  });

  const filtered = useMemo(() => {
    const list = funcionarios ?? [];
    return list.filter((f) => {
      if (search && !f.nome.toLowerCase().includes(search.toLowerCase())) return false;
      if (tipoFilter !== "all" && tipoCategoria(f.categoria_mo, categorias) !== tipoFilter) return false;
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
    defaultValues: { nome: "", salario: canSeeSalario ? 0 : 1, ativo: true, categoria_mo: "" },
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
    form.reset({ nome: "", salario: canSeeSalario ? 0 : 1, ativo: true, categoria_mo: "" });
    setOpen(true);
  }

  function openEdit(f: Funcionario) {
    setEditing(f);
    setSalarioDirty(false);
    form.reset({
      nome: f.nome,
      categoria_mo: f.categoria_mo,
      salario: f.salario != null ? Number(f.salario) : (canSeeSalario ? 0 : 1),
      ativo: f.ativo,
    });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FuncForm) => {
      if (editing) {
        const patch: any = { nome: values.nome, categoria_mo: values.categoria_mo, ativo: values.ativo };
        if (canSeeSalario) {
          patch.salario = values.salario;
          patch.encargos = Number(values.salario) * ENCARGOS_PCT;
        }
        const { error } = await supabase.from("funcionarios").update(patch).eq("id", editing.id);
        if (error) throw error;
      } else {
        const payload: any = { ...values };
        if (canSeeSalario) payload.encargos = Number(values.salario) * ENCARGOS_PCT;
        const { error } = await supabase.from("funcionarios").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Funcionário atualizado" : "Funcionário cadastrado");
      qc.invalidateQueries({ queryKey: ["funcionarios"] });
      setOpen(false);
      setEditing(null);
      form.reset();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  return (
    <div>
      <PageHeader
        title="Funcionários"
        description="Cadastro de colaboradores e categorias de mão de obra."
        actions={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Novo funcionário</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{editing ? "Editar funcionário" : "Cadastrar funcionário"}</DialogTitle>
                <DialogDescription>
                  {editing ? "Atualize os dados do colaborador." : "Preencha os dados do colaborador. Salário e encargos são preenchidos automaticamente conforme a categoria."}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
                  <FormField control={form.control} name="nome" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome completo</FormLabel>
                      <FormControl><Input {...field} placeholder="João da Silva" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="categoria_mo" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Categoria</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {moi.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>MOI – Mão de obra indireta</SelectLabel>
                              {moi.map((c) => <SelectItem key={c.nome} value={c.nome}>{c.nome}</SelectItem>)}
                            </SelectGroup>
                          )}
                          {mod.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>MOD – Mão de obra direta</SelectLabel>
                              {mod.map((c) => <SelectItem key={c.nome} value={c.nome}>{c.nome}</SelectItem>)}
                            </SelectGroup>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  {canSeeSalario && (
                    <>
                      <FormField control={form.control} name="salario" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Salário (R$)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...field}
                              onChange={(e) => { setSalarioDirty(true); field.onChange(e); }} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1.5">
                        <div className="font-medium text-foreground mb-1">Composição do custo mensal (calculado)</div>
                        <Row label={`Encargos (${(ENCARGOS_PCT * 100).toFixed(1)}%)`} value={breakdown.encargos} />
                       <Row label="Provisão 13º (1/12)" value={breakdown.prov13} />
                       <Row label="Provisão aviso prévio (1/12)" value={breakdown.provAvisoPrevio} />
                       <Row label="Provisão férias + 1/3" value={breakdown.provFerias} />
                       <Row label="Benefícios (médica, odonto, VA, multi)" value={breakdown.beneficios} />
                       <Row label="Seguro de vida (por categoria)" value={breakdown.seguroVida} />
                        <Separator className="my-2" />
                        <Row label="Custo total mensal" value={breakdown.total} bold />
                      </div>
                    </>
                  )}
                  <FormField control={form.control} name="ativo" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <FormLabel>Ativo</FormLabel>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
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
              <Input className="pl-8" placeholder="Nome" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Categoria</label>
            <Select value={tipoFilter} onValueChange={(v) => { setTipoFilter(v as any); setPage(0); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="MOI">MOI</SelectItem>
                <SelectItem value="MOD">MOD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as any); setPage(0); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Obra atual</label>
            <Select value={obraFilter} onValueChange={(v) => { setObraFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {(obras ?? []).map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
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
                  <TableHead>Obra atual</TableHead>
                  {canSeeSalario && <TableHead className="text-right">Salário</TableHead>}
                  {canSeeSalario && <TableHead className="text-right">Custo total</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canSeeSalario ? 8 : 6} className="py-10 text-center text-muted-foreground">
                      Nenhum funcionário encontrado.
                    </TableCell>
                  </TableRow>
                ) : pageItems.map((f) => {
                  const cur = currentAlocs?.get(f.id);
                  const tipo = tipoCategoria(f.categoria_mo, categorias);
                  const custo = canSeeSalario ? calcularCusto(f.salario, beneficios ?? null, segurosVida?.get(f.categoria_mo) ?? 0) : null;
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.nome}</TableCell>
                      <TableCell>{f.categoria_mo}</TableCell>
                      <TableCell>{tipo && <Badge variant="outline">{tipo}</Badge>}</TableCell>
                      <TableCell className="text-sm">{cur?.nome ?? <span className="text-muted-foreground">—</span>}</TableCell>
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
                          <Badge variant={f.ativo ? "default" : "secondary"}>{f.ativo ? "Ativo" : "Inativo"}</Badge>
                          {!f.ativo && f.data_desligamento && (
                            <span className="text-[10px] text-muted-foreground">
                              desde {new Date(f.data_desligamento + "T00:00:00").toLocaleDateString("pt-BR")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(f)} aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <div>{filtered.length} funcionário(s)</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span>Página {page + 1} de {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      </div>
    </div>
  );
}
