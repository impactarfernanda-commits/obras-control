import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatarDataCopia, logErroCopiaDia, type ResumoCopiaDia } from "@/lib/copiar-dia-anterior";
import { ALOCACAO_ACTION_BUTTON_CLASS } from "@/lib/alocacoes-runtime";
import { dataLocalHoje, validarDataLancamento } from "@/lib/data-lancamento";
import { calcularCompetencia } from "@/lib/competencias";
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
  const { user } = useAuth();
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
      const [alocacoesDestino, registrosDestino, registrosOrigem] = await Promise.all([
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
          .from("registros_horas")
          .select("funcionario_id, horas_normais")
          .eq("obra_id", obraId)
          .eq("data", previa.origem_data)
          .eq("tipo_registro", "horas")
          .in("funcionario_id", ids),
      ]);
      for (const resultado of [alocacoesDestino, registrosDestino, registrosOrigem])
        if (resultado.error) throw resultado.error;
      const ocupados = new Set([
        ...(alocacoesDestino.data ?? []).map(({ funcionario_id }) => funcionario_id),
        ...(registrosDestino.data ?? []).map(({ funcionario_id }) => funcionario_id),
      ]);
      const alvos = candidatos.filter(({ funcionario_id }) => !ocupados.has(funcionario_id));
      const idsInseridos = new Set<string>();
      if (alvos.length > 0) {
        const { data: inseridas, error: alocacaoErro } = await supabase
          .from("alocacoes")
          .upsert(
            alvos.map((item) => ({
              funcionario_id: item.funcionario_id,
              obra_id: obraId,
              data: previa.destino_data,
              created_by: user?.id ?? null,
              especialidade_ajudante: especialidadeNovaAlocacao({
                ajudante: item.ajudante,
                resolucao: item.resolucao,
                escolha: escolhas[item.funcionario_id],
              }),
            })),
            { onConflict: "funcionario_id,obra_id,data", ignoreDuplicates: true },
          )
          .select("funcionario_id");
        if (alocacaoErro) throw alocacaoErro;
        for (const { funcionario_id } of inseridas ?? []) idsInseridos.add(funcionario_id);
      }
      const horasOrigem = new Map(
        (registrosOrigem.data ?? []).map((registro) => [
          registro.funcionario_id,
          Number(registro.horas_normais),
        ]),
      );
      const linhasRegistro = alvos
        .filter(({ funcionario_id }) => idsInseridos.has(funcionario_id))
        .map((item) => ({
          funcionario_id: item.funcionario_id,
          obra_id: obraId,
          data: previa.destino_data,
          horas_normais:
            horasOrigem.get(item.funcionario_id) ??
            (new Date(`${previa.destino_data}T00:00:00`).getDay() === 5 ? 8 : 9),
          horas_extras: 0,
          ausencia: false,
          tipo_registro: "horas" as const,
          falta_tipo: null,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        }));
      if (linhasRegistro.length > 0) {
        const { error: registroErro } = await supabase
          .from("registros_horas")
          .insert(linhasRegistro);
        if (registroErro) throw registroErro;
      }
      const totalCopiados = idsInseridos.size;
      if (totalCopiados === 0)
        toast.info("Nenhum funcionário para copiar. A equipe do dia já está atualizada.");
      else
        toast.success(
          `${totalCopiados} funcionários copiados de ${formatarDataCopia(previa.origem_data)} para ${formatarDataCopia(previa.destino_data)}.`,
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
