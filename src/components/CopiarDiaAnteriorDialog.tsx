import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { formatarDataCopia, logErroCopiaDia, type ResumoCopiaDia } from "@/lib/copiar-dia-anterior";
import { ALOCACAO_ACTION_BUTTON_CLASS } from "@/lib/alocacoes-runtime";
import { dataLocalHoje, validarDataLancamento } from "@/lib/data-lancamento";
import { calcularCompetencia } from "@/lib/competencias";
import { calcularJornadaDetalhada } from "@/lib/jornada-horas";
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
      const [resumoResult, origemResult, historicoResult, funcionariosResult] = await Promise.all([
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
          .select("funcionario_id, obra_id, data, especialidade_ajudante")
          .eq("obra_id", obraId)
          .eq("data", origem.data),
        supabase
          .from("alocacoes")
          .select("funcionario_id, obra_id, data, especialidade_ajudante")
          .eq("obra_id", obraId)
          .gte("data", competenciaDestino.data_inicio)
          .lt("data", destino)
          .not("especialidade_ajudante", "is", null),
        supabase.rpc("obras_control_funcionarios_safe"),
      ]);
      if (resumoResult.error) throw resumoResult.error;
      if (origemResult.error) throw origemResult.error;
      if (historicoResult.error) throw historicoResult.error;
      if (funcionariosResult.error) throw funcionariosResult.error;
      const resumo = resumoResult.data as unknown as ResumoCopiaDia;
      const categorias = new Map(
        (
          funcionariosResult.data as unknown as Array<{ id: string; categoria_mo: string | null }>
        ).map((funcionario) => [funcionario.id, funcionario.categoria_mo]),
      );
      const origens = new Map(
        (origemResult.data ?? []).map((alocacao) => [alocacao.funcionario_id, alocacao]),
      );
      setEscolhas({});
      setPrevia({
        ...resumo,
        itens: resumo.itens.map((item) => {
          const ajudante = categoriaEhAjudante(categorias.get(item.funcionario_id));
          const alocacaoOrigem = origens.get(item.funcionario_id);
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
      });
    } catch (error) {
      logErroCopiaDia("previa", error);
      toast.error((error as { message?: string }).message ?? "Erro ao preparar a cópia");
    } finally {
      setCarregando(false);
    }
  }

  async function confirmar() {
    if (!previa || confirmacaoEmAndamento.current) return;
    const pendentes = funcionariosAjudantesSemEspecialidade(previa.itens, escolhas);
    if (pendentes.length > 0) {
      toast.error(`Informe a atuação de: ${pendentes.map(({ nome }) => nome).join(", ")}.`);
      return;
    }
    confirmacaoEmAndamento.current = true;
    setCarregando(true);
    try {
      validarDataLancamento(previa.destino_data, "alocacao");
      const candidatos = previa.itens.filter(({ status }) => status === "adicionar");
      const ids = candidatos.map(({ funcionario_id }) => funcionario_id);
      const [
        alocacoesDestino,
        registrosDestino,
        alocacoesOrigem,
        registrosOrigem,
        funcionarios,
        feriadosResult,
      ] = await Promise.all([
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
        supabase
          .from("alocacoes")
          .select("funcionario_id,hora_entrada,hora_saida,intervalo_padrao_minutos")
          .eq("obra_id", obraId)
          .eq("data", previa.origem_data)
          .in("funcionario_id", ids),
        supabase
          .from("registros_horas")
          .select("funcionario_id,horas_normais,horas_extras,justificativa_extras,observacoes")
          .eq("obra_id", obraId)
          .eq("data", previa.origem_data)
          .eq("tipo_registro", "horas")
          .in("funcionario_id", ids),
        supabase.rpc("obras_control_funcionarios_safe"),
        supabase
          .from("feriados_obras_control" as never)
          .select("data" as never)
          .eq("ativo" as never, true),
      ]);
      for (const resultado of [
        alocacoesDestino,
        registrosDestino,
        alocacoesOrigem,
        registrosOrigem,
        funcionarios,
        feriadosResult,
      ])
        if (resultado.error) throw resultado.error;
      const ocupados = new Set([
        ...(alocacoesDestino.data ?? []).map(({ funcionario_id }) => funcionario_id),
        ...(registrosDestino.data ?? []).map(({ funcionario_id }) => funcionario_id),
      ]);
      const alvos = candidatos.filter(({ funcionario_id }) => !ocupados.has(funcionario_id));
      const origemPorFuncionario = new Map(
        (alocacoesOrigem.data ?? []).map((item) => [item.funcionario_id, item]),
      );
      const registroPorFuncionario = new Map(
        (registrosOrigem.data ?? []).map((item) => [item.funcionario_id, item]),
      );
      const categoriaPorFuncionario = new Map(
        (funcionarios.data as unknown as Array<{ id: string; categoria_mo: string | null }>).map(
          (item) => [item.id, item.categoria_mo],
        ),
      );
      const feriados = new Set(
        (feriadosResult.data as unknown as Array<{ data: string }>).map((item) => item.data),
      );
      const itens = alvos.map((item) => {
        const origem = origemPorFuncionario.get(item.funcionario_id);
        const registro = registroPorFuncionario.get(item.funcionario_id);
        const horaEntrada = origem?.hora_entrada?.slice(0, 5) ?? "07:00";
        const intervaloMinutos = origem?.intervalo_padrao_minutos ?? 60;
        const totalLegado =
          Number(registro?.horas_normais ?? 0) + Number(registro?.horas_extras ?? 0);
        const minutosSaida =
          (Number(horaEntrada.slice(0, 2)) * 60 +
            Number(horaEntrada.slice(3, 5)) +
            Math.round(totalLegado * 60) +
            intervaloMinutos) %
          1440;
        const horaSaida =
          origem?.hora_saida?.slice(0, 5) ??
          `${String(Math.floor(minutosSaida / 60)).padStart(2, "0")}:${String(minutosSaida % 60).padStart(2, "0")}`;
        const detalhe = calcularJornadaDetalhada({
          data: previa.destino_data,
          horaEntrada,
          horaSaida,
          intervaloMinutos,
          funcao: categoriaPorFuncionario.get(item.funcionario_id),
          feriados,
        });
        if (!detalhe.valido) throw new Error(`${item.nome}: ${detalhe.erro}`);
        if (detalhe.exigeJustificativa && !registro?.justificativa_extras?.trim())
          throw new Error(`${item.nome}: a jornada copiada exige justificativa.`);
        return {
          funcionarioId: item.funcionario_id,
          obraId,
          data: previa.destino_data,
          horaEntrada,
          horaSaida,
          intervaloMinutos,
          horasNormais: (detalhe.minutosNormais + detalhe.minutosSemAdicionalHe) / 60,
          horasExtras: (detalhe.minutosHe50 + detalhe.minutosHe100) / 60,
          justificativa: registro?.justificativa_extras ?? null,
          observacoes: registro?.observacoes ?? null,
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

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setPrevia(null);
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
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
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
                  Serão adicionados
                  <br />
                  <strong>{previa.total_adicionar}</strong>
                </div>
              </div>
              <ul className="max-h-64 divide-y overflow-y-auto rounded border">
                {previa.itens.map((item) => (
                  <li
                    key={item.funcionario_id}
                    className="flex items-center justify-between gap-3 p-2 text-sm"
                  >
                    <div>
                      <span>{item.nome}</span>
                      {item.status === "adicionar" && item.ajudante && (
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
                    <Badge variant={item.status === "adicionar" ? "default" : "secondary"}>
                      {item.status === "adicionar"
                        ? "Será adicionado"
                        : item.status === "inelegivel"
                          ? "Não será copiado — desligado/inelegível"
                          : "Já existe no destino"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          {previa && (
            <Button onClick={confirmar} disabled={carregando || previa.total_adicionar === 0}>
              {carregando ? "Copiando..." : `Copiar ${previa.total_adicionar} funcionários`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
