import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, AlertTriangle, Filter, X } from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtBRL } from "@/lib/custos";

export const Route = createFileRoute("/_authenticated/custos")({ component: CustosPage });

type Categoria = { id: string; nome: string; predefinida: boolean };
type Obra = { id: string; nome: string };
type Lancamento = {
  id: string;
  obra_id: string;
  categoria_id: string;
  descricao: string;
  valor: number;
  data: string;
  responsavel_id: string;
  created_at: string;
};

const CHART_COLORS = [
  "hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (k: string) => {
  const [y, m] = k.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};

function CustosPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Filters
  const [fObra, setFObra] = useState<string>("all");
  const [fCategoria, setFCategoria] = useState<string>("all");
  const [fDataIni, setFDataIni] = useState<string>("");
  const [fDataFim, setFDataFim] = useState<string>("");
  const [fValorMin, setFValorMin] = useState<string>("");
  const [fValorMax, setFValorMax] = useState<string>("");

  // Dialog state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Lancamento | null>(null);
  const [confirmDel, setConfirmDel] = useState<Lancamento | null>(null);
  const [catOpen, setCatOpen] = useState(false);

  const { data: obras } = useQuery({
    queryKey: ["obras-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obras").select("id,nome").order("nome");
      if (error) throw error;
      return data as Obra[];
    },
  });

  const { data: categorias } = useQuery({
    queryKey: ["custos-categorias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custos_indiretos_categorias")
        .select("*")
        .order("nome");
      if (error) throw error;
      return data as Categoria[];
    },
  });

  const { data: lancamentos, isLoading } = useQuery({
    queryKey: ["custos-indiretos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custos_indiretos")
        .select("*")
        .order("data", { ascending: false });
      if (error) throw error;
      return data as Lancamento[];
    },
  });

  const obrasMap = useMemo(() => new Map((obras ?? []).map((o) => [o.id, o.nome])), [obras]);
  const catMap = useMemo(() => new Map((categorias ?? []).map((c) => [c.id, c.nome])), [categorias]);

  const filtered = useMemo(() => {
    if (!lancamentos) return [];
    return lancamentos.filter((l) => {
      if (fObra !== "all" && l.obra_id !== fObra) return false;
      if (fCategoria !== "all" && l.categoria_id !== fCategoria) return false;
      if (fDataIni && l.data < fDataIni) return false;
      if (fDataFim && l.data > fDataFim) return false;
      const v = Number(l.valor);
      if (fValorMin && v < Number(fValorMin)) return false;
      if (fValorMax && v > Number(fValorMax)) return false;
      return true;
    });
  }, [lancamentos, fObra, fCategoria, fDataIni, fDataFim, fValorMin, fValorMax]);

  const total = filtered.reduce((s, l) => s + Number(l.valor), 0);

  // ---------- Charts data ----------
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) {
      const nome = catMap.get(l.categoria_id) ?? "—";
      m.set(nome, (m.get(nome) ?? 0) + Number(l.valor));
    }
    return Array.from(m, ([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
  }, [filtered, catMap]);

  const porObra = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) {
      const nome = obrasMap.get(l.obra_id) ?? "—";
      m.set(nome, (m.get(nome) ?? 0) + Number(l.valor));
    }
    return Array.from(m, ([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
  }, [filtered, obrasMap]);

  const evolucaoMensal = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) {
      const k = monthKey(l.data);
      m.set(k, (m.get(k) ?? 0) + Number(l.valor));
    }
    return Array.from(m, ([k, valor]) => ({ mes: k, label: monthLabel(k), valor }))
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }, [filtered]);

  // ---------- Alerts: months exceeding 120% of historical average ----------
  const alertas = useMemo(() => {
    if (evolucaoMensal.length < 2) return [];
    const out: { mes: string; label: string; valor: number; media: number; pct: number }[] = [];
    for (let i = 1; i < evolucaoMensal.length; i++) {
      const atual = evolucaoMensal[i];
      const hist = evolucaoMensal.slice(0, i).map((x) => x.valor);
      const media = hist.reduce((s, v) => s + v, 0) / hist.length;
      if (media > 0 && atual.valor > media * 1.2) {
        out.push({ ...atual, media, pct: (atual.valor / media) * 100 });
      }
    }
    return out.reverse();
  }, [evolucaoMensal]);

  // ---------- Mutations ----------
  const saveMut = useMutation({
    mutationFn: async (p: Partial<Lancamento> & { id?: string }) => {
      const payload = {
        obra_id: p.obra_id!,
        categoria_id: p.categoria_id!,
        descricao: p.descricao!,
        valor: Number(p.valor),
        data: p.data!,
        responsavel_id: user!.id,
      };
      if (p.id) {
        const { error } = await supabase.from("custos_indiretos").update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("custos_indiretos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custos-indiretos"] });
      toast.success(editing ? "Lançamento atualizado" : "Lançamento criado");
      setOpen(false);
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("custos_indiretos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custos-indiretos"] });
      toast.success("Lançamento excluído");
      setConfirmDel(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const addCatMut = useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await supabase
        .from("custos_indiretos_categorias")
        .insert({ nome: nome.trim(), predefinida: false });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custos-categorias"] });
      toast.success("Categoria adicionada");
      setCatOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const clearFiltros = () => {
    setFObra("all"); setFCategoria("all"); setFDataIni(""); setFDataFim("");
    setFValorMin(""); setFValorMax("");
  };

  return (
    <div>
      <PageHeader
        title="Custos indiretos"
        description="Registre e analise custos indiretos por obra."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCatOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Categoria
            </Button>
            <Button onClick={() => { setEditing(null); setOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> Novo lançamento
            </Button>
          </div>
        }
      />

      {/* Alerts */}
      {alertas.length > 0 && (
        <div className="mb-4 space-y-2">
          {alertas.slice(0, 3).map((a) => (
            <Alert key={a.mes} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Custo elevado em {a.label}</AlertTitle>
              <AlertDescription>
                {fmtBRL(a.valor)} — {a.pct.toFixed(0)}% da média histórica ({fmtBRL(a.media)}).
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Filtros */}
      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" /> Filtros
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={clearFiltros}>
            <X className="mr-1 h-4 w-4" /> Limpar
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <Label className="text-xs">Obra</Label>
            <Select value={fObra} onValueChange={setFObra}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {obras?.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={fCategoria} onValueChange={setFCategoria}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categorias?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Data inicial</Label>
            <Input type="date" value={fDataIni} onChange={(e) => setFDataIni(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Data final</Label>
            <Input type="date" value={fDataFim} onChange={(e) => setFDataFim(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Valor mín.</Label>
            <Input type="number" step="0.01" value={fValorMin} onChange={(e) => setFValorMin(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Valor máx.</Label>
            <Input type="number" step="0.01" value={fValorMax} onChange={(e) => setFValorMax(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Total filtrado</p>
          <p className="text-2xl font-bold">{fmtBRL(total)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Lançamentos</p>
          <p className="text-2xl font-bold">{filtered.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground">Ticket médio</p>
          <p className="text-2xl font-bold">{filtered.length ? fmtBRL(total / filtered.length) : "—"}</p>
        </CardContent></Card>
      </div>

      {/* Charts */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Distribuição por categoria</CardTitle></CardHeader>
          <CardContent>
            {porCategoria.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sem dados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={porCategoria} dataKey="valor" nameKey="nome" outerRadius={90} label={(e: any) => e.nome}>
                    {porCategoria.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmtBRL(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Evolução mensal</CardTitle></CardHeader>
          <CardContent>
            {evolucaoMensal.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sem dados.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={evolucaoMensal}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => fmtBRL(Number(v))} />
                  <Line type="monotone" dataKey="valor" stroke="hsl(var(--primary))" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Custos por obra</CardTitle></CardHeader>
        <CardContent>
          {porObra.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Sem dados.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, porObra.length * 36)}>
              <BarChart data={porObra} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" fontSize={12} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="nome" fontSize={12} width={140} />
                <Tooltip formatter={(v: any) => fmtBRL(Number(v))} />
                <Bar dataKey="valor" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Lista */}
      <Card>
        <CardHeader><CardTitle className="text-base">Lançamentos</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum lançamento.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Obra</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((l) => {
                  const canEdit = l.responsavel_id === user?.id;
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap">{new Date(l.data + "T00:00").toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell>{obrasMap.get(l.obra_id) ?? "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{catMap.get(l.categoria_id) ?? "—"}</Badge></TableCell>
                      <TableCell className="max-w-md truncate">{l.descricao}</TableCell>
                      <TableCell className="text-right font-mono">{fmtBRL(Number(l.valor))}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" disabled={!canEdit}
                            onClick={() => { setEditing(l); setOpen(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" disabled={!canEdit}
                            onClick={() => setConfirmDel(l)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <LancamentoDialog
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}
        editing={editing}
        obras={obras ?? []}
        categorias={categorias ?? []}
        onSubmit={(p) => saveMut.mutate(p)}
        saving={saveMut.isPending}
      />

      <CategoriaDialog
        open={catOpen}
        onOpenChange={setCatOpen}
        onSubmit={(nome) => addCatMut.mutate(nome)}
        saving={addCatMut.isPending}
      />

      <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDel && delMut.mutate(confirmDel.id)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------- Lançamento dialog ----------
function LancamentoDialog({
  open, onOpenChange, editing, obras, categorias, onSubmit, saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Lancamento | null;
  obras: Obra[];
  categorias: Categoria[];
  onSubmit: (p: Partial<Lancamento> & { id?: string }) => void;
  saving: boolean;
}) {
  const [obra, setObra] = useState("");
  const [categoria, setCategoria] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(todayISO());

  useMemoSync(() => {
    if (editing) {
      setObra(editing.obra_id); setCategoria(editing.categoria_id);
      setDescricao(editing.descricao); setValor(String(editing.valor));
      setData(editing.data);
    } else {
      setObra(""); setCategoria(""); setDescricao(""); setValor(""); setData(todayISO());
    }
  }, [editing, open]);

  const submit = () => {
    if (!obra || !categoria || !descricao.trim() || !valor || !data) {
      toast.error("Preencha todos os campos."); return;
    }
    onSubmit({ id: editing?.id, obra_id: obra, categoria_id: categoria, descricao: descricao.trim(), valor: Number(valor), data });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Obra</Label>
            <Select value={obra} onValueChange={setObra}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {obras.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div>
              <Label>Valor (R$)</Label>
              <Input type="number" step="0.01" min="0" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Descrição detalhada</Label>
            <Textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriaDialog({
  open, onOpenChange, onSubmit, saving,
}: { open: boolean; onOpenChange: (v: boolean) => void; onSubmit: (nome: string) => void; saving: boolean }) {
  const [nome, setNome] = useState("");
  useMemoSync(() => { if (!open) setNome(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nova categoria</DialogTitle></DialogHeader>
        <div>
          <Label>Nome</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Equipamentos" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!nome.trim() || saving} onClick={() => onSubmit(nome)}>
            {saving ? "Salvando..." : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Tiny effect helper (re-export of useEffect with clearer intent name)
import { useEffect as useMemoSync } from "react";
