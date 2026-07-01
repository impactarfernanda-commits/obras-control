import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useCategorias, type Categoria } from "@/lib/categorias";
import { useAuth } from "@/hooks/use-auth";
import { useBeneficios, fmtBRL, ENCARGOS_PCT } from "@/lib/custos";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const roles = (data ?? []).map((r) => r.role);
    const allowed = ["supervisor", "coordenador", "gerente", "diretor"];
    if (!roles.some((r) => allowed.includes(r))) throw redirect({ to: "/funcionarios" });
  },
  component: ConfiguracoesPage,
});

type Linha = { categoria: string; salario: string; encargos: string; seguro_vida: string };

function ConfiguracoesPage() {
  const qc = useQueryClient();
  const { isManagerOrAbove } = useAuth();
  const canEditSalario = isManagerOrAbove;
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [openNova, setOpenNova] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTipo, setNovoTipo] = useState<"MOI" | "MOD">("MOD");

  const { data: categorias, isLoading: catLoading } = useCategorias();

  const { data, isLoading } = useQuery({
    queryKey: ["categoria_salarios"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categoria_salarios").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!data || !categorias) return;
    const map = new Map(data.map((r: any) => [r.categoria, r]));
    setLinhas(
      categorias.map((c) => {
        const r = map.get(c.nome) as any;
        return {
          categoria: c.nome,
          salario: r ? String(r.salario) : "0",
          encargos: r ? String(r.encargos) : "0",
          seguro_vida: r ? String(r.seguro_vida ?? 0) : "0",
        };
      }),
    );
  }, [data, categorias]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = linhas.map((l) => ({
        categoria: l.categoria,
        salario: Number(l.salario) || 0,
        encargos: Number(l.encargos) || 0,
        seguro_vida: Number(l.seguro_vida) || 0,
      }));
      const { error } = await supabase.from("categoria_salarios").upsert(payload as any, { onConflict: "categoria" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tabela salarial atualizada");
      qc.invalidateQueries({ queryKey: ["categoria_salarios"] });
      qc.invalidateQueries({ queryKey: ["seguros_vida"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const novaCategoriaMutation = useMutation({
    mutationFn: async () => {
      const nome = novoNome.trim();
      if (!nome) throw new Error("Informe o nome da função");
      const { error } = await supabase.from("categorias" as any).insert({ nome, tipo: novoTipo });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Função criada");
      setOpenNova(false);
      setNovoNome("");
      setNovoTipo("MOD");
      qc.invalidateQueries({ queryKey: ["categorias"] });
      qc.invalidateQueries({ queryKey: ["categoria_salarios"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao criar função"),
  });

  const deleteCategoriaMutation = useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await supabase.from("categorias" as any).delete().eq("nome", nome);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Função excluída");
      qc.invalidateQueries({ queryKey: ["categorias"] });
      qc.invalidateQueries({ queryKey: ["categoria_salarios"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao excluir"),
  });

  function updateLinha(idx: number, campo: "salario" | "encargos" | "seguro_vida", valor: string) {
    setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)));
  }

  const tipoMap = new Map<string, Categoria["tipo"]>((categorias ?? []).map((c) => [c.nome, c.tipo]));

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Tabela salarial e funções da organização."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Tabela salarial por função</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Valores aplicados automaticamente ao cadastrar um funcionário. Continuam editáveis no cadastro.
            </p>
          </div>
          <div className="flex gap-2">
            <Dialog open={openNova} onOpenChange={setOpenNova}>
              <DialogTrigger asChild>
                <Button variant="outline"><Plus className="mr-2 h-4 w-4" />Nova função</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Nova função</DialogTitle>
                  <DialogDescription>
                    Crie uma nova função/categoria. Os valores de salário e encargos começam em zero e podem ser ajustados depois.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Nome da função</Label>
                    <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Eletricista" />
                  </div>
                  <div>
                    <Label>Tipo</Label>
                    <Select value={novoTipo} onValueChange={(v) => setNovoTipo(v as "MOI" | "MOD")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MOI">MOI – Mão de obra indireta</SelectItem>
                        <SelectItem value="MOD">MOD – Mão de obra direta</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOpenNova(false)}>Cancelar</Button>
                  <Button onClick={() => novaCategoriaMutation.mutate()} disabled={novaCategoriaMutation.isPending}>
                    {novaCategoriaMutation.isPending ? "Criando..." : "Criar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {canEditSalario && (
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isLoading}>
                {saveMutation.isPending ? "Salvando..." : "Salvar alterações"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading || catLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Função</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="w-[160px]">Salário (R$)</TableHead>
                  <TableHead className="w-[160px]">Encargos (R$)</TableHead>
                  <TableHead className="w-[160px]">Seguro vida (R$)</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l, i) => {
                  const tipo = tipoMap.get(l.categoria);
                  return (
                    <TableRow key={l.categoria}>
                      <TableCell className="font-medium">{l.categoria}</TableCell>
                      <TableCell>{tipo && <Badge variant="outline">{tipo}</Badge>}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.salario}
                          disabled={!canEditSalario}
                          onChange={(e) => updateLinha(i, "salario", e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.encargos}
                          disabled={!canEditSalario}
                          onChange={(e) => updateLinha(i, "encargos", e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.seguro_vida}
                          disabled={!canEditSalario}
                          onChange={(e) => updateLinha(i, "seguro_vida", e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Excluir função">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir função "{l.categoria}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                A função e seus valores padrão de salário/encargos serão removidos. Funcionários já cadastrados manterão a função como texto histórico, mas ela não estará mais disponível em novos cadastros.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteCategoriaMutation.mutate(l.categoria)}>
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <BeneficiosCard canEdit={canEditSalario} />
    </div>
  );
}

function BeneficiosCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useBeneficios();
  const [form, setForm] = useState({
    assistencia_medica: "",
    assistencia_odontologica: "",
    vale_alimentacao: "",
    multibeneficio: "",
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      assistencia_medica: String(data.assistencia_medica),
      assistencia_odontologica: String(data.assistencia_odontologica),
      vale_alimentacao: String(data.vale_alimentacao),
      multibeneficio: String(data.multibeneficio),
    });
  }, [data]);

  const totalBenef =
    (Number(form.assistencia_medica) || 0) +
    (Number(form.assistencia_odontologica) || 0) +
    (Number(form.vale_alimentacao) || 0) +
    (Number(form.multibeneficio) || 0);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        id: true,
        assistencia_medica: Number(form.assistencia_medica) || 0,
        assistencia_odontologica: Number(form.assistencia_odontologica) || 0,
        vale_alimentacao: Number(form.vale_alimentacao) || 0,
        multibeneficio: Number(form.multibeneficio) || 0,
      };
      const { error } = await supabase
        .from("beneficios_config" as any)
        .upsert(payload, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Benefícios atualizados");
      qc.invalidateQueries({ queryKey: ["beneficios_config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const fields: Array<{ key: keyof typeof form; label: string }> = [
    { key: "assistencia_medica", label: "Assistência médica" },
    { key: "assistencia_odontologica", label: "Assistência odontológica" },
    { key: "vale_alimentacao", label: "Vale alimentação" },
    { key: "multibeneficio", label: "Multibenefício" },
  ];

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Benefícios fixos (globais)</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Valores aplicados a todos os funcionários ativos no cálculo do custo total.
            Encargos = {(ENCARGOS_PCT * 100).toFixed(1)}% do salário; Provisão 13º e Provisão aviso prévio = 1/12 de (salário+encargos) cada; Provisão férias = Provisão 13º + 1/3. Seguro de vida é definido por categoria.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading}>
            {save.isPending ? "Salvando..." : "Salvar benefícios"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key}>
                <Label>{f.label} (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form[f.key]}
                  disabled={!canEdit}
                  onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="sm:col-span-2 mt-2 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Total mensal de benefícios por funcionário</span>
              <span className="font-semibold">{fmtBRL(totalBenef)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
