import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, RotateCcw, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  formatarDataCopia,
  itensSelecionadosCopia,
  logErroCopiaDia,
  totalNaoCopiar,
  totalSelecionadosCopia,
  type JornadaCopiaRascunho,
  type ResumoCopiaDia,
} from "@/lib/copiar-dia-anterior";
import { ALOCACAO_ACTION_BUTTON_CLASS } from "@/lib/alocacoes-runtime";
import { dataLocalHoje, validarDataLancamento } from "@/lib/data-lancamento";
import { calcularCompetencia } from "@/lib/competencias";
import { calcularJornadaDetalhada } from "@/lib/jornada-horas";
import { exigeJustificativaExtras, justificativaExtrasValida } from "@/lib/extras-justificativa";
import { categoriaEhAjudante, type EspecialidadeAjudante } from "@/lib/especialidade-ajudante";
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

export function CopiarDiaAnteriorDialog({
  obraId,
  obraNome,
}: {
  obraId: string;
  obraNome: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const hoje = dataLocalHoje();
  const [destino, setDestino] = useState(hoje);
  const [previa, setPrevia] = useState<ResumoCopiaResolvido | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, JornadaCopiaRascunho>>({});
  const [funcoes, setFuncoes] = useState<Record<string, string | null>>({});
  const [feriados, setFeriados] = useState<Set<string>>(new Set());
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, EspecialidadeAjudante>>({});
  const [carregando, setCarregando] = useState(false);
  const confirmacaoEmAndamento = useRef(false);

  async function buscarPrevia() {
    setCarregando(true);
    setPrevia(null);
    try {
      validarDataLancamento(destino, "alocacao");
      const { data: origem, error: origemErro } = await supabase
        .from("alocacoes")
        .select("data")
        .eq("obra_id", obraId)
        .lt("data", destino)
        .order("data", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (origemErro) throw origemErro;
      if (!origem) {
        toast.info("Não há alocações anteriores desta obra para copiar.");
        return;
      }
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
            p_data_origem: origem.data,
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
          .eq("data", origem.data),
        supabase
          .from("registros_horas")
          .select("funcionario_id,horas_normais,horas_extras,justificativa_extras,observacoes")
          .eq("obra_id", obraId)
          .eq("data", origem.data)
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
        itens: resumo.itens.map((item) => {
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
      setPrevia(null);
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
        if (!value) {
          setPrevia(null);
          setRascunhos({});
          setEscolhas({});
          setEditandoId(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={ALOCACAO_ACTION_BUTTON_CLASS}>
          <Copy className="mr-2 h-4 w-4" />
          Copiar dia anterior
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Copiar dia anterior</DialogTitle>
          <DialogDescription>{obraNome}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Data destino</label>
            <Input
              type="date"
              max={hoje}
              value={destino}
              onChange={(e) => {
                setDestino(e.target.value);
                setPrevia(null);
                setRascunhos({});
                setEditandoId(null);
              }}
            />
          </div>
          {!previa ? (
            <Button onClick={buscarPrevia} disabled={!destino || carregando}>
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
