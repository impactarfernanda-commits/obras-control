import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Loader2, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import {
  ResponsavelPessoaSearchSelect,
  type OpcaoPessoaResponsavel,
} from "@/components/ResponsavelPessoaSearchSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  filtrarObrasResponsaveis,
  excluirCadastroResponsavel,
  montarHierarquiaResponsaveis,
  normalizarBuscaResponsaveis,
  obrasExibidasResponsaveis,
  podeGerenciarResponsaveis,
  pessoasSemelhantes,
  resumirVinculosLote,
  selecionarCcsColados,
  vincularResponsavelEmLote,
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
  const [loteOpen, setLoteOpen] = useState(false);
  const [lotePessoaOpcaoId, setLotePessoaOpcaoId] = useState("");
  const [loteCargoId, setLoteCargoId] = useState("");
  const [loteSelecionados, setLoteSelecionados] = useState<string[]>([]);
  const [loteBusca, setLoteBusca] = useState("");
  const [loteCodigos, setLoteCodigos] = useState("");
  const [loteNaoEncontrados, setLoteNaoEncontrados] = useState<string[]>([]);
  const [loteConfirmacao, setLoteConfirmacao] = useState<{
    obraIds: string[];
    pessoaId: string | null;
    opcaoId: string;
    cargoId: string;
    novos: number;
    existentes: number;
  } | null>(null);
  const [loteResultado, setLoteResultado] = useState<{
    criados: number;
    existentes: number;
    falhas: Array<{ obraId: string; erro: string }>;
  } | null>(null);
  const [manualTarget, setManualTarget] = useState<"single" | "batch">("single");

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
  const obrasElegiveis = useMemo(
    () => obrasExibidasResponsaveis(obras, mostrarFinalizadas),
    [obras, mostrarFinalizadas],
  );
  const obrasLoteFiltradas = useMemo(
    () => filtrarObrasResponsaveis(obrasElegiveis, loteBusca, true),
    [obrasElegiveis, loteBusca],
  );
  const idsElegiveis = new Set(obrasElegiveis.map((obra) => obra.id));
  const idsLoteEfetivos = loteSelecionados.filter((id) => idsElegiveis.has(id));
  const hierarquia = useMemo(
    () => montarHierarquiaResponsaveis(obras, search, mostrarFinalizadas),
    [obras, search, mostrarFinalizadas],
  );
  const semResultados =
    hierarquia.gerentes.length === 0 &&
    hierarquia.coordenadoresDiretos.length === 0 &&
    hierarquia.semGestor.length === 0;
  const selected = obras.find((obra) => obra.id === selectedId) ?? null;
  const semelhantes = useMemo(() => pessoasSemelhantes(pessoas, manualNome), [pessoas, manualNome]);

  function selecionarCodigosLote() {
    const { ids, naoEncontrados } = selecionarCcsColados(obrasElegiveis, loteCodigos);
    setLoteSelecionados((atual) => [
      ...new Set([...atual.filter((id) => idsElegiveis.has(id)), ...ids]),
    ]);
    setLoteNaoEncontrados(naoEncontrados);
  }

  async function garantirPessoaLote(opcao: OpcaoPessoaResponsavel): Promise<string> {
    if (opcao.pessoa_id) return opcao.pessoa_id;
    if (!opcao.funcionario_id) throw new Error("Pessoa não identificada.");
    const { data, error: insertError } = await supabase
      .from("responsaveis_pessoas")
      .insert({ funcionario_id: opcao.funcionario_id, created_by: user?.id ?? null })
      .select("id")
      .single();
    if (!insertError) return data.id;
    if (insertError.code !== "23505") throw insertError;
    const { data: existente, error } = await supabase
      .from("responsaveis_pessoas")
      .select("id")
      .eq("funcionario_id", opcao.funcionario_id)
      .single();
    if (error) throw error;
    return existente.id;
  }

  async function prepararLote() {
    try {
      if (!canManage) throw new Error("Sem permissão para vincular responsáveis.");
      const opcao = pessoas.find((item) => item.opcao_id === lotePessoaOpcaoId);
      if (!opcao || !loteCargoId || idsLoteEfetivos.length === 0) {
        throw new Error("Selecione pessoa, cargo e ao menos um centro de custo.");
      }
      const obraIds = [...idsLoteEfetivos];
      const { data: cargosDaObra, error: cargoError } = await supabase
        .from("obra_responsabilidade_cargos")
        .select("id,obra_id")
        .eq("cargo_id", loteCargoId)
        .in("obra_id", obraIds);
      if (cargoError) throw cargoError;
      const pessoaId = opcao.pessoa_id;
      const existentes = new Set<string>();
      if (pessoaId && cargosDaObra.length) {
        const { data: vinculos, error: vinculoError } = await supabase
          .from("obra_responsabilidade_pessoas")
          .select("obra_cargo_id")
          .eq("pessoa_id", pessoaId)
          .in(
            "obra_cargo_id",
            cargosDaObra.map((item) => item.id),
          );
        if (vinculoError) throw vinculoError;
        const cargoIds = new Set(vinculos.map((item) => item.obra_cargo_id));
        cargosDaObra.forEach((item) => {
          if (cargoIds.has(item.id)) existentes.add(item.obra_id);
        });
      }
      setLoteConfirmacao({
        obraIds,
        pessoaId,
        opcaoId: opcao.opcao_id,
        cargoId: loteCargoId,
        ...resumirVinculosLote(obraIds, existentes),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível preparar o lote.");
    }
  }

  const loteMutation = useMutation({
    mutationFn: async (plano: NonNullable<typeof loteConfirmacao>) => {
      if (!canManage) throw new Error("Sem permissão para vincular responsáveis.");
      const opcao = pessoas.find((item) => item.opcao_id === plano.opcaoId);
      if (!opcao || !cargos.some((cargo) => cargo.id === plano.cargoId && cargo.ativo)) {
        throw new Error("Pessoa ou cargo ativo não encontrado. Atualize a página.");
      }
      const pessoaId = await garantirPessoaLote(opcao);
      return vincularResponsavelEmLote(role, plano.obraIds, async (obraId) => {
        const { data: found, error: findError } = await supabase
          .from("obra_responsabilidade_cargos")
          .select("id")
          .eq("obra_id", obraId)
          .eq("cargo_id", plano.cargoId)
          .maybeSingle();
        if (findError) throw findError;
        let obraCargoId = found?.id;
        if (!obraCargoId) {
          const { data: created, error: createError } = await supabase
            .from("obra_responsabilidade_cargos")
            .insert({ obra_id: obraId, cargo_id: plano.cargoId, created_by: user?.id ?? null })
            .select("id")
            .single();
          if (createError && createError.code !== "23505") throw createError;
          if (createError) {
            const { data: concurrent, error: concurrentError } = await supabase
              .from("obra_responsabilidade_cargos")
              .select("id")
              .eq("obra_id", obraId)
              .eq("cargo_id", plano.cargoId)
              .single();
            if (concurrentError) throw concurrentError;
            obraCargoId = concurrent.id;
          } else obraCargoId = created.id;
        }
        const { data: existing, error: existingError } = await supabase
          .from("obra_responsabilidade_pessoas")
          .select("id")
          .eq("obra_cargo_id", obraCargoId)
          .eq("pessoa_id", pessoaId)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) return "existente";
        const { error: linkError } = await supabase.from("obra_responsabilidade_pessoas").insert({
          obra_cargo_id: obraCargoId,
          pessoa_id: pessoaId,
          created_by: user?.id ?? null,
        });
        if (linkError?.code === "23505") return "existente";
        if (linkError) throw linkError;
        return "criado";
      });
    },
    onSuccess: (resultado) => {
      setLoteResultado(resultado);
      setLoteConfirmacao(null);
      invalidateAll();
      if (resultado.falhas.length) toast.warning("Lote concluído com falhas. Confira o resultado.");
      else toast.success("Vínculos em lote concluídos.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

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
      if (manualTarget === "batch") setLotePessoaOpcaoId(`manual:${id}`);
      else setPessoaOpcaoId(`manual:${id}`);
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
              <Button
                onClick={() => {
                  setLoteResultado(null);
                  setLoteOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Vincular em lote
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
      ) : semResultados ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma obra encontrada.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          <section aria-label="Direção de Obras" className="mx-auto max-w-xl text-center">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Direção de Obras
            </p>
            <Card>
              <CardContent className="space-y-2 p-5">
                {hierarquia.diretores.length ? (
                  hierarquia.diretores.map((diretor) => (
                    <div key={diretor.pessoaId}>
                      <p className="text-lg font-semibold">{diretor.nome}</p>
                      <p className="text-sm text-muted-foreground">Diretor de Obras</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Diretor de Obras não definido nos CCs exibidos.
                  </p>
                )}
              </CardContent>
            </Card>
          </section>

          {hierarquia.gerentes.length > 0 && (
            <section aria-label="Gerentes de Obras">
              <h2 className="mb-4 text-lg font-semibold">Gerentes de Obras</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {hierarquia.gerentes.map((gerente) => (
                  <Card key={gerente.pessoaId}>
                    <CardHeader>
                      <CardTitle className="text-lg">{gerente.nome}</CardTitle>
                      <p className="text-sm text-muted-foreground">Gerente de Obras</p>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {gerente.obras.map((obra) => (
                        <Button
                          key={obra.id}
                          variant="outline"
                          className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                          onClick={() => setSelectedId(obra.id)}
                        >
                          {obra.nome}
                        </Button>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {hierarquia.coordenadoresDiretos.length > 0 && (
            <section aria-label="Coordenadores com gestão direta">
              <h2 className="mb-4 text-lg font-semibold">Coordenadores com gestão direta</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {hierarquia.coordenadoresDiretos.map((coordenador) => (
                  <Card key={coordenador.pessoaId}>
                    <CardHeader>
                      <CardTitle className="text-lg">{coordenador.nome}</CardTitle>
                      <p className="text-sm text-muted-foreground">Coordenador de Obras</p>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {coordenador.obras.map((obra) => (
                        <Button
                          key={obra.id}
                          variant="outline"
                          className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                          onClick={() => setSelectedId(obra.id)}
                        >
                          {obra.nome}
                        </Button>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {hierarquia.semGestor.length > 0 && (
            <section aria-label="Centros de custo sem gerente ou coordenador definido">
              <h2 className="mb-4 text-lg font-semibold">
                CCs sem gerente ou coordenador definido
              </h2>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {hierarquia.semGestor.map((obra) => (
                  <Button
                    key={obra.id}
                    variant="outline"
                    className="h-auto justify-start whitespace-normal py-3 text-left"
                    onClick={() => setSelectedId(obra.id)}
                  >
                    {obra.nome}
                  </Button>
                ))}
              </div>
            </section>
          )}
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
                  setManualTarget("single");
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

      <Dialog open={canManage && loteOpen} onOpenChange={setLoteOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Vincular em lote</DialogTitle>
            <DialogDescription>
              Adicione uma pessoa a vários centros de custo sem substituir os responsáveis atuais.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pessoa</Label>
              <ResponsavelPessoaSearchSelect
                pessoas={pessoas}
                value={lotePessoaOpcaoId}
                onValueChange={setLotePessoaOpcaoId}
                onAddManual={(termo) => {
                  setManualTarget("batch");
                  setManualNome(termo);
                  setManualOpen(true);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Cargo</Label>
              <Select value={loteCargoId} onValueChange={setLoteCargoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um cargo ativo" />
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
              <Label htmlFor="lote-busca">Centros de custo</Label>
              <Input
                id="lote-busca"
                value={loteBusca}
                onChange={(event) => setLoteBusca(event.target.value)}
                placeholder="Buscar CC ou obra"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLoteSelecionados((atual) => [
                      ...new Set([
                        ...atual.filter((id) => idsElegiveis.has(id)),
                        ...obrasLoteFiltradas.map((obra) => obra.id),
                      ]),
                    ])
                  }
                >
                  Selecionar todos{loteBusca ? " da busca" : ""}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setLoteSelecionados([])}
                >
                  Limpar seleção
                </Button>
                <span className="text-sm text-muted-foreground">
                  {idsLoteEfetivos.length} selecionados
                </span>
              </div>
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
                {obrasLoteFiltradas.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">Nenhum CC encontrado.</p>
                )}
                {obrasLoteFiltradas.map((obra) => (
                  <label
                    key={obra.id}
                    className="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-accent"
                  >
                    <Checkbox
                      checked={idsLoteEfetivos.includes(obra.id)}
                      onCheckedChange={(checked) =>
                        setLoteSelecionados((atual) =>
                          checked
                            ? [...new Set([...atual, obra.id])]
                            : atual.filter((id) => id !== obra.id),
                        )
                      }
                    />
                    <span className="text-sm">{obra.nome}</span>
                    {obra.status === "Concluída" && <Badge variant="outline">Concluída</Badge>}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lote-codigos">Colar códigos dos CCs</Label>
              <div className="flex gap-2">
                <Input
                  id="lote-codigos"
                  value={loteCodigos}
                  onChange={(event) => setLoteCodigos(event.target.value)}
                  placeholder="150, 173, 217, 230"
                />
                <Button type="button" variant="outline" onClick={selecionarCodigosLote}>
                  Marcar CCs
                </Button>
              </div>
              {loteNaoEncontrados.length > 0 && (
                <p className="text-sm text-destructive">
                  Códigos não encontrados entre os CCs exibidos: {loteNaoEncontrados.join(", ")}
                </p>
              )}
            </div>
            {loteResultado && (
              <div role="status" className="space-y-1 rounded-md border p-3 text-sm">
                <p>
                  {loteResultado.criados} vínculos criados; {loteResultado.existentes} já
                  existentes/preservados; {loteResultado.falhas.length} falhas.
                </p>
                {loteResultado.falhas.map((falha) => (
                  <p key={falha.obraId} className="text-destructive">
                    {obras.find((obra) => obra.id === falha.obraId)?.nome ?? falha.obraId}:{" "}
                    {falha.erro}
                  </p>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLoteOpen(false)}>
              Fechar
            </Button>
            <Button
              disabled={
                !lotePessoaOpcaoId ||
                !loteCargoId ||
                !idsLoteEfetivos.length ||
                loteMutation.isPending
              }
              onClick={prepararLote}
            >
              Revisar vínculos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(loteConfirmacao)}
        onOpenChange={(open) => !open && setLoteConfirmacao(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar vinculação em lote</DialogTitle>
            <DialogDescription>
              Os vínculos existentes e outras pessoas serão preservados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <p>Pessoa: {pessoas.find((p) => p.opcao_id === loteConfirmacao?.opcaoId)?.nome}</p>
            <p>Cargo: {cargos.find((c) => c.id === loteConfirmacao?.cargoId)?.nome}</p>
            <p>{loteConfirmacao?.obraIds.length} centros de custo selecionados</p>
            <p>{loteConfirmacao?.novos} novos vínculos</p>
            <p>{loteConfirmacao?.existentes} já existentes</p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={loteMutation.isPending}
              onClick={() => setLoteConfirmacao(null)}
            >
              Cancelar
            </Button>
            <Button
              disabled={loteMutation.isPending || !loteConfirmacao}
              onClick={() => loteConfirmacao && loteMutation.mutate(loteConfirmacao)}
            >
              {loteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
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
                      if (manualTarget === "batch") setLotePessoaOpcaoId(pessoa.opcao_id);
                      else setPessoaOpcaoId(pessoa.opcao_id);
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
