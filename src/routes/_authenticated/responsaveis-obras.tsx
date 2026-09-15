import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Eye, Loader2, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import {
  ResponsavelPessoaSearchSelect,
  type OpcaoPessoaResponsavel,
} from "@/components/ResponsavelPessoaSearchSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  agruparResponsaveis,
  excluirCadastroResponsavel,
  filtrarObrasResponsaveis,
  normalizarBuscaResponsaveis,
  podeGerenciarResponsaveis,
  pessoasSemelhantes,
  type ObraComResponsaveis,
  type ResponsavelObraRow,
  type CadastroResponsavelExclusao,
} from "@/lib/responsaveis-obras";

export const Route = createFileRoute("/_authenticated/responsaveis-obras")({
  component: ResponsaveisObrasPage,
});

type Cargo = { id: string; nome: string; ordem: number; ativo: boolean };

function StatusBadge({ status }: { status: "nao_definido" | "definido" | "compartilhado" }) {
  if (status === "compartilhado") {
    return (
      <Badge className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50">
        Compartilhado
      </Badge>
    );
  }
  if (status === "definido") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
        Definido
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Não definido
    </Badge>
  );
}

function ResponsaveisObrasPage() {
  const { role, user } = useAuth();
  const queryClient = useQueryClient();
  const canManage = podeGerenciarResponsaveis(role);
  const [search, setSearch] = useState("");
  const [mostrarFinalizadas, setMostrarFinalizadas] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cargoId, setCargoId] = useState("");
  const [pessoaOpcaoId, setPessoaOpcaoId] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualNome, setManualNome] = useState("");
  const [cargosOpen, setCargosOpen] = useState(false);
  const [cargoNome, setCargoNome] = useState("");
  const [editingCargo, setEditingCargo] = useState<Cargo | null>(null);
  const [pessoasOpen, setPessoasOpen] = useState(false);
  const [pessoasSearch, setPessoasSearch] = useState("");
  const [exclusao, setExclusao] = useState<CadastroResponsavelExclusao | null>(null);

  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["responsaveis-obras"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.rpc("obras_control_responsaveis_lista");
      if (queryError) throw queryError;
      return data as ResponsavelObraRow[];
    },
  });
  const { data: cargos = [] } = useQuery({
    queryKey: ["responsaveis-cargos"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("responsaveis_cargos")
        .select("id,nome,ordem,ativo")
        .order("ordem")
        .order("nome");
      if (queryError) throw queryError;
      return data as Cargo[];
    },
  });
  const { data: pessoas = [] } = useQuery({
    queryKey: ["responsaveis-pessoas-opcoes"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.rpc(
        "obras_control_responsaveis_pessoas_opcoes",
      );
      if (queryError) throw queryError;
      return data as OpcaoPessoaResponsavel[];
    },
  });

  const obras = useMemo(() => agruparResponsaveis(rows), [rows]);
  const filtered = useMemo(
    () => filtrarObrasResponsaveis(obras, search, mostrarFinalizadas),
    [obras, search, mostrarFinalizadas],
  );
  const selected = obras.find((obra) => obra.id === selectedId) ?? null;
  const semelhantes = useMemo(() => pessoasSemelhantes(pessoas, manualNome), [pessoas, manualNome]);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["responsaveis-obras"] });
    queryClient.invalidateQueries({ queryKey: ["responsaveis-cargos"] });
    queryClient.invalidateQueries({ queryKey: ["responsaveis-pessoas-opcoes"] });
  }

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !cargoId) throw new Error("Selecione a obra e o cargo.");
      const { data: existing, error: existingError } = await supabase
        .from("obra_responsabilidade_cargos")
        .select("id")
        .eq("obra_id", selected.id)
        .eq("cargo_id", cargoId)
        .maybeSingle();
      if (existingError) throw existingError;
      let obraCargoId = existing?.id;
      if (!obraCargoId) {
        const { data: created, error: createError } = await supabase
          .from("obra_responsabilidade_cargos")
          .insert({ obra_id: selected.id, cargo_id: cargoId, created_by: user?.id ?? null })
          .select("id")
          .single();
        if (createError) throw createError;
        obraCargoId = created.id;
      }
      if (!pessoaOpcaoId) return;
      const opcao = pessoas.find((item) => item.opcao_id === pessoaOpcaoId);
      if (!opcao) throw new Error("Pessoa não encontrada.");
      let pessoaId = opcao.pessoa_id;
      if (!pessoaId && opcao.funcionario_id) {
        const { data: created, error: createError } = await supabase
          .from("responsaveis_pessoas")
          .insert({ funcionario_id: opcao.funcionario_id, created_by: user?.id ?? null })
          .select("id")
          .single();
        if (createError) {
          if (createError.code !== "23505") throw createError;
          const { data: found, error: findError } = await supabase
            .from("responsaveis_pessoas")
            .select("id")
            .eq("funcionario_id", opcao.funcionario_id)
            .single();
          if (findError) throw findError;
          pessoaId = found.id;
        } else pessoaId = created.id;
      }
      if (!pessoaId) throw new Error("Não foi possível identificar a pessoa.");
      const { error: linkError } = await supabase.from("obra_responsabilidade_pessoas").insert({
        obra_cargo_id: obraCargoId,
        pessoa_id: pessoaId,
        created_by: user?.id ?? null,
      });
      if (linkError) throw linkError;
    },
    onSuccess: () => {
      toast.success(pessoaOpcaoId ? "Responsável vinculado" : "Cargo adicionado sem responsável");
      invalidateAll();
      setAddOpen(false);
      setCargoId("");
      setPessoaOpcaoId("");
    },
    onError: (mutationError: { code?: string; message?: string }) =>
      toast.error(
        mutationError.code === "23505"
          ? "Esse cargo ou responsável já está vinculado à obra."
          : mutationError.message || "Não foi possível salvar.",
      ),
  });

  const removeLinkMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: deleteError } = await supabase
        .from("obra_responsabilidade_pessoas")
        .delete()
        .eq("id", id);
      if (deleteError) throw deleteError;
    },
    onSuccess: () => {
      toast.success("Vínculo removido");
      invalidateAll();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const removeCargoObraMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: deleteError } = await supabase
        .from("obra_responsabilidade_cargos")
        .delete()
        .eq("id", id);
      if (deleteError) throw deleteError;
    },
    onSuccess: () => {
      toast.success("Cargo removido da obra");
      invalidateAll();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const manualMutation = useMutation({
    mutationFn: async () => {
      const nome = manualNome.trim().replace(/\s+/g, " ");
      if (nome.length < 2) throw new Error("Informe pelo menos 2 caracteres.");
      const { data, error: createError } = await supabase
        .from("responsaveis_pessoas")
        .insert({ nome_manual: nome, created_by: user?.id ?? null })
        .select("id")
        .single();
      if (createError) throw createError;
      return { id: data.id, nome };
    },
    onSuccess: ({ id, nome }) => {
      toast.success("Pessoa cadastrada");
      invalidateAll();
      setPessoaOpcaoId(`manual:${id}`);
      setManualOpen(false);
      setManualNome("");
      queryClient.setQueryData<OpcaoPessoaResponsavel[]>(
        ["responsaveis-pessoas-opcoes"],
        (current = []) => [
          ...current,
          {
            opcao_id: `manual:${id}`,
            pessoa_id: id,
            funcionario_id: null,
            nome,
            tipo: "manual",
            detalhe: "Cadastro manual",
          },
        ],
      );
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const saveCargoMutation = useMutation({
    mutationFn: async () => {
      const nome = cargoNome.trim().replace(/\s+/g, " ");
      if (!nome) throw new Error("Informe o nome do cargo.");
      if (editingCargo) {
        const { error: updateError } = await supabase
          .from("responsaveis_cargos")
          .update({ nome, updated_by: user?.id ?? null, updated_at: new Date().toISOString() })
          .eq("id", editingCargo.id);
        if (updateError) throw updateError;
      } else {
        const maiorOrdem = Math.max(0, ...cargos.map((cargo) => cargo.ordem));
        const { error: insertError } = await supabase.from("responsaveis_cargos").insert({
          nome,
          ordem: maiorOrdem + 10,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        });
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      toast.success(editingCargo ? "Cargo atualizado" : "Cargo cadastrado");
      invalidateAll();
      setCargoNome("");
      setEditingCargo(null);
    },
    onError: (mutationError: { code?: string; message?: string }) =>
      toast.error(
        mutationError.code === "23505"
          ? "Já existe um cargo com esse nome."
          : mutationError.message || "Erro ao salvar cargo.",
      ),
  });

  const toggleCargoMutation = useMutation({
    mutationFn: async (cargo: Cargo) => {
      const { error: updateError } = await supabase
        .from("responsaveis_cargos")
        .update({
          ativo: !cargo.ativo,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cargo.id);
      if (updateError) throw updateError;
    },
    onSuccess: invalidateAll,
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const excluirCadastroMutation = useMutation({
    mutationFn: async (alvo: CadastroResponsavelExclusao) => {
      await excluirCadastroResponsavel(role, alvo, async (cadastro) => {
        const tabela = cadastro.tipo === "cargo" ? "responsaveis_cargos" : "responsaveis_pessoas";
        let query = supabase.from(tabela).delete().eq("id", cadastro.id);
        if (cadastro.tipo === "pessoa") query = query.is("funcionario_id", null);
        const { data, error: deleteError } = await query.select("id").maybeSingle();
        if (deleteError) throw deleteError;
        return data;
      });
    },
    onSuccess: (_, alvo) => {
      toast.success(
        alvo.tipo === "cargo"
          ? "Cargo excluído definitivamente"
          : "Pessoa manual excluída definitivamente",
      );
      if (alvo.tipo === "cargo" && editingCargo?.id === alvo.id) {
        setEditingCargo(null);
        setCargoNome("");
      }
      if (alvo.tipo === "cargo" && cargoId === alvo.id) setCargoId("");
      if (alvo.tipo === "pessoa" && pessoaOpcaoId === `manual:${alvo.id}`) setPessoaOpcaoId("");
      setExclusao(null);
      invalidateAll();
    },
    onError: (mutationError: Error) => {
      toast.error(mutationError.message);
      setExclusao(null);
    },
  });

  return (
    <div>
      <PageHeader
        title="Responsáveis das Obras"
        description="Consulte quem está à frente de cada centro de custo."
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setCargosOpen(true)}>
                <BriefcaseBusiness className="mr-2 h-4 w-4" />
                Gerenciar cargos
              </Button>
              <Button variant="outline" onClick={() => setPessoasOpen(true)}>
                <Users className="mr-2 h-4 w-4" />
                Pessoas manuais
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por centro de custo, obra, pessoa ou cargo"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="mostrar-finalizadas"
            checked={mostrarFinalizadas}
            onCheckedChange={(checked) => setMostrarFinalizadas(checked === true)}
          />
          <Label htmlFor="mostrar-finalizadas" className="cursor-pointer">
            Mostrar finalizadas
          </Label>
        </div>
      </div>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-56" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Não foi possível carregar os responsáveis. A migration local precisa ser aplicada antes
            de usar esta tela.
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma obra encontrada.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((obra) => {
            const destaques = obra.cargos.filter((cargo) =>
              ["Gerente de Obras", "Coordenador"].includes(cargo.nome),
            );
            return (
              <Card key={obra.id} className="flex flex-col">
                <CardHeader>
                  <CardTitle className="text-lg">{obra.nome}</CardTitle>
                  <span className="text-sm text-muted-foreground">{obra.status}</span>
                </CardHeader>
                <CardContent className="flex-1 space-y-2 text-sm">
                  {destaques.flatMap((cargo) =>
                    cargo.pessoas.map((pessoa) => (
                      <p key={pessoa.vinculoId}>
                        <span className="font-medium">{cargo.nome}:</span> {pessoa.nome}
                      </p>
                    )),
                  )}
                  {destaques.every((cargo) => cargo.pessoas.length === 0) && (
                    <p className="text-muted-foreground">Sem destaques definidos.</p>
                  )}
                  <div className="flex items-center gap-2 pt-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    {obra.totalDefinidos}{" "}
                    {obra.totalDefinidos === 1 ? "responsável definido" : "responsáveis definidos"}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setSelectedId(obra.id)}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    Ver responsáveis
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.nome}</DialogTitle>
            <DialogDescription>Relação completa por cargo e pessoa.</DialogDescription>
          </DialogHeader>
          {canManage && (
            <div>
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Adicionar responsável
              </Button>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cargo</TableHead>
                <TableHead>Pessoa</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="w-24 text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected?.cargos.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 4 : 3}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Nenhum cargo definido nesta obra.
                  </TableCell>
                </TableRow>
              )}
              {selected?.cargos.flatMap((cargo) =>
                cargo.pessoas.length === 0
                  ? [
                      <TableRow key={cargo.id}>
                        <TableCell className="font-medium">{cargo.nome}</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                        <TableCell>
                          <StatusBadge status="nao_definido" />
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Remover cargo"
                              onClick={() => removeCargoObraMutation.mutate(cargo.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>,
                    ]
                  : cargo.pessoas.map((pessoa, index) => (
                      <TableRow key={pessoa.vinculoId}>
                        <TableCell className="font-medium">
                          {index === 0 ? cargo.nome : ""}
                        </TableCell>
                        <TableCell>{pessoa.nome}</TableCell>
                        <TableCell>
                          <StatusBadge status={pessoa.status} />
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Remover vínculo"
                              onClick={() => removeLinkMutation.mutate(pessoa.vinculoId)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    )),
              )}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Adicionar responsável</DialogTitle>
            <DialogDescription>
              Selecione o cargo e, opcionalmente, uma pessoa. Sem pessoa, o cargo ficará como Não
              definido.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cargo</Label>
              <Select value={cargoId} onValueChange={setCargoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cargo" />
                </SelectTrigger>
                <SelectContent>
                  {cargos
                    .filter((cargo) => cargo.ativo)
                    .map((cargo) => (
                      <SelectItem key={cargo.id} value={cargo.id}>
                        {cargo.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                Pessoa <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <ResponsavelPessoaSearchSelect
                pessoas={pessoas}
                value={pessoaOpcaoId}
                onValueChange={setPessoaOpcaoId}
                onAddManual={(termo) => {
                  setManualNome(termo);
                  setManualOpen(true);
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!cargoId || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar nova pessoa</DialogTitle>
            <DialogDescription>
              Cadastre somente o nome. Pessoas com nomes semelhantes são sugeridas abaixo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={manualNome}
                onChange={(event) => setManualNome(event.target.value)}
                autoFocus
                maxLength={160}
              />
            </div>
            {semelhantes.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="mb-2 font-medium">Cadastros semelhantes:</p>
                {semelhantes.slice(0, 5).map((pessoa) => (
                  <button
                    key={pessoa.opcao_id}
                    type="button"
                    className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
                    onClick={() => {
                      setPessoaOpcaoId(pessoa.opcao_id);
                      setManualOpen(false);
                    }}
                  >
                    {pessoa.nome} <span className="text-muted-foreground">· {pessoa.detalhe}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setManualOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={manualMutation.isPending || manualNome.trim().length < 2}
              onClick={() => manualMutation.mutate()}
            >
              Cadastrar mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={canManage && cargosOpen} onOpenChange={setCargosOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Gerenciar cargos</DialogTitle>
            <DialogDescription>
              A lista é dinâmica e pode ser ampliada sem alterações no frontend.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={cargoNome}
              onChange={(event) => setCargoNome(event.target.value)}
              placeholder="Nome do cargo"
              maxLength={120}
            />
            <Button
              disabled={!cargoNome.trim() || saveCargoMutation.isPending}
              onClick={() => saveCargoMutation.mutate()}
            >
              {editingCargo ? "Salvar" : "Adicionar"}
            </Button>
            {editingCargo && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingCargo(null);
                  setCargoNome("");
                }}
              >
                Cancelar
              </Button>
            )}
          </div>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {cargos.map((cargo) => (
              <div key={cargo.id} className="flex items-center gap-2 rounded-md border p-3">
                <span className="flex-1 text-sm font-medium">{cargo.nome}</span>
                <Badge variant={cargo.ativo ? "secondary" : "outline"}>
                  {cargo.ativo ? "Ativo" : "Inativo"}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Editar cargo"
                  onClick={() => {
                    setEditingCargo(cargo);
                    setCargoNome(cargo.nome);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => toggleCargoMutation.mutate(cargo)}
                >
                  {cargo.ativo ? "Desativar" : "Ativar"}
                </Button>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`Excluir cargo ${cargo.nome}`}
                    onClick={() => setExclusao({ tipo: "cargo", id: cargo.id, nome: cargo.nome })}
                  >
                    Excluir
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={canManage && pessoasOpen} onOpenChange={setPessoasOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Pessoas manuais</DialogTitle>
            <DialogDescription>
              Exclua somente cadastros feitos por engano e sem vínculos com obras. Funcionários não
              são gerenciados aqui.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Buscar pessoa manual"
            value={pessoasSearch}
            onChange={(event) => setPessoasSearch(event.target.value)}
          />
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {pessoas
              .filter(
                (pessoa) =>
                  pessoa.tipo === "manual" &&
                  pessoa.funcionario_id === null &&
                  pessoa.pessoa_id &&
                  normalizarBuscaResponsaveis(pessoa.nome).includes(
                    normalizarBuscaResponsaveis(pessoasSearch),
                  ),
              )
              .map((pessoa) => (
                <div
                  key={pessoa.pessoa_id}
                  className="flex items-center gap-2 rounded-md border p-3"
                >
                  <span className="flex-1 text-sm">{pessoa.nome}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`Excluir pessoa manual ${pessoa.nome}`}
                    onClick={() =>
                      setExclusao({
                        tipo: "pessoa",
                        id: pessoa.pessoa_id!,
                        nome: pessoa.nome,
                        funcionario_id: null,
                      })
                    }
                  >
                    Excluir
                  </Button>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={canManage && Boolean(exclusao)}
        onOpenChange={(open) => !open && !excluirCadastroMutation.isPending && setExclusao(null)}
      >
        <DialogContent
          className="sm:max-w-md"
          onEscapeKeyDown={(event) => excluirCadastroMutation.isPending && event.preventDefault()}
          onPointerDownOutside={(event) =>
            excluirCadastroMutation.isPending && event.preventDefault()
          }
        >
          <DialogHeader>
            <DialogTitle>Confirmar exclusão definitiva</DialogTitle>
            <DialogDescription>
              Excluir {exclusao?.tipo === "cargo" ? "o cargo" : "a pessoa manual"} “{exclusao?.nome}
              ”? Esta ação não pode ser desfeita. Se houver vínculos com obras, a exclusão será
              bloqueada; remova todos os vínculos primeiro.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={excluirCadastroMutation.isPending}
              onClick={() => setExclusao(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!exclusao || excluirCadastroMutation.isPending}
              onClick={() => exclusao && excluirCadastroMutation.mutate(exclusao)}
            >
              {excluirCadastroMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
