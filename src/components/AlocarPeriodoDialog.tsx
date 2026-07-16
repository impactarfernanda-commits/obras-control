import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  buscarConflitosAlocacao,
  erroBancoAlocacao,
  isAlocacaoConflitoError,
  mensagemErroBancoAlocacao,
  TITULO_CONFLITO_ALOCACAO,
  type AlocacaoConflito,
  type MensagemAlocacaoConflito,
} from "@/lib/alocacoes-conflitos";
import {
  buscarCompetenciasFechadasPorDatas,
  calcularCompetencia,
  formatarPeriodoCompetencia,
  mensagemErroCompetenciaFechada,
  type FechamentoCompetencia,
} from "@/lib/competencias";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function diaDaSemana(iso: string) {
  return new Date(iso + "T00:00:00").getDay();
}

/** Lista dias úteis (seg–sex) inclusive de inicio até fim. */
function enumerarDiasUteis(inicio: string, fim: string): string[] {
  const out: string[] = [];
  const start = new Date(inicio + "T00:00:00");
  const end = new Date(fim + "T00:00:00");
  if (end < start) return out;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) out.push(isoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function horasPadrao(iso: string): number {
  const dow = diaDaSemana(iso);
  if (dow === 5) return 8;
  return 9; // seg-qui
}

const MAX_DIAS_INTERVALO = 92;

type PostgrestErrorLike = { message?: string };

type RegistroPeriodoConflito = {
  data: string;
  horas_normais: number | string | null;
  horas_extras: number | string | null;
  ausencia: boolean | null;
};

type Props = {
  obraId: string;
  obraNome: string;
};

export function AlocarPeriodoDialog({ obraId, obraNome }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const today = isoDate(new Date());
  const [funcionarioId, setFuncionarioId] = useState<string>("");
  const [dataInicio, setDataInicio] = useState<string>(today);
  const [dataFim, setDataFim] = useState<string>(today);
  const [step, setStep] = useState<"form" | "conflitos">("form");
  const [conflitosAloc, setConflitosAloc] = useState<Set<string>>(new Set());
  const [conflitosReg, setConflitosReg] = useState<Set<string>>(new Set());
  const [conflitosOutraObra, setConflitosOutraObra] = useState<AlocacaoConflito[]>([]);
  const [competenciasFechadas, setCompetenciasFechadas] = useState<FechamentoCompetencia[]>([]);
  const [dialogFeedback, setDialogFeedback] = useState<MensagemAlocacaoConflito | null>(null);
  const [modo, setModo] = useState<"pular" | "sobrescrever">("pular");
  const [verificando, setVerificando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const { data: funcionariosAtivos } = useQuery({
    queryKey: ["funcionarios-min-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios_safe" as unknown as "funcionarios")
        .select("id,nome,ativo,data_desligamento,deleted_at")
        .order("nome");
      if (error) throw error;
      const arr = data as unknown as Array<{
        id: string;
        nome: string;
        ativo: boolean;
        data_desligamento: string | null;
        deleted_at: string | null;
      }>;
      return arr
        .filter((f) => !f.deleted_at)
        .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));
    },
  });
  const funcSelecionado = useMemo(
    () => (funcionariosAtivos ?? []).find((f) => f.id === funcionarioId) ?? null,
    [funcionariosAtivos, funcionarioId],
  );

  const dias = useMemo(() => {
    const all = enumerarDiasUteis(dataInicio, dataFim);
    const limite =
      funcSelecionado && !funcSelecionado.ativo ? funcSelecionado.data_desligamento : null;
    return limite ? all.filter((d) => d <= limite) : all;
  }, [dataInicio, dataFim, funcSelecionado]);
  const diasExcluidosPorDesligamento = useMemo(() => {
    if (!funcSelecionado || funcSelecionado.ativo || !funcSelecionado.data_desligamento) return 0;
    return enumerarDiasUteis(dataInicio, dataFim).filter(
      (d) => d > funcSelecionado.data_desligamento!,
    ).length;
  }, [dataInicio, dataFim, funcSelecionado]);
  const totalDiasIntervalo = useMemo(() => {
    if (!dataInicio || !dataFim) return 0;
    const s = new Date(dataInicio + "T00:00:00");
    const e = new Date(dataFim + "T00:00:00");
    if (e < s) return 0;
    return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  }, [dataInicio, dataFim]);
  const intervaloMuitoGrande = totalDiasIntervalo > MAX_DIAS_INTERVALO;
  const intervaloInvalido = !dataInicio || !dataFim || new Date(dataFim) < new Date(dataInicio);

  function resetAndClose(state: boolean) {
    setOpen(state);
    if (!state) {
      setStep("form");
      setConflitosAloc(new Set());
      setConflitosReg(new Set());
      setConflitosOutraObra([]);
      setCompetenciasFechadas([]);
      setDialogFeedback(null);
      setFuncionarioId("");
      setDataInicio(today);
      setDataFim(today);
      setModo("pular");
    }
  }

  async function verificar() {
    if (!funcionarioId) {
      toast.error("Selecione um funcionário");
      return;
    }
    if (dias.length === 0) {
      toast.error("O intervalo não contém dias úteis (seg–sex)");
      return;
    }
    setDialogFeedback(null);
    setVerificando(true);
    try {
      const [alocRes, regRes, conflitosObraDiferente, fechadas] = await Promise.all([
        supabase
          .from("alocacoes")
          .select("data")
          .eq("funcionario_id", funcionarioId)
          .eq("obra_id", obraId)
          .in("data", dias),
        supabase
          .from("registros_horas")
          .select("data, horas_normais, horas_extras, ausencia")
          .eq("funcionario_id", funcionarioId)
          .eq("obra_id", obraId)
          .in("data", dias),
        buscarConflitosAlocacao({
          supabase,
          funcionarioId,
          obraId,
          datas: dias,
        }),
        buscarCompetenciasFechadasPorDatas(supabase, dias),
      ]);
      if (alocRes.error) throw alocRes.error;
      if (regRes.error) throw regRes.error;
      const setA = new Set<string>((alocRes.data ?? []).map((r) => r.data));
      const setR = new Set<string>(
        ((regRes.data ?? []) as RegistroPeriodoConflito[])
          .filter((r) => r.ausencia || Number(r.horas_normais) > 0 || Number(r.horas_extras) > 0)
          .map((r) => r.data),
      );
      setConflitosAloc(setA);
      setConflitosReg(setR);
      setConflitosOutraObra(conflitosObraDiferente);
      setCompetenciasFechadas(fechadas);
      if (conflitosObraDiferente.length > 0) {
        const resumo = conflitosObraDiferente
          .slice(0, 3)
          .map(
            (c) => new Date(c.data + "T00:00:00").toLocaleDateString("pt-BR") + " - " + c.obraNome,
          )
          .join("; ");
        toast.warning(TITULO_CONFLITO_ALOCACAO, {
          description:
            "Algumas datas não foram alocadas porque o funcionário já possui alocação em outra obra." +
            (resumo
              ? " Conflitos: " + resumo + (conflitosObraDiferente.length > 3 ? "; ..." : "")
              : ""),
        });
      }
      if (
        setA.size === 0 &&
        setR.size === 0 &&
        conflitosObraDiferente.length === 0 &&
        fechadas.length === 0
      ) {
        await salvar("pular", setA, setR, conflitosObraDiferente, fechadas);
      } else {
        setStep("conflitos");
      }
    } catch (e: unknown) {
      toast.error((e as PostgrestErrorLike)?.message ?? "Erro ao verificar conflitos");
    } finally {
      setVerificando(false);
    }
  }

  async function salvar(
    modoAtual: "pular" | "sobrescrever",
    setA: Set<string>,
    setR: Set<string>,
    conflitosExternos = conflitosOutraObra,
    fechadas = competenciasFechadas,
  ) {
    setSalvando(true);
    try {
      const competenciasBloqueadas = new Set(fechadas.map((c) => c.competencia));
      const datasBloqueadasCompetencia = new Set(
        dias.filter((d) => competenciasBloqueadas.has(calcularCompetencia(d).competencia)),
      );
      const datasBloqueadasOutraObra = new Set(conflitosExternos.map((c) => c.data));
      const diasAlvo =
        modoAtual === "sobrescrever"
          ? dias.filter(
              (d) => !datasBloqueadasCompetencia.has(d) && !datasBloqueadasOutraObra.has(d),
            )
          : dias.filter(
              (d) =>
                !datasBloqueadasCompetencia.has(d) &&
                !datasBloqueadasOutraObra.has(d) &&
                !setA.has(d) &&
                !setR.has(d),
            );

      if (diasAlvo.length === 0) {
        toast.info("Nada a alocar — todos os dias já estavam ocupados.");
        setSalvando(false);
        resetAndClose(false);
        return;
      }

      const alocRows = diasAlvo.map((d) => ({
        funcionario_id: funcionarioId,
        obra_id: obraId,
        data: d,
        created_by: user?.id ?? null,
      }));
      const { error: alocErr } = await supabase.from("alocacoes").upsert(alocRows, {
        onConflict: "funcionario_id,obra_id,data",
        ignoreDuplicates: true,
      });
      if (alocErr) {
        const erroAmigavel = erroBancoAlocacao(alocErr);
        if (erroAmigavel) throw erroAmigavel;
        throw new Error(
          mensagemErroCompetenciaFechada(alocErr) ??
            mensagemErroBancoAlocacao(alocErr) ??
            alocErr.message,
        );
      }

      const regRows = diasAlvo.map((d) => ({
        funcionario_id: funcionarioId,
        obra_id: obraId,
        data: d,
        horas_normais: horasPadrao(d),
        horas_extras: 0,
        justificativa_extras: null,
        ausencia: false,
        motivo_ausencia: null,
        observacoes: null,
        created_by: user?.id ?? null,
        updated_by: user?.id ?? null,
      }));
      const { error: regErr } = await supabase
        .from("registros_horas")
        .upsert(regRows, { onConflict: "funcionario_id,obra_id,data" });
      if (regErr) throw new Error(mensagemErroCompetenciaFechada(regErr) ?? regErr.message);

      const pulados = dias.length - diasAlvo.length;
      toast.success(
        `${diasAlvo.length} ${diasAlvo.length === 1 ? "dia alocado" : "dias alocados"}` +
          (pulados > 0 ? `, ${pulados} ${pulados === 1 ? "pulado" : "pulados"}` : ""),
      );
      qc.invalidateQueries({ queryKey: ["alocacoes-mes"] });
      qc.invalidateQueries({ queryKey: ["registros-mes"] });
      qc.invalidateQueries({ queryKey: ["aloc-week", obraId] });
      qc.invalidateQueries({ queryKey: ["registros-week", obraId] });
      resetAndClose(false);
    } catch (e: unknown) {
      if (isAlocacaoConflitoError(e)) {
        setDialogFeedback({ title: e.title, description: e.description });
        toast.error(e.title, { description: e.description, duration: 10000 });
      } else {
        toast.error((e as PostgrestErrorLike)?.message ?? "Erro ao alocar período");
      }
    } finally {
      setSalvando(false);
    }
  }

  const conflitosOutraObraPorData = useMemo(() => {
    const m = new Map<string, AlocacaoConflito>();
    for (const c of conflitosOutraObra) if (!m.has(c.data)) m.set(c.data, c);
    return m;
  }, [conflitosOutraObra]);

  const competenciasFechadasSet = useMemo(
    () => new Set(competenciasFechadas.map((c) => c.competencia)),
    [competenciasFechadas],
  );

  const datasCompetenciaFechada = useMemo(
    () => dias.filter((d) => competenciasFechadasSet.has(calcularCompetencia(d).competencia)),
    [dias, competenciasFechadasSet],
  );

  const conflitosUniao = useMemo(() => {
    const s = new Set<string>([
      ...conflitosAloc,
      ...conflitosReg,
      ...conflitosOutraObra.map((c) => c.data),
      ...datasCompetenciaFechada,
    ]);
    return Array.from(s).sort();
  }, [conflitosAloc, conflitosReg, conflitosOutraObra, datasCompetenciaFechada]);

  const diasDisponiveisParaPular = useMemo(
    () =>
      dias.filter(
        (d) =>
          !competenciasFechadasSet.has(calcularCompetencia(d).competencia) &&
          !conflitosOutraObraPorData.has(d) &&
          !conflitosAloc.has(d) &&
          !conflitosReg.has(d),
      ).length,
    [dias, competenciasFechadasSet, conflitosOutraObraPorData, conflitosAloc, conflitosReg],
  );
  const diasDisponiveisParaSobrescrever = useMemo(
    () =>
      dias.filter(
        (d) =>
          !competenciasFechadasSet.has(calcularCompetencia(d).competencia) &&
          !conflitosOutraObraPorData.has(d),
      ).length,
    [dias, competenciasFechadasSet, conflitosOutraObraPorData],
  );

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarRange className="mr-2 h-4 w-4" />
          Alocar período
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alocar período em {obraNome}</DialogTitle>
          <DialogDescription>
            Cria alocações para todos os dias úteis (seg–sex) do intervalo e lança horas padrão (9h
            seg–qui, 8h sex).
          </DialogDescription>
        </DialogHeader>

        {dialogFeedback && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>{dialogFeedback.title}</AlertTitle>
            <AlertDescription>{dialogFeedback.description}</AlertDescription>
          </Alert>
        )}

        {step === "form" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Funcionário</Label>
              <Select value={funcionarioId} onValueChange={setFuncionarioId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(funcionariosAtivos ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                      {!f.ativo ? " (inativo)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data inicial</Label>
                <Input
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Data final</Label>
                <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              {intervaloInvalido ? (
                <span className="text-rose-600">
                  Data final deve ser igual ou posterior à inicial.
                </span>
              ) : intervaloMuitoGrande ? (
                <span className="text-rose-600">
                  Intervalo muito grande ({totalDiasIntervalo} dias). Máximo permitido:{" "}
                  {MAX_DIAS_INTERVALO} dias.
                </span>
              ) : (
                <>
                  <strong>{dias.length}</strong> {dias.length === 1 ? "dia útil" : "dias úteis"} no
                  intervalo (fins de semana ignorados).
                  {funcSelecionado &&
                    !funcSelecionado.ativo &&
                    funcSelecionado.data_desligamento && (
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Funcionário inativo — desligado em{" "}
                        {new Date(
                          funcSelecionado.data_desligamento + "T00:00:00",
                        ).toLocaleDateString("pt-BR")}
                        .
                        {diasExcluidosPorDesligamento > 0 && (
                          <>
                            {" "}
                            {diasExcluidosPorDesligamento}{" "}
                            {diasExcluidosPorDesligamento === 1 ? "dia foi" : "dias foram"}{" "}
                            excluídos do intervalo (posteriores ao desligamento).
                          </>
                        )}
                      </div>
                    )}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => resetAndClose(false)}>
                Cancelar
              </Button>
              <Button
                onClick={verificar}
                disabled={
                  verificando ||
                  salvando ||
                  intervaloInvalido ||
                  intervaloMuitoGrande ||
                  dias.length === 0 ||
                  !funcionarioId
                }
              >
                {(verificando || salvando) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verificar e alocar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <div className="font-medium">Conflitos encontrados</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {conflitosUniao.length}{" "}
                {conflitosUniao.length === 1 ? "dia possui" : "dias possuem"} alocação ou horas
                lançadas para este funcionário. Dias em outra obra ou competência fechada serão
                sempre pulados.
              </div>
              <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs">
                {conflitosUniao.map((d) => (
                  <li key={d} className="flex items-center justify-between gap-2">
                    <span>
                      {new Date(d + "T00:00:00").toLocaleDateString("pt-BR", {
                        weekday: "short",
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                    <span className="text-muted-foreground">
                      {competenciasFechadasSet.has(calcularCompetencia(d).competencia)
                        ? `competência fechada: ${calcularCompetencia(d).competencia}`
                        : conflitosOutraObraPorData.has(d)
                          ? `outra obra: ${conflitosOutraObraPorData.get(d)?.obraNome}`
                          : conflitosReg.has(d)
                            ? "horas lançadas nesta obra"
                            : "alocado nesta obra"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Label>Como proceder?</Label>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-accent">
                  <input
                    type="radio"
                    className="mt-0.5"
                    checked={modo === "pular"}
                    onChange={() => setModo("pular")}
                  />
                  <div>
                    <div className="font-medium">Pular dias com conflito</div>
                    <div className="text-xs text-muted-foreground">
                      Aloca apenas os {diasDisponiveisParaPular} dias livres. Mantém o que já
                      estava.
                    </div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-accent">
                  <input
                    type="radio"
                    className="mt-0.5"
                    checked={modo === "sobrescrever"}
                    onChange={() => setModo("sobrescrever")}
                  />
                  <div>
                    <div className="font-medium">Sobrescrever</div>
                    <div className="text-xs text-muted-foreground">
                      Substitui horas existentes desta obra pelas horas padrão. Dias em competência
                      fechada ou outra obra serão pulados ({diasDisponiveisParaSobrescrever}{" "}
                      possíveis).
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("form")}>
                Voltar
              </Button>
              <Button
                onClick={async () => {
                  if (modo === "sobrescrever" && conflitosReg.size > 0) {
                    const ok = window.confirm(
                      `Sobrescrever apagará horas/ausências já lançadas em ${conflitosReg.size} dia(s). Continuar?`,
                    );
                    if (!ok) return;
                  }
                  await salvar(modo, conflitosAloc, conflitosReg);
                }}
                disabled={
                  salvando ||
                  (modo === "pular"
                    ? diasDisponiveisParaPular === 0
                    : diasDisponiveisParaSobrescrever === 0)
                }
              >
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
