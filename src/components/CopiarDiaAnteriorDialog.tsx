import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, RotateCcw, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  formatarDataCopia,
  diaAnterior,
  itensSelecionadosCopia,
  logErroCopiaDia,
  totalNaoCopiar,
  totalSelecionadosCopia,
  type JornadaCopiaRascunho,
  type ResumoCopiaDia,
} from "@/lib/copiar-dia-anterior";
import { ALOCACAO_ACTION_BUTTON_CLASS } from "@/lib/alocacoes-runtime";
import { useAuth } from "@/hooks/use-auth";
import { usePersistentDraft } from "@/hooks/use-persistent-draft";
import { dataLocalHoje, validarDataLancamento } from "@/lib/data-lancamento";
import { calcularCompetencia } from "@/lib/competencias";
import { calcularJornadaDetalhada } from "@/lib/jornada-horas";
import { exigeJustificativaExtras, justificativaExtrasValida } from "@/lib/extras-justificativa";
import { categoriaEhAjudante, type EspecialidadeAjudante } from "@/lib/especialidade-ajudante";
import {
  SUPERVISOR_CC_DATA_CORTE,
  SUPERVISOR_CC_VIGENCIAS_ATIVAS,
  categoriaEhSupervisor,
} from "@/lib/supervisor-cc";
import {
  especialidadeNovaAlocacao,
  funcionariosAjudantesSemEspecialidade,
  resolverEspecialidadeAjudante,
  type ResolucaoEspecialidadeAjudante,
} from "@/lib/resolver-especialidade-ajudante";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ResumoCopiaResolvido = Omit<ResumoCopiaDia, "itens"> & {
  itens: Array<
    ResumoCopiaDia["itens"][number] & {
      ajudante: boolean;
      resolucao: ResolucaoEspecialidadeAjudante | null;
    }
  >;
};

type CopiarDiaDraft = {
  destino: string;
  origem?: string;
  previa: ResumoCopiaResolvido | null;
  rascunhos: Record<string, JornadaCopiaRascunho>;
  funcoes: Record<string, string | null>;
  feriados: string[];
  editandoId: string | null;
  escolhas: Record<string, EspecialidadeAjudante>;
};

function isCopiarDiaDraft(value: unknown): value is CopiarDiaDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<CopiarDiaDraft>;
  const previaValida =
    draft.previa === null ||
    (!!draft.previa &&
      typeof draft.previa === "object" &&
      typeof draft.previa.origem_data === "string" &&
      typeof draft.previa.destino_data === "string" &&
      Array.isArray(draft.previa.itens) &&
      draft.previa.itens.every(
        (item) =>
          !!item &&
          typeof item === "object" &&
          typeof item.funcionario_id === "string" &&
          typeof item.nome === "string" &&
          typeof item.status === "string",
      ));
  const rascunhosValidos =
    !!draft.rascunhos &&
    typeof draft.rascunhos === "object" &&
    Object.values(draft.rascunhos).every(
      (item) =>
        !!item &&
        typeof item === "object" &&
        typeof item.funcionarioId === "string" &&
        typeof item.incluirNaCopia === "boolean" &&
        typeof item.horaEntrada === "string" &&
        typeof item.horaSaida === "string" &&
        typeof item.intervaloMinutos === "number" &&
        typeof item.horasNormais === "number" &&
        typeof item.horasExtras === "number" &&
        !!item.detalhe &&
        typeof item.detalhe === "object",
    );
  return (
    typeof draft.destino === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.destino) &&
    (draft.origem === undefined ||
      (typeof draft.origem === "string" && /^\d{4}-\d{2}-\d{2}$/.test(draft.origem))) &&
    previaValida &&
    rascunhosValidos &&
    !!draft.funcoes &&
    typeof draft.funcoes === "object" &&
    Array.isArray(draft.feriados) &&
    (draft.editandoId === null || typeof draft.editandoId === "string") &&
    !!draft.escolhas &&
    typeof draft.escolhas === "object" &&
    Object.values(draft.escolhas).every((item) => item === "civil" || item === "montagem")
  );
}

