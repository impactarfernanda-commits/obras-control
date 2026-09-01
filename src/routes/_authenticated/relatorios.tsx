import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

import { supabase } from "@/integrations/supabase/client";
import { dataLocalISO, datasUteisNoIntervalo, diaUtilAnterior } from "@/lib/relatorio-sem-alocacao";
import { useCategorias } from "@/lib/categorias";
import { tipoCategoria } from "@/lib/categorias-core";
import { fmtBRL, useBeneficios, useSegurosVida } from "@/lib/custos";
import { calcularCusto, diasUteisNoIntervalo } from "@/lib/custos-core";
import { buscarTodasPaginas } from "@/lib/paginacao";
import {
  calcularCustoHorasExtras,
  classificarHorasPorData,
  formatarHorasDecimais,
  type CustoHoraExtra,
} from "@/lib/horas-extras";
import { exportCostCenterXlsx } from "@/lib/relatorio-centro-custo-xlsx";
import { rotuloFalta, rotuloTipoRegistro } from "@/lib/registro-falta";
import { RequireRole } from "@/components/RouteAccess";
import { useAuth } from "@/hooks/use-auth";
import { getRelatorioCentrosCusto } from "@/lib/relatorio-centro-custo.functions";
import { getRelatorioSemAlocacao } from "@/lib/relatorio-sem-alocacao.functions";
import {
  SUPERVISOR_CC_DATA_CORTE,
  SUPERVISOR_CC_VIGENCIAS_ATIVAS,
  categoriaEhSupervisor,
} from "@/lib/supervisor-cc";
import type { DetalheJornadaVisual } from "@/lib/horas-visualizacao";

export const Route = createFileRoute("/_authenticated/relatorios")({
  component: () => (
    <RequireRole allowed={["assistente", "supervisor", "coordenador", "gerente", "diretor"]}>
      <RelatoriosPage />
    </RequireRole>
  ),
});

type FuncRow = {
  id: string;
  nome: string;
  categoria_mo: string;
  ativo: boolean;
  salario: number | null;
  data_admissao: string | null;
  data_desligamento: string | null;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
};
type TipoMaoObra = "montagem" | "civil" | "indireta" | null;
type AlocRow = {
  funcionario_id: string;
  obra_id: string;
  data: string;
  tipo_mao_obra: TipoMaoObra;
  hora_entrada: string | null;
  hora_saida: string | null;
};
type RegRow = {
  id: string;
  funcionario_id: string;
  obra_id: string;
  data: string;
  horas_normais: number;
  horas_extras: number;
  ausencia: boolean;
  tipo_registro: "horas" | "falta" | "ferias" | "folga_campo";
  falta_tipo: string | null;
  observacoes: string | null;
};
type ObraRow = { id: string; nome: string };

function payrollRange(year: number, month: number) {
  // Folha: dia 25 do mês anterior até dia 24 do mês selecionado
  const start = new Date(year, month - 1, 25);
  const end = new Date(year, month, 24);
  return { start: dataLocalISO(start), end: dataLocalISO(end), startDate: start, endDate: end };
}

