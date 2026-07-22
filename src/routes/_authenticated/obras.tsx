import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/obras")({
  component: ObrasPage,
});

const STATUS_OPTIONS = ["Planejada", "Em andamento", "Concluída", "Paralisada"] as const;
type StatusOpt = typeof STATUS_OPTIONS[number];

const schema = z.object({
  nome: z.string().trim().min(3, "Mínimo 3 caracteres").max(120),
  data_inicio: z.string().optional().or(z.literal("")),
  status: z.enum(STATUS_OPTIONS),
});
type FormVals = z.infer<typeof schema>;

const PAGE_SIZE = 10;

function statusVariant(s: string): "default" | "secondary" | "outline" | "destructive" {
  switch (s) {
    case "Em andamento": return "default";
    case "Concluída": return "secondary";
    case "Paralisada": return "destructive";
    default: return "outline";
  }
}

type Obra = { id: string; nome: string; status: string; data_inicio: string | null; created_at: string };

function ObrasPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Obra | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["obras"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obras").select("*").eq("visivel_obras_control", true).order("created_at", { ascending: false });
      if (error) throw error;
      return data as Obra[];
    },
  });

  const form = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: { nome: "", data_inicio: "", status: "Em andamento" },
  });

  function openCreate() {
    setEditing(null);
    form.reset({ nome: "", data_inicio: "", status: "Em andamento" });
    setOpen(true);
  }
  function openEdit(o: Obra) {
    setEditing(o);
    form.reset({
      nome: o.nome,
      data_inicio: o.data_inicio ?? "",
      status: (STATUS_OPTIONS as readonly string[]).includes(o.status) ? (o.status as StatusOpt) : "Em andamento",
    });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (v: FormVals) => {
      const payload = { nome: v.nome.trim(), status: v.status, data_inicio: v.data_inicio ? v.data_inicio : null };
      if (editing) {
        const { error } = await supabase.from("obras").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("obras").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Centro de custo atualizado" : "Centro de custo cadastrado");
      qc.invalidateQueries({ queryKey: ["obras"] });
      qc.invalidateQueries({ queryKey: ["obras-min"] });
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("obras").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Centro de custo removido");
      qc.invalidateQueries({ queryKey: ["obras"] });
      qc.invalidateQueries({ queryKey: ["obras-min"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao remover"),
  });

  const filtered = useMemo(() => {
    const list = data ?? [];
    return list.filter((o) => {
      if (search && !o.nome.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      return true;
    });
  }, [data, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Centros de custo"
        description="Centros de custo e alocação de equipes."
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />Novo centro de custo
          </Button>
        }
      />

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar centro de custo" : "Cadastrar centro de custo"}</DialogTitle>
            <DialogDescription>Informe os dados principais do centro de custo.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="nome" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl><Input {...field} placeholder="Ex.: Edifício Solar" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="data_inicio" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de início <span className="text-muted-foreground font-normal">(opcional)</span></FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
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

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[200px] flex-1">
            <label className="text-xs text-muted-foreground">Buscar</label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Nome do centro de custo" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                  <TableHead>Data início</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      Nenhum centro de custo encontrado.
                    </TableCell>
                  </TableRow>
                ) : pageItems.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.nome}</TableCell>
                    <TableCell className="text-sm">
                      {o.data_inicio ? new Date(o.data_inicio + "T00:00:00").toLocaleDateString("pt-BR") : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><Badge variant={statusVariant(o.status)}>{o.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(o)} aria-label="Editar">
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
                                Esta ação não pode ser desfeita. O centro de custo "{o.nome}" será removido permanentemente.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(o.id)}>Remover</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <div>{filtered.length} centro(s) de custo</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span>Página {page + 1} de {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      </div>
    </div>
  );
}