export function CopiarDiaAnteriorDialog({
  obraId,
  obraNome,
}: {
  obraId: string;
  obraNome: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const hoje = dataLocalHoje();
  const [destino, setDestino] = useState(hoje);
  const [origem, setOrigem] = useState(diaAnterior(hoje));
  const [previa, setPrevia] = useState<ResumoCopiaResolvido | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, JornadaCopiaRascunho>>({});
  const [funcoes, setFuncoes] = useState<Record<string, string | null>>({});
  const [feriados, setFeriados] = useState<Set<string>>(new Set());
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, EspecialidadeAjudante>>({});
  const [carregando, setCarregando] = useState(false);
  const confirmacaoEmAndamento = useRef(false);
  const draft = usePersistentDraft<CopiarDiaDraft>({
    userId: user?.id,
    flow: "copiar-dia-anterior",
    context: obraId,
    validate: isCopiarDiaDraft,
  });
  const {
    clear: clearDraft,
    persist: persistDraft,
    recovered: draftRecovered,
    restored: restoredDraft,
  } = draft;

  useEffect(() => {
    if (!restoredDraft) return;
    setDestino(restoredDraft.destino);
    setOrigem(
      restoredDraft.origem ??
        restoredDraft.previa?.origem_data ??
        diaAnterior(restoredDraft.destino),
    );
    setPrevia(restoredDraft.previa);
    setRascunhos(restoredDraft.rascunhos);
    setFuncoes(restoredDraft.funcoes);
    setFeriados(new Set(restoredDraft.feriados));
    setEditandoId(restoredDraft.editandoId);
    setEscolhas(restoredDraft.escolhas);
  }, [restoredDraft]);

  useEffect(() => {
    persistDraft({
      destino,
      origem,
      previa,
      rascunhos,
      funcoes,
      feriados: [...feriados],
      editandoId,
      escolhas,
    });
  }, [destino, editandoId, escolhas, feriados, funcoes, origem, persistDraft, previa, rascunhos]);

  function resetForm() {
    setDestino(hoje);
    setOrigem(diaAnterior(hoje));
    setPrevia(null);
    setRascunhos({});
    setFuncoes({});
    setFeriados(new Set());
    setEscolhas({});
    setEditandoId(null);
  }

  async function buscarPrevia() {
    setCarregando(true);
    setPrevia(null);
    try {
      validarDataLancamento(destino, "alocacao");
      if (!origem || origem >= destino)
        throw new Error("A data de origem deve ser anterior à data de destino.");
      const competenciaDestino = calcularCompetencia(destino);
      const [
        resumoResult,
        origemResult,
        registrosOrigemResult,
        historicoResult,
        funcionariosResult,
        feriadosResult,
      ] = await Promise.all([
        supabase.rpc(
          "obras_copiar_dia_anterior" as never,
          {
            p_obra_id: obraId,
            p_data_origem: origem,
            p_data_destino: destino,
            p_aplicar: false,
          } as never,
        ),
        supabase
          .from("alocacoes")
          .select(
            "funcionario_id, obra_id, data, especialidade_ajudante, hora_entrada, hora_saida, intervalo_padrao_minutos",
          )
          .eq("obra_id", obraId)
          .eq("data", origem),
        supabase
          .from("registros_horas")
          .select("funcionario_id,horas_normais,horas_extras,justificativa_extras,observacoes")
          .eq("obra_id", obraId)
          .eq("data", origem)
          .eq("tipo_registro", "horas"),
        supabase
          .from("alocacoes")
          .select("funcionario_id, obra_id, data, especialidade_ajudante")
          .eq("obra_id", obraId)
          .gte("data", competenciaDestino.data_inicio)
          .lt("data", destino)
          .not("especialidade_ajudante", "is", null),
        supabase.rpc("obras_control_funcionarios_safe"),
        supabase
          .from("feriados_obras_control" as never)
          .select("data" as never)
          .eq("ativo" as never, true),
      ]);
      if (resumoResult.error) throw resumoResult.error;
      if (origemResult.error) throw origemResult.error;
      if (registrosOrigemResult.error) throw registrosOrigemResult.error;
      if (historicoResult.error) throw historicoResult.error;
      if (funcionariosResult.error) throw funcionariosResult.error;
      if (feriadosResult.error) throw feriadosResult.error;
      const resumo = resumoResult.data as unknown as ResumoCopiaDia;
      const categorias = new Map(
        (
          funcionariosResult.data as unknown as Array<{ id: string; categoria_mo: string | null }>
        ).map((funcionario) => [funcionario.id, funcionario.categoria_mo]),
      );
      const origens = new Map(
        (origemResult.data ?? []).map((alocacao) => [alocacao.funcionario_id, alocacao]),
      );
      const registrosOrigem = new Map(
        (registrosOrigemResult.data ?? []).map((registro) => [registro.funcionario_id, registro]),
      );
      const feriadosPrevia = new Set(
        (feriadosResult.data as unknown as Array<{ data: string }>).map((item) => item.data),
      );
      const funcoesPrevia = Object.fromEntries(categorias);
      const rascunhosPrevia: Record<string, JornadaCopiaRascunho> = {};
      setEscolhas({});
      setEditandoId(null);
      const previaResolvida: ResumoCopiaResolvido = {
        ...resumo,
        itens: resumo.itens
          .filter(
            (item) =>
              !SUPERVISOR_CC_VIGENCIAS_ATIVAS ||
              destino < SUPERVISOR_CC_DATA_CORTE ||
              !categoriaEhSupervisor(categorias.get(item.funcionario_id)),
          )
          .map((item) => {
            const ajudante = categoriaEhAjudante(categorias.get(item.funcionario_id));
            const alocacaoOrigem = origens.get(item.funcionario_id);
            const registroOrigem = registrosOrigem.get(item.funcionario_id);
            if (item.status === "adicionar") {
              const horaEntrada = alocacaoOrigem?.hora_entrada?.slice(0, 5) ?? "07:00";
              const intervaloMinutos = alocacaoOrigem?.intervalo_padrao_minutos ?? 60;
              const totalLegado =
                Number(registroOrigem?.horas_normais ?? 0) +
                Number(registroOrigem?.horas_extras ?? 0);
              const minutosSaida =
                (Number(horaEntrada.slice(0, 2)) * 60 +
                  Number(horaEntrada.slice(3, 5)) +
                  Math.round(totalLegado * 60) +
                  intervaloMinutos) %
                1440;
              const horaSaida =
                alocacaoOrigem?.hora_saida?.slice(0, 5) ??
                `${String(Math.floor(minutosSaida / 60)).padStart(2, "0")}:${String(minutosSaida % 60).padStart(2, "0")}`;
              const detalhe = calcularJornadaDetalhada({
                data: destino,
                horaEntrada,
                horaSaida,
                intervaloMinutos,
                funcao: categorias.get(item.funcionario_id),
                feriados: feriadosPrevia,
              });
              rascunhosPrevia[item.funcionario_id] = {
                funcionarioId: item.funcionario_id,
                incluirNaCopia: true,
                horaEntrada,
                horaSaida,
                intervaloMinutos,
                horasNormais: (detalhe.minutosNormais + detalhe.minutosSemAdicionalHe) / 60,
                horasExtras: (detalhe.minutosHe50 + detalhe.minutosHe100) / 60,
                justificativa: registroOrigem?.justificativa_extras ?? null,
                observacoes: registroOrigem?.observacoes ?? null,
                detalhe,
                ajustada: false,
              };
            }
            return {
              ...item,
              ajudante,
              resolucao: ajudante
                ? resolverEspecialidadeAjudante({
                    funcionarioId: item.funcionario_id,
                    obraId,
                    competencia: competenciaDestino.competencia,
                    dataDestino: destino,
                    especialidadeOrigem: alocacaoOrigem?.especialidade_ajudante,
                    historico: historicoResult.data ?? [],
                  })
                : null,
            };
          }),
      };
      setFuncoes(funcoesPrevia);
      setFeriados(feriadosPrevia);
      setRascunhos(rascunhosPrevia);
      setPrevia(previaResolvida);
    } catch (error) {
      logErroCopiaDia("previa", error);
      toast.error((error as { message?: string }).message ?? "Erro ao preparar a cópia");
    } finally {
      setCarregando(false);
    }
  }

  function atualizarJornadaRascunho(
    funcionarioId: string,
    alteracao: Partial<
      Pick<
        JornadaCopiaRascunho,
        "horaEntrada" | "horaSaida" | "intervaloMinutos" | "justificativa" | "observacoes"
      >
    >,
  ) {
    setRascunhos((atuais) => {
      const atual = atuais[funcionarioId];
      if (!atual || !previa) return atuais;
      const proximo = { ...atual, ...alteracao };
      const detalhe = calcularJornadaDetalhada({
        data: previa.destino_data,
        horaEntrada: proximo.horaEntrada,
        horaSaida: proximo.horaSaida,
        intervaloMinutos: proximo.intervaloMinutos,
        funcao: funcoes[funcionarioId],
        feriados,
      });
      return {
        ...atuais,
        [funcionarioId]: {
          ...proximo,
          horasNormais: (detalhe.minutosNormais + detalhe.minutosSemAdicionalHe) / 60,
          horasExtras: (detalhe.minutosHe50 + detalhe.minutosHe100) / 60,
          detalhe,
          ajustada: true,
        },
      };
    });
  }

  function definirInclusao(funcionarioId: string, incluirNaCopia: boolean) {
    setRascunhos((atuais) => ({
      ...atuais,
      [funcionarioId]: { ...atuais[funcionarioId], incluirNaCopia },
    }));
    if (!incluirNaCopia) setEditandoId((atual) => (atual === funcionarioId ? null : atual));
  }

  async function confirmar() {
    if (!previa || confirmacaoEmAndamento.current) return;
    const candidatos = itensSelecionadosCopia(previa.itens, rascunhos);
    const pendentes = funcionariosAjudantesSemEspecialidade(candidatos, escolhas);
    if (pendentes.length > 0) {
      toast.error(`Informe a atuação de: ${pendentes.map(({ nome }) => nome).join(", ")}.`);
      return;
    }
    confirmacaoEmAndamento.current = true;
    setCarregando(true);
    try {
      validarDataLancamento(previa.destino_data, "alocacao");
      const ids = candidatos.map(({ funcionario_id }) => funcionario_id);
      const [alocacoesDestino, registrosDestino] = await Promise.all([
        supabase
          .from("alocacoes")
          .select("funcionario_id")
          .eq("obra_id", obraId)
          .eq("data", previa.destino_data)
          .in("funcionario_id", ids),
        supabase
          .from("registros_horas")
          .select("funcionario_id")
          .eq("obra_id", obraId)
          .eq("data", previa.destino_data)
          .in("funcionario_id", ids),
      ]);
      for (const resultado of [alocacoesDestino, registrosDestino])
        if (resultado.error) throw resultado.error;
      const ocupados = new Set([
        ...(alocacoesDestino.data ?? []).map(({ funcionario_id }) => funcionario_id),
        ...(registrosDestino.data ?? []).map(({ funcionario_id }) => funcionario_id),
      ]);
      const alvos = candidatos.filter(({ funcionario_id }) => !ocupados.has(funcionario_id));
      const itens = alvos.map((item) => {
        const rascunho = rascunhos[item.funcionario_id];
        if (!rascunho) throw new Error(`${item.nome}: jornada da prévia não encontrada.`);
        const { detalhe } = rascunho;
        if (!detalhe.valido) throw new Error(`${item.nome}: ${detalhe.erro}`);
        if (
          !justificativaExtrasValida(
            {
              horasExtras: rascunho.horasExtras,
              totalTrabalhadoMinutos: detalhe.totalTrabalhadoMinutos,
            },
            rascunho.justificativa,
          )
        )
          throw new Error(`${item.nome}: a jornada copiada exige justificativa de hora extra.`);
        return {
          funcionarioId: item.funcionario_id,
          obraId,
          data: previa.destino_data,
          horaEntrada: rascunho.horaEntrada,
          horaSaida: rascunho.horaSaida,
          intervaloMinutos: rascunho.intervaloMinutos,
          horasNormais: rascunho.horasNormais,
          horasExtras: rascunho.horasExtras,
          justificativa: rascunho.justificativa?.trim() || null,
          observacoes: rascunho.observacoes?.trim() || null,
          origemCalculo: "copia",
          especialidadeAjudante: especialidadeNovaAlocacao({
            ajudante: item.ajudante,
            resolucao: item.resolucao,
            escolha: escolhas[item.funcionario_id],
          }),
          detalhe,
        };
      });
      let resultadoCopia = { processados: 0, preservados: 0 };
      if (itens.length > 0) {
        const { data, error } = await supabase.rpc(
          "obras_copiar_jornadas_v2" as never,
          { p_itens: itens } as never,
        );
        if (error) throw error;
        resultadoCopia = data as unknown as { processados: number; preservados: number };
      }
      const totalCopiados = Number(resultadoCopia.processados ?? 0);
      if (totalCopiados === 0)
        toast.info("Nenhum funcionário para copiar. A equipe do dia já está atualizada.");
      else
        toast.success(
          `${totalCopiados} funcionários copiados de ${formatarDataCopia(previa.origem_data)} para ${formatarDataCopia(previa.destino_data)}.` +
            (resultadoCopia.preservados > 0
              ? ` ${resultadoCopia.preservados} já existentes foram preservados.`
              : ""),
        );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["alocacoes-mes"] }),
        qc.invalidateQueries({ queryKey: ["registros-mes"] }),
        qc.invalidateQueries({ queryKey: ["alocacoes-current"] }),
        qc.invalidateQueries({ queryKey: ["registros"] }),
      ]);
      setOpen(false);
      clearDraft();
      resetForm();
    } catch (error) {
      logErroCopiaDia("aplicacao", error);
      toast.error((error as { message?: string }).message ?? "Erro ao copiar equipe");
    } finally {
      confirmacaoEmAndamento.current = false;
      setCarregando(false);
    }
  }

  const selecionados = previa ? totalSelecionadosCopia(previa.itens, rascunhos) : 0;
  const naoCopiar = previa ? totalNaoCopiar(previa.itens, rascunhos) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={ALOCACAO_ACTION_BUTTON_CLASS}>
          <Copy className="mr-2 h-4 w-4" />
          Copiar equipe de outra data
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Copiar equipe de outra data</DialogTitle>
          <DialogDescription>{obraNome}</DialogDescription>
        </DialogHeader>
        {draftRecovered && <p className="text-xs text-muted-foreground">Rascunho recuperado</p>}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Data de origem</label>
              <Input
                type="date"
                max={diaAnterior(destino)}
                value={origem}
                onChange={(e) => {
                  setOrigem(e.target.value);
                  setPrevia(null);
                  setRascunhos({});
                  setEditandoId(null);
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Data de destino</label>
              <Input
                type="date"
                max={hoje}
                value={destino}
                onChange={(e) => {
                  const proximoDestino = e.target.value;
                  setDestino(proximoDestino);
                  setOrigem(diaAnterior(proximoDestino));
                  setPrevia(null);
                  setRascunhos({});
                  setEditandoId(null);
                }}
              />
            </div>
          </div>
          {!previa ? (
            <Button onClick={buscarPrevia} disabled={!origem || !destino || carregando}>
              {carregando ? "Buscando..." : "Ver prévia"}
            </Button>
          ) : (
            <>
              <p className="font-medium">
                Copiar equipe de {formatarDataCopia(previa.origem_data)} para{" "}
                {formatarDataCopia(previa.destino_data)}
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <div className="rounded border p-2">
                  Equipe origem
                  <br />
                  <strong>{previa.total_origem}</strong>
                </div>
                <div className="rounded border p-2">
                  Já existentes
                  <br />
                  <strong>{previa.total_ja_existentes}</strong>
                </div>
                <div className="rounded border p-2">
                  Inelegíveis
                  <br />
                  <strong>{previa.total_inelegiveis}</strong>
                </div>
                <div className="rounded border p-2">
                  Não copiar
                  <br />
                  <strong>{naoCopiar}</strong>
                </div>
                <div className="rounded border p-2">
                  Serão adicionados
                  <br />
                  <strong>{selecionados}</strong>
                </div>
              </div>
              {previa.total_suprimidos > 0 && (
                <p className="text-sm text-muted-foreground">
                  {previa.total_suprimidos}{" "}
                  {previa.total_suprimidos === 1
                    ? "lançamento excluído foi preservado"
                    : "lançamentos excluídos foram preservados"}
                  .
                </p>
              )}
              <ul className="max-h-96 divide-y overflow-y-auto rounded border">
                {previa.itens.map((item) => {
                  const rascunho = rascunhos[item.funcionario_id];
                  const selecionado = rascunho?.incluirNaCopia ?? false;
                  const editando = editandoId === item.funcionario_id;
                  const exigeJustificativa = rascunho
                    ? exigeJustificativaExtras({
                        horasExtras: rascunho.horasExtras,
                        totalTrabalhadoMinutos: rascunho.detalhe.totalTrabalhadoMinutos,
                      })
                    : false;
                  return (
                    <li key={item.funcionario_id} className="space-y-2 p-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span>{item.nome}</span>
                          {rascunho?.ajustada && selecionado && (
                            <Badge variant="outline" className="ml-2">
                              Jornada ajustada
                            </Badge>
                          )}
                          {item.status === "adicionar" && item.ajudante && selecionado && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Atuação:{" "}
                              {item.resolucao?.estado === "resolvida" ? (
                                <Badge variant="outline">
                                  {item.resolucao.especialidade === "civil" ? "Civil" : "Montagem"}
                                </Badge>
                              ) : (
                                <Select
                                  value={escolhas[item.funcionario_id] ?? ""}
                                  onValueChange={(value: EspecialidadeAjudante) =>
                                    setEscolhas((atuais) => ({
                                      ...atuais,
                                      [item.funcionario_id]: value,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="mt-1 h-8 w-36">
                                    <SelectValue placeholder="A definir" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="civil">Civil</SelectItem>
                                    <SelectItem value="montagem">Montagem</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          )}
                        </div>
                        <Badge
                          variant={
                            item.status === "adicionar" && selecionado ? "default" : "secondary"
                          }
                        >
                          {item.status === "adicionar"
                            ? selecionado
                              ? "Será adicionado"
                              : "Não será copiado"
                            : item.status === "excluido_destino"
                              ? "Excluído no destino — não será recriado"
                              : item.status === "inelegivel"
                                ? item.motivo || "Não será copiado — desligado/inelegível"
                                : "Já existe no destino"}
                        </Badge>
                      </div>
                      {item.status === "adicionar" && rascunho && (
                        <div className="flex flex-wrap gap-2">
                          {selecionado ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setEditandoId(editando ? null : item.funcionario_id)}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Editar jornada
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => definirInclusao(item.funcionario_id, false)}
                              >
                                <UserMinus className="mr-1 h-3.5 w-3.5" />
                                Não copiar
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => definirInclusao(item.funcionario_id, true)}
                            >
                              <RotateCcw className="mr-1 h-3.5 w-3.5" />
                              Restaurar
                            </Button>
                          )}
                        </div>
                      )}
                      {item.status === "adicionar" && rascunho && selecionado && editando && (
                        <div className="space-y-3 rounded-md bg-muted/40 p-3">
                          <div className="grid grid-cols-3 gap-2">
                            <label className="space-y-1 text-xs">
                              <span>Entrada</span>
                              <Input
                                type="time"
                                value={rascunho.horaEntrada}
                                onChange={(event) =>
                                  atualizarJornadaRascunho(item.funcionario_id, {
                                    horaEntrada: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="space-y-1 text-xs">
                              <span>Saída</span>
                              <Input
                                type="time"
                                value={rascunho.horaSaida}
                                onChange={(event) =>
                                  atualizarJornadaRascunho(item.funcionario_id, {
                                    horaSaida: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="space-y-1 text-xs">
                              <span>Intervalo (min)</span>
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                value={rascunho.intervaloMinutos}
                                onChange={(event) =>
                                  atualizarJornadaRascunho(item.funcionario_id, {
                                    intervaloMinutos: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                          {rascunho.detalhe.valido ? (
                            <p className="text-xs text-muted-foreground">
                              Normais: {rascunho.horasNormais.toFixed(2)}h · HE50:{" "}
                              {(rascunho.detalhe.minutosHe50 / 60).toFixed(2)}h · HE100:{" "}
                              {(rascunho.detalhe.minutosHe100 / 60).toFixed(2)}h · Noturnas:{" "}
                              {(rascunho.detalhe.minutosNoturnosRemuneraveis / 60).toFixed(2)}h
                            </p>
                          ) : (
                            <p className="text-xs text-destructive">{rascunho.detalhe.erro}</p>
                          )}
                          {exigeJustificativa && (
                            <label className="block space-y-1 text-xs">
                              <span>Justificativa de hora extra</span>
                              <Input
                                value={rascunho.justificativa ?? ""}
                                onChange={(event) =>
                                  atualizarJornadaRascunho(item.funcionario_id, {
                                    justificativa: event.target.value,
                                  })
                                }
                              />
                            </label>
                          )}
                          <label className="block space-y-1 text-xs">
                            <span>Observações</span>
                            <Input
                              value={rascunho.observacoes ?? ""}
                              onChange={(event) =>
                                atualizarJornadaRascunho(item.funcionario_id, {
                                  observacoes: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              clearDraft();
              resetForm();
            }}
          >
            Descartar rascunho
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          {previa && (
            <Button onClick={confirmar} disabled={carregando || selecionados === 0}>
              {carregando ? "Copiando..." : `Copiar ${selecionados} funcionários`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