function RelatoriosPage() {
  const { role } = useAuth();
  const podeVerFolha = role === "gerente" || role === "diretor";
  const podeVerCentroCusto = role === "coordenador" || podeVerFolha;
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [pendenciaFilter, setPendenciaFilter] = useState<
    "all" | "ativos" | "admitidos" | "desligados"
  >("all");
  const [categoriaFilter, setCategoriaFilter] = useState("all");
  const [coberturaFilter, setCoberturaFilter] = useState<"all" | "zero" | "parcial">("all");
  const [ultimoCcFilter, setUltimoCcFilter] = useState("all");
  const [funcionarioDetalheId, setFuncionarioDetalheId] = useState<string | null>(null);
  const [centroDetalheId, setCentroDetalheId] = useState<string | null>(null);
  const [exportandoCentro, setExportandoCentro] = useState(false);

  const { data: beneficios } = useBeneficios({ enabled: podeVerFolha });
  const { data: segurosVida } = useSegurosVida({ enabled: podeVerFolha });
  const { data: categorias } = useCategorias({ enabled: podeVerFolha });

  const { data: funcionarios, isLoading: lf } = useQuery({
    queryKey: ["funcionarios-relatorios"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obras_control_funcionarios_safe");
      if (error) throw error;
      return (data ?? []) satisfies FuncRow[];
    },
    enabled: podeVerFolha,
  });

  const { data: obras } = useQuery({
    queryKey: ["obras"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obras").select("id,nome").order("nome");
      if (error) throw error;
      return (data ?? []) as ObraRow[];
    },
    enabled: podeVerFolha,
  });

  const { start, end, startDate, endDate } = payrollRange(year, month);
  const ontem = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const ontemISO = dataLocalISO(ontem);
  const dataLimiteAnalise = end < ontemISO ? end : ontemISO;
  const competenciaSemDiasVencidos = dataLimiteAnalise < start;

  const { data: alocacoes, isLoading: la } = useQuery({
    queryKey: ["alocacoes-mes", start, end],
    queryFn: async () =>
      buscarTodasPaginas<AlocRow>((from, to) =>
        supabase
          .from("alocacoes")
          .select("funcionario_id,obra_id,data,tipo_mao_obra,hora_entrada,hora_saida" as never)
          .gte("data", start)
          .lte("data", end)
          .order("data", { ascending: true })
          .order("funcionario_id", { ascending: true })
          .order("obra_id", { ascending: true })
          .range(from, to),
      ),
    enabled: podeVerFolha,
  });

  const { data: registros, isLoading: lr } = useQuery({
    queryKey: ["registros-mes", start, end],
    queryFn: async () =>
      buscarTodasPaginas<RegRow>((from, to) =>
        supabase
          .from("registros_horas")
          .select(
            "id,funcionario_id,obra_id,data,horas_normais,horas_extras,ausencia,tipo_registro,falta_tipo,observacoes",
          )
          .gte("data", start)
          .lte("data", end)
          .order("data", { ascending: true })
          .order("funcionario_id", { ascending: true })
          .order("obra_id", { ascending: true })
          .range(from, to),
      ),
    enabled: podeVerFolha,
  });

  const { data: detalhes } = useQuery({
    queryKey: ["registros-horas-detalhes-relatorio", start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registros_horas_detalhes" as never)
        .select(
          "registro_horas_id,minutos_normais,minutos_he_50,minutos_he_100,minutos_sem_adicional_he,minutos_noturnos_reais,minutos_noturnos_remuneraveis,jornada_excepcional" as never,
        )
        .gte("data_inicio" as never, start)
        .lte("data_inicio" as never, end);
      if (error) throw error;
      return data as unknown as Array<DetalheJornadaVisual & { registro_horas_id: string }>;
    },
    enabled: podeVerFolha,
  });
  const detalhePorRegistro = useMemo(
    () => new Map((detalhes ?? []).map((detalhe) => [detalhe.registro_horas_id, detalhe])),
    [detalhes],
  );

  const competencia = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const { data: relatorioSemAlocacao, isLoading: loadingSemAlocacao } = useQuery({
    queryKey: ["relatorio-sem-alocacao", start, end, dataLimiteAnalise],
    queryFn: () =>
      getRelatorioSemAlocacao({
        data: { inicio: start, fim: end, referencia: dataLimiteAnalise },
      }),
    enabled: !competenciaSemDiasVencidos,
  });
  const { data: relatorioCentros, isLoading: loadingCentros } = useQuery({
    queryKey: ["relatorio-centros-custo", competencia],
    queryFn: () => getRelatorioCentrosCusto({ data: { competencia } }),
    enabled: podeVerCentroCusto,
  });

  // Exclusao logica identifica cadastro incorreto. Inatividade/desligamento e historico valido.
  // O filtro local protege todos os calculos e exportacoes mesmo se a origem deixar de filtrar.
  const funcionariosRelatorio = useMemo(
    () =>
      (funcionarios ?? []).filter((f) => f.deleted_at == null && f.visivel_obras_control !== false),
    [funcionarios],
  );
  const funcionariosSemAlocacao = useMemo(
    () =>
      (relatorioSemAlocacao?.funcionarios ?? []).filter(
        (f) => f.deleted_at == null && f.visivel_obras_control !== false,
      ),
    [relatorioSemAlocacao],
  );
  const alocacoesSemAlocacao = useMemo(
    () => relatorioSemAlocacao?.alocacoes ?? [],
    [relatorioSemAlocacao],
  );
  const ultimaAlocacaoPorFuncionario = useMemo(
    () =>
      new Map(
        (relatorioSemAlocacao?.ultimasAlocacoes ?? []).map((alocacao) => [
          alocacao.funcionario_id,
          alocacao,
        ]),
      ),
    [relatorioSemAlocacao],
  );
  const ultimosCentrosSemAlocacao = useMemo(() => {
    const centros = new Map<string, string>();
    for (const alocacao of relatorioSemAlocacao?.ultimasAlocacoes ?? [])
      centros.set(alocacao.obra_id, alocacao.obra_nome);
    return [...centros].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [relatorioSemAlocacao]);

  const custoPorFunc = useMemo(() => {
    const m = new Map<string, ReturnType<typeof calcularCusto>>();
    for (const f of funcionariosRelatorio) {
      m.set(
        f.id,
        calcularCusto(f.salario, beneficios ?? null, segurosVida?.get(f.categoria_mo) ?? 0),
      );
    }
    return m;
  }, [funcionariosRelatorio, beneficios, segurosVida]);

  const diasUteis = useMemo(() => diasUteisNoIntervalo(startDate, endDate), [startDate, endDate]);

  const horasExtrasPorFunc = useMemo(() => {
    const registrosPorFunc = new Map<string, RegRow[]>();
    for (const registro of registros ?? []) {
      const lista = registrosPorFunc.get(registro.funcionario_id) ?? [];
      lista.push(registro);
      registrosPorFunc.set(registro.funcionario_id, lista);
    }

    const resultado = new Map<string, CustoHoraExtra>();
    for (const funcionario of funcionariosRelatorio) {
      const custo = custoPorFunc.get(funcionario.id);
      if (!custo) continue;
      resultado.set(
        funcionario.id,
        calcularCustoHorasExtras(
          custo,
          (registrosPorFunc.get(funcionario.id) ?? []).map((registro) => ({
            data: registro.data,
            horasExtras: (() => {
              const detalhe = detalhePorRegistro.get(registro.id);
              if (detalhe) return (detalhe.minutos_he_50 + detalhe.minutos_he_100) / 60;
              const apuracao = classificarHorasPorData({
                data: registro.data,
                horasNormais: registro.horas_normais,
                horasExtras: registro.horas_extras,
              });
              return apuracao.horasExtra50Apuradas + apuracao.horasExtra100Apuradas;
            })(),
          })),
        ),
      );
    }
    return resultado;
  }, [custoPorFunc, detalhePorRegistro, funcionariosRelatorio, registros]);

  const obrasComCusto = useMemo(() => relatorioCentros?.centros ?? [], [relatorioCentros]);
  const segmentarMod = relatorioCentros?.segmentarMod ?? false;
  const avisosObras = useMemo(() => relatorioCentros?.avisos ?? [], [relatorioCentros]);
  const centroDetalhe = obrasComCusto.find((obra) => obra.id === centroDetalheId) ?? null;

  const totaisObra = useMemo(
    () =>
      obrasComCusto.reduce(
        (acc, o) => ({
          mod: acc.mod + o.mod,
          modCivil: acc.modCivil + o.modCivil,
          modMontagem: acc.modMontagem + o.modMontagem,
          modAClassificar: acc.modAClassificar + o.modAClassificar,
          moi: acc.moi + o.moi,
          total: acc.total + o.total,
        }),
        { mod: 0, modCivil: 0, modMontagem: 0, modAClassificar: 0, moi: 0, total: 0 },
      ),
    [obrasComCusto],
  );

  const funcIdsComLancamento = useMemo(() => {
    const s = new Set<string>();
    for (const a of alocacoes ?? []) s.add(a.funcionario_id);
    for (const r of registros ?? []) s.add(r.funcionario_id);
    return s;
  }, [alocacoes, registros]);

  const semAlocacao = useMemo(() => {
    if (competenciaSemDiasVencidos) return [];
    const alocacoesPorFuncionario = new Map<string, Set<string>>();
    for (const alocacao of alocacoesSemAlocacao) {
      const datas = alocacoesPorFuncionario.get(alocacao.funcionario_id) ?? new Set<string>();
      datas.add(alocacao.data);
      alocacoesPorFuncionario.set(alocacao.funcionario_id, datas);
    }
    return funcionariosSemAlocacao
      .filter((f) => {
        if (f.data_admissao && f.data_admissao > dataLimiteAnalise) return false;
        return true;
      })
      .map((f) => {
        const ultimaAlocacao = ultimaAlocacaoPorFuncionario.get(f.id) ?? null;
        const inicio = f.data_admissao && f.data_admissao > start ? f.data_admissao : start;
        const fimAnteriorAoDesligamento = f.data_desligamento
          ? diaUtilAnterior(f.data_desligamento)
          : dataLimiteAnalise;
        const fim =
          fimAnteriorAoDesligamento < dataLimiteAnalise
            ? fimAnteriorAoDesligamento
            : dataLimiteAnalise;
        const diasDisponiveis = datasUteisNoIntervalo(inicio, fim);
        const datasAlocadas = alocacoesPorFuncionario.get(f.id) ?? new Set<string>();
        const vigenciasSupervisor =
          SUPERVISOR_CC_VIGENCIAS_ATIVAS && categoriaEhSupervisor(f.categoria_mo)
            ? (relatorioSemAlocacao?.vigenciasCentroCusto ?? []).filter(
                (vigencia) => vigencia.funcionario_id === f.id,
              )
            : [];
        const coberto = (data: string) =>
          datasAlocadas.has(data) ||
          (SUPERVISOR_CC_VIGENCIAS_ATIVAS &&
            data >= SUPERVISOR_CC_DATA_CORTE &&
            vigenciasSupervisor.some(
              (vigencia) =>
                vigencia.vigencia_inicio <= data &&
                (!vigencia.vigencia_fim || vigencia.vigencia_fim >= data),
            ));
        const diasComAlocacao = diasDisponiveis.filter(coberto);
        const diasSemAlocacao = diasDisponiveis.filter((data) => !coberto(data));
        const admitidoNoPeriodo = Boolean(
          f.data_admissao && f.data_admissao >= start && f.data_admissao <= end,
        );
        const desligadoNoPeriodo = Boolean(
          f.data_desligamento && f.data_desligamento >= start && f.data_desligamento <= end,
        );
        const observacoes = [
          SUPERVISOR_CC_VIGENCIAS_ATIVAS &&
          categoriaEhSupervisor(f.categoria_mo) &&
          diasSemAlocacao.some((data) => data >= SUPERVISOR_CC_DATA_CORTE)
            ? "Supervisor com ausência ou lacuna de vigência de centro de custo."
            : diasComAlocacao.length === 0
              ? "Sem nenhuma alocação registrada na competência."
              : "Possui alocação parcial. Existem dias úteis sem lançamento.",
        ];
        if (admitidoNoPeriodo)
          observacoes.push(
            `Admitido em ${new Date(f.data_admissao! + "T00:00:00").toLocaleDateString("pt-BR")}. Verificar alocações a partir da admissão.`,
          );
        if (desligadoNoPeriodo)
          observacoes.push(
            `Desligado em ${new Date(f.data_desligamento! + "T00:00:00").toLocaleDateString("pt-BR")}. Verificar alocações até o dia útil anterior ao desligamento.`,
          );
        return {
          ...f,
          diasDisponiveis: diasDisponiveis.length,
          diasComAlocacao: diasComAlocacao.length,
          diasSemAlocacao: diasSemAlocacao.length,
          datasSemAlocacao: diasSemAlocacao,
          admitidoNoPeriodo,
          desligadoNoPeriodo,
          observacao: observacoes.join(" "),
          ultimoCcId: ultimaAlocacao?.obra_id ?? null,
          ultimoCcNome: ultimaAlocacao?.obra_nome ?? null,
          ultimaAlocacao: ultimaAlocacao?.data ?? null,
        };
      })
      .filter((f) => {
        if (f.diasDisponiveis === 0 || f.diasSemAlocacao === 0) return false;
        if (pendenciaFilter === "ativos" && !f.ativo) return false;
        if (pendenciaFilter === "admitidos" && !f.admitidoNoPeriodo) return false;
        if (pendenciaFilter === "desligados" && !f.desligadoNoPeriodo) return false;
        if (categoriaFilter !== "all" && f.categoria_mo !== categoriaFilter) return false;
        if (coberturaFilter === "zero" && f.diasComAlocacao !== 0) return false;
        if (coberturaFilter === "parcial" && f.diasComAlocacao === 0) return false;
        if (ultimoCcFilter === "none" && f.ultimoCcId != null) return false;
        if (
          ultimoCcFilter !== "all" &&
          ultimoCcFilter !== "none" &&
          f.ultimoCcId !== ultimoCcFilter
        )
          return false;
        return true;
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [
    alocacoesSemAlocacao,
    funcionariosSemAlocacao,
    start,
    end,
    dataLimiteAnalise,
    competenciaSemDiasVencidos,
    pendenciaFilter,
    categoriaFilter,
    coberturaFilter,
    ultimoCcFilter,
    ultimaAlocacaoPorFuncionario,
    relatorioSemAlocacao?.vigenciasCentroCusto,
  ]);

  const categoriasPendencias = useMemo(
    () => Array.from(new Set(funcionariosSemAlocacao.map((f) => f.categoria_mo))).sort(),
    [funcionariosSemAlocacao],
  );

  function exportarSemAlocacao() {
    const rows = semAlocacao.map((f) => ({
      "Período analisado": `${start} a ${dataLimiteAnalise}`,
      Funcionário: f.nome,
      "Função/Categoria": f.categoria_mo,
      "Data de admissão": f.data_admissao
        ? new Date(f.data_admissao + "T00:00:00").toLocaleDateString("pt-BR")
        : "",
      "Data de desligamento": f.data_desligamento
        ? new Date(f.data_desligamento + "T00:00:00").toLocaleDateString("pt-BR")
        : "",
      Status: f.ativo ? "Ativo" : "Desligado",
      "Último CC": f.ultimoCcNome ?? "Sem CC anterior",
      "Última alocação": f.ultimaAlocacao
        ? new Date(f.ultimaAlocacao + "T00:00:00").toLocaleDateString("pt-BR")
        : "",
      "Dias disponíveis": f.diasDisponiveis,
      "Dias com alocação": f.diasComAlocacao,
      "Dias sem alocação": f.diasSemAlocacao,
      "Datas sem alocação": f.datasSemAlocacao
        .map((data) => new Date(data + "T00:00:00").toLocaleDateString("pt-BR"))
        .join(", "),
      Observação: f.observacao,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Sem alocação");
    XLSX.writeFile(workbook, `funcionarios-sem-alocacao-${start}-${end}.xlsx`);
  }
  // Mostra ativos + inativos com lançamentos no período (custos pagos mesmo após desligamento).
  const ativos = funcionariosRelatorio.filter((f) => f.ativo || funcIdsComLancamento.has(f.id));
  const totalFolhaAtiva = ativos.reduce(
    (s, f) =>
      s + (custoPorFunc.get(f.id)?.total ?? 0) + (horasExtrasPorFunc.get(f.id)?.custoTotal ?? 0),
    0,
  );

  const obraMap = useMemo(
    () => new Map((obras ?? []).map((obra) => [obra.id, obra.nome])),
    [obras],
  );
  const alocacaoMap = useMemo(
    () =>
      new Map(
        (alocacoes ?? []).map((alocacao) => [
          `${alocacao.funcionario_id}|${alocacao.obra_id}|${alocacao.data}`,
          alocacao,
        ]),
      ),
    [alocacoes],
  );
  const funcionarioDetalhe =
    ativos.find((funcionario) => funcionario.id === funcionarioDetalheId) ?? null;
  const custoDetalhe = funcionarioDetalhe ? custoPorFunc.get(funcionarioDetalhe.id) : null;
  const horasExtrasDetalhe = funcionarioDetalhe
    ? horasExtrasPorFunc.get(funcionarioDetalhe.id)
    : null;
  const registrosDetalhe = funcionarioDetalhe
    ? (registros ?? [])
        .filter((registro) => registro.funcionario_id === funcionarioDetalhe.id)
        .map((registro) => {
          const alocacao = alocacaoMap.get(
            `${registro.funcionario_id}|${registro.obra_id}|${registro.data}`,
          );
          const detalhe = detalhePorRegistro.get(registro.id);
          const apuracao = detalhe
            ? {
                horasNormaisApuradas: detalhe.minutos_normais / 60,
                horasExtra50Apuradas: detalhe.minutos_he_50 / 60,
                horasExtra100Apuradas: detalhe.minutos_he_100 / 60,
              }
            : classificarHorasPorData({
                data: registro.data,
                horasNormais: registro.horas_normais,
                horasExtras: registro.horas_extras,
              });
          const horasExtrasApuradas =
            apuracao.horasExtra50Apuradas + apuracao.horasExtra100Apuradas;
          return {
            ...registro,
            apuracao,
            obraNome: obraMap.get(registro.obra_id) ?? "—",
            horaEntrada: alocacao?.hora_entrada?.slice(0, 5) ?? "—",
            horaSaida: alocacao?.hora_saida?.slice(0, 5) ?? "—",
            custoHoraExtra: custoDetalhe
              ? calcularCustoHorasExtras(custoDetalhe, [
                  { data: registro.data, horasExtras: horasExtrasApuradas },
                ]).custoTotal
              : 0,
          };
        })
        .sort((a, b) => a.data.localeCompare(b.data))
    : [];
  const resumoHorasDetalhe = registrosDetalhe.reduce(
    (acc, registro) => ({
      dias:
        acc.dias +
        (registro.apuracao.horasNormaisApuradas +
          registro.apuracao.horasExtra50Apuradas +
          registro.apuracao.horasExtra100Apuradas >
        0
          ? 1
          : 0),
      normais: acc.normais + registro.apuracao.horasNormaisApuradas,
      total:
        acc.total +
        registro.apuracao.horasNormaisApuradas +
        registro.apuracao.horasExtra50Apuradas +
        registro.apuracao.horasExtra100Apuradas,
    }),
    { dias: 0, normais: 0, total: 0 },
  );

  const mesLabel = new Date(year, month, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  const periodoLabel = `${startDate.toLocaleDateString("pt-BR")} a ${endDate.toLocaleDateString("pt-BR")}`;
  const dataLimiteLabel = new Date(dataLimiteAnalise + "T00:00:00").toLocaleDateString("pt-BR");

  function nav(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function exportarCentroDetalhe() {
    if (!centroDetalhe || exportandoCentro) return;
    setExportandoCentro(true);
    try {
      exportCostCenterXlsx({
        centro: centroDetalhe,
        competencia: mesLabel,
        periodoInicial: start,
        periodoFinal: end,
        segmentarMod,
      });
    } finally {
      setExportandoCentro(false);
    }
  }

  const loading = lf || la || lr;
  const loadingPendencias = loadingSemAlocacao;

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description={
          podeVerFolha
            ? "Custos consolidados de mão de obra por funcionário e por centro de custo."
            : podeVerCentroCusto
              ? "Custos consolidados de mão de obra por centro de custo."
              : "Pendências operacionais de funcionários sem alocação."
        }
        actions={
          <div className="flex items-center gap-1 rounded-md border bg-card p-1">
            <Button variant="ghost" size="icon" onClick={() => nav(-1)} aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[200px] text-center text-sm font-medium capitalize">
              {mesLabel}{" "}
              <span className="text-xs text-muted-foreground normal-case">({periodoLabel})</span>
            </span>
            <Button variant="ghost" size="icon" onClick={() => nav(1)} aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="ml-1"
              onClick={() => {
                setYear(today.getFullYear());
                setMonth(today.getMonth());
              }}
            >
              Hoje
            </Button>
          </div>
        }
      />

      <Tabs
        defaultValue={podeVerFolha ? "funcionarios" : podeVerCentroCusto ? "obras" : "sem-alocacao"}
        className="space-y-4"
      >
        <TabsList>
          {podeVerFolha && <TabsTrigger value="funcionarios">Custo por funcionário</TabsTrigger>}
          {podeVerCentroCusto && <TabsTrigger value="obras">Custo por centro de custo</TabsTrigger>}
          <TabsTrigger value="sem-alocacao">Sem alocação</TabsTrigger>
        </TabsList>

        {podeVerFolha && (
          <TabsContent value="funcionarios">
            <Card>
              <CardHeader>
                <CardTitle>Folha mensal — funcionários ativos</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Total mensal:{" "}
                  <span className="font-semibold text-foreground">{fmtBRL(totalFolhaAtiva)}</span> ·{" "}
                  {ativos.length} funcionário(s)
                </p>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Categoria</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead className="text-right">Salário</TableHead>
                          <TableHead className="text-right">Encargos</TableHead>
                          <TableHead className="text-right">Prov. 13º</TableHead>
                          <TableHead className="text-right">Prov. aviso</TableHead>
                          <TableHead className="text-right">Prov. férias</TableHead>
                          <TableHead className="text-right">Benefícios e seguro</TableHead>
                          <TableHead className="text-right">Horas extras</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ativos.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={11}
                              className="py-8 text-center text-muted-foreground"
                            >
                              Nenhum funcionário ativo.
                            </TableCell>
                          </TableRow>
                        ) : (
                          ativos.map((f) => {
                            const c = custoPorFunc.get(f.id);
                            const tipo = tipoCategoria(f.categoria_mo, categorias);
                            if (!c) return null;
                            return (
                              <TableRow key={f.id}>
                                <TableCell className="font-medium">
                                  <button
                                    type="button"
                                    className="flex cursor-pointer items-center gap-2 text-left hover:underline"
                                    onClick={() => setFuncionarioDetalheId(f.id)}
                                  >
                                    <span>{f.nome}</span>
                                    {!f.ativo && (
                                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                        Inativo
                                      </span>
                                    )}
                                  </button>
                                </TableCell>
                                <TableCell>{f.categoria_mo}</TableCell>
                                <TableCell>
                                  {tipo && <Badge variant="outline">{tipo}</Badge>}
                                </TableCell>
                                <TableCell className="text-right">{fmtBRL(c.salario)}</TableCell>
                                <TableCell className="text-right">{fmtBRL(c.encargos)}</TableCell>
                                <TableCell className="text-right">{fmtBRL(c.prov13)}</TableCell>
                                <TableCell className="text-right">
                                  {fmtBRL(c.provAvisoPrevio)}
                                </TableCell>
                                <TableCell className="text-right">{fmtBRL(c.provFerias)}</TableCell>
                                <TableCell className="text-right">
                                  <div>{fmtBRL(c.beneficios)}</div>
                                  <div className="text-xs text-muted-foreground">
                                    Seguro: {fmtBRL(c.seguroVida)}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div>{fmtBRL(horasExtrasPorFunc.get(f.id)?.custoTotal ?? 0)}</div>
                                  {(horasExtrasPorFunc.get(f.id)?.horas50 ?? 0) +
                                    (horasExtrasPorFunc.get(f.id)?.horas100 ?? 0) >
                                    0 && (
                                    <div className="whitespace-nowrap text-xs text-muted-foreground">
                                      {formatarHorasDecimais(
                                        horasExtrasPorFunc.get(f.id)?.horas50 ?? 0,
                                      )}{" "}
                                      a 50% ·{" "}
                                      {formatarHorasDecimais(
                                        horasExtrasPorFunc.get(f.id)?.horas100 ?? 0,
                                      )}{" "}
                                      a 100%
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-semibold">
                                  {fmtBRL(
                                    c.total + (horasExtrasPorFunc.get(f.id)?.custoTotal ?? 0),
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={10} className="text-right font-medium">
                            Total
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {fmtBRL(totalFolhaAtiva)}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {podeVerCentroCusto && (
          <TabsContent value="obras">
            <Card>
              <CardHeader>
                <CardTitle>
                  Custo de mão de obra por centro de custo — {mesLabel}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({periodoLabel})
                  </span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Custo proporcional: (custo mensal ÷ {diasUteis} dias úteis) × dias alocados, com
                  horas extras a 50% ou 100% e seus encargos/provisões somados quando registradas.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                {loadingCentros ? (
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (
                  <>
                    {avisosObras.length > 0 && (
                      <Alert className="m-4">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Avisos do calculo</AlertTitle>
                        <AlertDescription>
                          <ul className="list-disc space-y-1 pl-4">
                            {avisosObras.map((aviso) => (
                              <li key={aviso}>{aviso}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="overflow-x-auto">
                      <Table className="min-w-[760px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Centro de custo</TableHead>
                            {segmentarMod ? (
                              <>
                                <TableHead className="text-right">MOD Civil</TableHead>
                                <TableHead className="text-right">MOD Montagem</TableHead>
                              </>
                            ) : (
                              <TableHead className="text-right">MOD</TableHead>
                            )}
                            {segmentarMod && totaisObra.modAClassificar > 0 && (
                              <TableHead className="text-right">MOD a classificar</TableHead>
                            )}
                            <TableHead className="text-right">MOI</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {obrasComCusto.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={segmentarMod && totaisObra.modAClassificar > 0 ? 6 : 5}
                                className="py-8 text-center text-muted-foreground"
                              >
                                Nenhuma alocação no mês.
                              </TableCell>
                            </TableRow>
                          ) : (
                            obrasComCusto.map((o) => (
                              <TableRow key={o.id}>
                                <TableCell className="font-medium">
                                  <button
                                    type="button"
                                    className="cursor-pointer text-left hover:underline"
                                    onClick={() => setCentroDetalheId(o.id)}
                                  >
                                    {o.nome}
                                  </button>
                                </TableCell>
                                {segmentarMod ? (
                                  <>
                                    <TableCell className="text-right">
                                      {fmtBRL(o.modCivil)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {fmtBRL(o.modMontagem)}
                                    </TableCell>
                                  </>
                                ) : (
                                  <TableCell className="text-right">{fmtBRL(o.mod)}</TableCell>
                                )}
                                {segmentarMod && totaisObra.modAClassificar > 0 && (
                                  <TableCell className="text-right">
                                    {fmtBRL(o.modAClassificar)}
                                  </TableCell>
                                )}
                                <TableCell className="text-right">{fmtBRL(o.moi)}</TableCell>
                                <TableCell className="text-right font-semibold">
                                  {fmtBRL(o.total)}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                        <TableFooter>
                          <TableRow>
                            <TableCell className="font-medium">Total geral</TableCell>
                            {segmentarMod ? (
                              <>
                                <TableCell className="text-right font-medium">
                                  {fmtBRL(totaisObra.modCivil)}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {fmtBRL(totaisObra.modMontagem)}
                                </TableCell>
                              </>
                            ) : (
                              <TableCell className="text-right font-medium">
                                {fmtBRL(totaisObra.mod)}
                              </TableCell>
                            )}
                            {segmentarMod && totaisObra.modAClassificar > 0 && (
                              <TableCell className="text-right font-medium">
                                {fmtBRL(totaisObra.modAClassificar)}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-medium">
                              {fmtBRL(totaisObra.moi)}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {fmtBRL(totaisObra.total)}
                            </TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="sem-alocacao">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Funcionários sem alocação na competência</CardTitle>
                  <div className="text-sm text-muted-foreground">
                    <p>Competência: {periodoLabel}</p>
                    <p>
                      {competenciaSemDiasVencidos
                        ? "Esta competência ainda não possui dias vencidos para análise."
                        : `Análise de pendências até ${dataLimiteLabel} · ${semAlocacao.length} pendência(s)`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={exportarSemAlocacao}
                  disabled={!semAlocacao.length}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Exportar Excel
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={pendenciaFilter}
                  onValueChange={(v) => setPendenciaFilter(v as typeof pendenciaFilter)}
                >
                  <SelectTrigger className="w-[210px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="ativos">Apenas ativos</SelectItem>
                    <SelectItem value="admitidos">Admitidos no período</SelectItem>
                    <SelectItem value="desligados">Desligados no período</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={ultimoCcFilter} onValueChange={setUltimoCcFilter}>
                  <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder="Último Centro de Custo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os últimos centros</SelectItem>
                    <SelectItem value="none">Sem CC anterior</SelectItem>
                    {ultimosCentrosSemAlocacao.map(([id, nome]) => (
                      <SelectItem key={id} value={id}>
                        {nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
                  <SelectTrigger className="w-[230px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    {categoriasPendencias.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={coberturaFilter}
                  onValueChange={(v) => setCoberturaFilter(v as typeof coberturaFilter)}
                >
                  <SelectTrigger className="w-[230px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as pendências</SelectItem>
                    <SelectItem value="zero">Sem nenhuma alocação</SelectItem>
                    <SelectItem value="parcial">Alocação parcial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingPendencias ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Funcionário</TableHead>
                      <TableHead>Função/Categoria</TableHead>
                      <TableHead>Admissão</TableHead>
                      <TableHead>Desligamento</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Último CC</TableHead>
                      <TableHead>Última alocação</TableHead>
                      <TableHead className="text-right">Dias disponíveis</TableHead>
                      <TableHead className="text-right">Dias alocados</TableHead>
                      <TableHead className="text-right">Dias sem alocação</TableHead>
                      <TableHead>Datas sem alocação</TableHead>
                      <TableHead>Observação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!semAlocacao.length ? (
                      <TableRow>
                        <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                          {competenciaSemDiasVencidos
                            ? "Esta competência ainda não possui dias vencidos para análise."
                            : "Nenhum funcionário com pendências vencidas no período analisado."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      semAlocacao.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="font-medium">{f.nome}</TableCell>
                          <TableCell>{f.categoria_mo}</TableCell>
                          <TableCell>
                            {f.data_admissao
                              ? new Date(f.data_admissao + "T00:00:00").toLocaleDateString("pt-BR")
                              : "—"}
                          </TableCell>
                          <TableCell>
                            {f.data_desligamento
                              ? new Date(f.data_desligamento + "T00:00:00").toLocaleDateString(
                                  "pt-BR",
                                )
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={f.ativo ? "default" : "secondary"}>
                              {f.ativo ? "Ativo" : "Desligado"}
                            </Badge>
                          </TableCell>
                          <TableCell>{f.ultimoCcNome ?? "Sem CC anterior"}</TableCell>
                          <TableCell>
                            {f.ultimaAlocacao
                              ? new Date(f.ultimaAlocacao + "T00:00:00").toLocaleDateString("pt-BR")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right">{f.diasDisponiveis}</TableCell>
                          <TableCell className="text-right">{f.diasComAlocacao}</TableCell>
                          <TableCell className="text-right font-medium">
                            {f.diasSemAlocacao}
                          </TableCell>
                          <TableCell className="max-w-[320px] text-xs leading-5">
                            {f.datasSemAlocacao
                              .map((data) =>
                                new Date(data + "T00:00:00").toLocaleDateString("pt-BR"),
                              )
                              .join(", ")}
                          </TableCell>
                          <TableCell className="max-w-[360px] text-sm">{f.observacao}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(centroDetalhe)}
        onOpenChange={(open) => {
          if (!open) setCentroDetalheId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Detalhamento do centro de custo</DialogTitle>
            <DialogDescription>
              <span className="block font-medium text-foreground">{centroDetalhe?.nome}</span>
              <span className="capitalize">
                {mesLabel} — {periodoLabel}
              </span>
            </DialogDescription>
          </DialogHeader>

          {centroDetalhe && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {[
                  ["Custo total", fmtBRL(centroDetalhe.total)],
                  ...(segmentarMod
                    ? [
                        ["MOD Civil", fmtBRL(centroDetalhe.modCivil)],
                        ["MOD Montagem", fmtBRL(centroDetalhe.modMontagem)],
                      ]
                    : [["MOD", fmtBRL(centroDetalhe.mod)]]),
                  ...(segmentarMod && centroDetalhe.modAClassificar > 0
                    ? [["MOD a classificar", fmtBRL(centroDetalhe.modAClassificar)]]
                    : []),
                  ["MOI", fmtBRL(centroDetalhe.moi)],
                  ["Funcionários", String(centroDetalhe.funcs)],
                  ["Dias alocados — soma da equipe", String(centroDetalhe.dias)],
                  ["Custo das horas extras", fmtBRL(centroDetalhe.custoHE)],
                  ["Refeição Local", fmtBRL(centroDetalhe.custoRegimeLocal)],
                  ["Refeição Alojado", fmtBRL(centroDetalhe.custoRegimeAlojado)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-semibold">{value}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Funcionário</TableHead>
                      <TableHead>Função</TableHead>
                      <TableHead>Tipo</TableHead>
                      {segmentarMod && <TableHead>Tipo MOD</TableHead>}
                      <TableHead>Regime</TableHead>
                      <TableHead className="text-right">Dias</TableHead>
                      <TableHead className="text-right">Horas normais</TableHead>
                      <TableHead className="text-right">HE 50%</TableHead>
                      <TableHead className="text-right">HE 100%</TableHead>
                      <TableHead className="text-right">Custo base</TableHead>
                      <TableHead className="text-right">Custo HE</TableHead>
                      <TableHead className="text-right">Custo Refeição</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {centroDetalhe.linhas.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={segmentarMod ? 13 : 12}
                          className="py-8 text-center text-muted-foreground"
                        >
                          Nenhum funcionário ou custo encontrado para este centro de custo na
                          competência selecionada.
                        </TableCell>
                      </TableRow>
                    ) : (
                      centroDetalhe.linhas.map((linha) => (
                        <TableRow
                          key={`${linha.funcionarioId}|${linha.tipo}|${linha.tipoMod ?? ""}`}
                        >
                          <TableCell className="font-medium">
                            {podeVerFolha ? (
                              <button
                                type="button"
                                className="cursor-pointer text-left hover:underline"
                                onClick={() => setFuncionarioDetalheId(linha.funcionarioId)}
                              >
                                {linha.funcionarioNome}
                              </button>
                            ) : (
                              linha.funcionarioNome
                            )}
                          </TableCell>
                          <TableCell>{linha.funcao}</TableCell>
                          <TableCell>
                            <span
                              title={
                                linha.tipoInferido
                                  ? "Tipo definido pela categoria do funcionário porque a alocação não possuía classificação explícita."
                                  : undefined
                              }
                            >
                              {linha.tipo}
                              {linha.tipoInferido ? "*" : ""}
                            </span>
                          </TableCell>
                          {segmentarMod && <TableCell>{linha.tipoMod ?? "-"}</TableCell>}
                          <TableCell>{linha.regime}</TableCell>
                          <TableCell className="text-right">{linha.dias}</TableCell>
                          <TableCell className="text-right">
                            {formatarHorasDecimais(linha.horasNormais)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatarHorasDecimais(linha.horas50)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatarHorasDecimais(linha.horas100)}
                          </TableCell>
                          <TableCell className="text-right">{fmtBRL(linha.custoBase)}</TableCell>
                          <TableCell className="text-right">{fmtBRL(linha.custoHE)}</TableCell>
                          <TableCell className="text-right">{fmtBRL(linha.custoRegime)}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {fmtBRL(linha.total)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={segmentarMod ? 9 : 8} className="text-right font-medium">
                        Total
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtBRL(
                          centroDetalhe.linhas.reduce((total, linha) => total + linha.custoBase, 0),
                        )}
                      </TableCell>
                      <TableCell className="text-right">{fmtBRL(centroDetalhe.custoHE)}</TableCell>
                      <TableCell className="text-right">
                        {fmtBRL(centroDetalhe.custoRegimeLocal + centroDetalhe.custoRegimeAlojado)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtBRL(centroDetalhe.total)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>

              {centroDetalhe.linhas.some((linha) => linha.tipoInferido) && (
                <p className="text-xs text-muted-foreground">
                  * Tipo definido pela categoria do funcionário porque a alocação não possuía
                  classificação explícita.
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button onClick={exportarCentroDetalhe} disabled={exportandoCentro}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  {exportandoCentro ? "Gerando..." : "Exportar Excel"}
                </Button>
                <DialogClose asChild>
                  <Button variant="outline">Fechar</Button>
                </DialogClose>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(funcionarioDetalhe)}
        onOpenChange={(open) => {
          if (!open) setFuncionarioDetalheId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Detalhamento do funcionário</DialogTitle>
            <DialogDescription>
              {funcionarioDetalhe?.nome} · {funcionarioDetalhe?.categoria_mo} · {periodoLabel}
            </DialogDescription>
          </DialogHeader>

          {funcionarioDetalhe && custoDetalhe && horasExtrasDetalhe && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Dias trabalhados", String(resumoHorasDetalhe.dias)],
                  ["Horas normais", formatarHorasDecimais(resumoHorasDetalhe.normais)],
                  ["HE 50%", formatarHorasDecimais(horasExtrasDetalhe.horas50)],
                  ["HE 100%", formatarHorasDecimais(horasExtrasDetalhe.horas100)],
                  ["Total de horas", formatarHorasDecimais(resumoHorasDetalhe.total)],
                  ["Custo mensal base", fmtBRL(custoDetalhe.total)],
                  ["Remuneração das HE", fmtBRL(horasExtrasDetalhe.remuneracao)],
                  [
                    "Encargos e provisões das HE",
                    fmtBRL(
                      horasExtrasDetalhe.encargos +
                        horasExtrasDetalhe.provisao13 +
                        horasExtrasDetalhe.provisaoAviso +
                        horasExtrasDetalhe.provisaoFerias,
                    ),
                  ],
                  ["Custo total das HE", fmtBRL(horasExtrasDetalhe.custoTotal)],
                  [
                    "Custo total na competência",
                    fmtBRL(custoDetalhe.total + horasExtrasDetalhe.custoTotal),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-semibold">{value}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Centro de custo</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Classificação</TableHead>
                      <TableHead>Entrada</TableHead>
                      <TableHead>Saída</TableHead>
                      <TableHead className="text-right">Horas normais</TableHead>
                      <TableHead className="text-right">HE 50%</TableHead>
                      <TableHead className="text-right">HE 100%</TableHead>
                      <TableHead className="text-right">Custo da HE</TableHead>
                      <TableHead>Observação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registrosDetalhe.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                          Nenhum registro de horas encontrado nesta competência.
                        </TableCell>
                      </TableRow>
                    ) : (
                      registrosDetalhe.map((registro) => {
                        return (
                          <TableRow
                            key={`${registro.funcionario_id}|${registro.obra_id}|${registro.data}`}
                          >
                            <TableCell>
                              {new Date(`${registro.data}T00:00:00`).toLocaleDateString("pt-BR")}
                            </TableCell>
                            <TableCell>{registro.obraNome}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  registro.tipo_registro === "falta" ? "destructive" : "secondary"
                                }
                              >
                                {rotuloTipoRegistro(registro.tipo_registro)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {registro.tipo_registro === "falta"
                                ? rotuloFalta(registro.falta_tipo)
                                : "—"}
                            </TableCell>
                            <TableCell>
                              {registro.tipo_registro === "horas" ? registro.horaEntrada : "—"}
                            </TableCell>
                            <TableCell>
                              {registro.tipo_registro === "horas" ? registro.horaSaida : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {registro.tipo_registro === "horas"
                                ? formatarHorasDecimais(registro.apuracao.horasNormaisApuradas)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {registro.tipo_registro === "horas"
                                ? formatarHorasDecimais(registro.apuracao.horasExtra50Apuradas)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {registro.tipo_registro === "horas"
                                ? formatarHorasDecimais(registro.apuracao.horasExtra100Apuradas)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {registro.tipo_registro === "horas"
                                ? fmtBRL(registro.custoHoraExtra)
                                : "—"}
                            </TableCell>
                            <TableCell>{registro.observacoes || "—"}</TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
