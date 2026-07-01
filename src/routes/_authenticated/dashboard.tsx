import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area,
} from "recharts";
import {
  DollarSign, Users, Clock, AlertTriangle, TrendingUp, Briefcase,
  UserCheck, Layers, FileDown, Filter, X, Activity,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { calcularCusto, fmtBRL, useBeneficios, useSegurosVida } from "@/lib/custos";
import { useCategorias, tipoCategoria, type CategoriaTipo } from "@/lib/categorias";

export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const roles = (data ?? []).map((r) => r.role);
    if (!roles.includes("gerente") && !roles.includes("diretor")) {
      throw redirect({ to: "/funcionarios" });
    }
  },
  component: DashboardPage,
});

const CHART_COLORS = [
  "hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

// Folha mensal: dia 25 do mês anterior até dia 24 do mês de competência.
// Datas >= dia 25 pertencem ao mês seguinte (competência).
const monthKey = (d: string) => {
  const [yStr, mStr, dStr] = d.split("-");
  const y = Number(yStr), m = Number(mStr), day = Number(dStr);
  const dt = new Date(y, m - 1 + (day >= 25 ? 1 : 0), 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (k: string) => {
  const [y, m] = k.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
};
const monthsBack = (n: number) => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

type FuncRow = { id: string; nome: string; categoria_mo: string; ativo: boolean; salario: number | null };
type AlocRow = { funcionario_id: string; obra_id: string; data: string };
type ObraRow = { id: string; nome: string };
type RegRow = {
  funcionario_id: string; obra_id: string; data: string;
  horas_normais: number; horas_extras: number; ausencia: boolean;
};
type CustoIndireto = {
  obra_id: string; categoria_id: string; valor: number; data: string;
};
type Categoria = { id: string; nome: string };

function DashboardPage() {
  // ---------- Filters ----------
  const [dataIni, setDataIni] = useState<string>(monthsBack(5));
  const [dataFim, setDataFim] = useState<string>(todayISO());
  const [obraSel, setObraSel] = useState<Set<string>>(new Set());
  const [tipoMO, setTipoMO] = useState<"all" | CategoriaTipo>("all");

  // ---------- Data ----------
  const { data: beneficios } = useBeneficios();
  const { data: segurosVida } = useSegurosVida();
  const { data: categoriasMO } = useCategorias();

  const { data: obras } = useQuery({
    queryKey: ["obras-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obras").select("id,nome").order("nome");
      if (error) throw error;
      return data as ObraRow[];
    },
  });

  const { data: funcionarios, isLoading: lf } = useQuery({
    queryKey: ["funcionarios-dash"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios_safe" as any)
        .select("id,nome,categoria_mo,ativo,salario")
        .order("nome");
      if (error) throw error;
      return (data as unknown) as FuncRow[];
    },
  });

  const { data: alocacoes, isLoading: la } = useQuery({
    queryKey: ["aloc-dash", dataIni, dataFim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alocacoes")
        .select("funcionario_id,obra_id,data")
        .gte("data", dataIni).lte("data", dataFim);
      if (error) throw error;
      return data as AlocRow[];
    },
  });

  const { data: registros, isLoading: lr } = useQuery({
    queryKey: ["regs-dash", dataIni, dataFim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registros_horas")
        .select("funcionario_id,obra_id,data,horas_normais,horas_extras,ausencia")
        .gte("data", dataIni).lte("data", dataFim);
      if (error) throw error;
      return data as RegRow[];
    },
  });

  const { data: custosInd, isLoading: lci } = useQuery({
    queryKey: ["custos-ind-dash", dataIni, dataFim],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custos_indiretos")
        .select("obra_id,categoria_id,valor,data")
        .gte("data", dataIni).lte("data", dataFim);
      if (error) throw error;
      return (data as unknown) as CustoIndireto[];
    },
  });

  const { data: categoriasCI } = useQuery({
    queryKey: ["custos-categorias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custos_indiretos_categorias")
        .select("id,nome").order("nome");
      if (error) throw error;
      return (data as unknown) as Categoria[];
    },
  });

  const loading = lf || la || lr || lci;

  // ---------- Maps & filters applied ----------
  const obrasMap = useMemo(() => new Map((obras ?? []).map((o) => [o.id, o.nome])), [obras]);
  const ciCatMap = useMemo(() => new Map((categoriasCI ?? []).map((c) => [c.id, c.nome])), [categoriasCI]);
  const funcMap = useMemo(() => new Map((funcionarios ?? []).map((f) => [f.id, f])), [funcionarios]);

  const obraAllowed = (id: string) => obraSel.size === 0 || obraSel.has(id);
  const funcTipo = (f: FuncRow) => tipoCategoria(f.categoria_mo, categoriasMO);
  const funcAllowed = (f: FuncRow) => tipoMO === "all" || funcTipo(f) === tipoMO;

  const funcsAtivos = (funcionarios ?? []).filter((f) => f.ativo && funcAllowed(f));
  const allocFiltered = (alocacoes ?? []).filter((a) => {
    if (!obraAllowed(a.obra_id)) return false;
    const f = funcMap.get(a.funcionario_id); if (!f) return false;
    return funcAllowed(f);
  });
  const regsFiltered = (registros ?? []).filter((r) => {
    if (!obraAllowed(r.obra_id)) return false;
    const f = funcMap.get(r.funcionario_id); if (!f) return false;
    return funcAllowed(f);
  });
  const ciFiltered = (custosInd ?? []).filter((c) => obraAllowed(c.obra_id));

  // ---------- Cost per active employee (monthly) ----------
  const custoMensalFunc = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of funcsAtivos) {
      const c = calcularCusto(f.salario, beneficios ?? null, segurosVida?.get(f.categoria_mo) ?? 0);
      m.set(f.id, c.total);
    }
    return m;
  }, [funcsAtivos, beneficios, segurosVida]);

  const custoTotalMO = Array.from(custoMensalFunc.values()).reduce((s, v) => s + v, 0);
  const custoMedioFunc = funcsAtivos.length ? custoTotalMO / funcsAtivos.length : 0;

  // ---------- Hours ----------
  const totalHorasNormais = regsFiltered.reduce((s, r) => s + Number(r.horas_normais || 0), 0);
  const totalHorasExtras = regsFiltered.reduce((s, r) => s + Number(r.horas_extras || 0), 0);
  const totalHoras = totalHorasNormais + totalHorasExtras;
  const pctExtras = totalHoras > 0 ? (totalHorasExtras / totalHoras) * 100 : 0;

  const totalAusencias = regsFiltered.filter((r) => r.ausencia).length;
  const taxaAusencia = regsFiltered.length > 0 ? (totalAusencias / regsFiltered.length) * 100 : 0;

  const custoIndiretoTotal = ciFiltered.reduce((s, c) => s + Number(c.valor), 0);

  // ---------- Operational: ativos por obra ----------
  const ativosPorObra = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of allocFiltered) {
      const f = funcMap.get(a.funcionario_id);
      if (!f?.ativo) continue;
      if (!m.has(a.obra_id)) m.set(a.obra_id, new Set());
      m.get(a.obra_id)!.add(a.funcionario_id);
    }
    return Array.from(m, ([id, set]) => ({ nome: obrasMap.get(id) ?? "—", qtd: set.size }))
      .sort((a, b) => b.qtd - a.qtd);
  }, [allocFiltered, funcMap, obrasMap]);

  // MOD vs MOI
  const modMoi = useMemo(() => {
    let mod = 0, moi = 0;
    for (const f of funcsAtivos) {
      const t = funcTipo(f);
      if (t === "MOD") mod++;
      else if (t === "MOI") moi++;
    }
    return [
      { nome: "MOD", qtd: mod },
      { nome: "MOI", qtd: moi },
    ];
  }, [funcsAtivos, categoriasMO]);

  // ---------- Evolução custos mensais (MO prorrateada + indiretos por mês) ----------
  const evolucaoMensal = useMemo(() => {
    // Indiretos por mês
    const mInd = new Map<string, number>();
    for (const c of ciFiltered) {
      const k = monthKey(c.data);
      mInd.set(k, (mInd.get(k) ?? 0) + Number(c.valor));
    }
    // MO: rateio diário por funcionário (custo mensal / dias úteis 22) * dias com alocação no mês
    const mMo = new Map<string, number>();
    const diariaPorFunc = new Map<string, number>();
    for (const [id, total] of custoMensalFunc) diariaPorFunc.set(id, total / 22);
    for (const a of allocFiltered) {
      const d = diariaPorFunc.get(a.funcionario_id) ?? 0;
      const k = monthKey(a.data);
      mMo.set(k, (mMo.get(k) ?? 0) + d);
    }
    const keys = new Set<string>([...mInd.keys(), ...mMo.keys()]);
    return Array.from(keys).sort().map((k) => ({
      mes: k, label: monthLabel(k),
      mo: Math.round(mMo.get(k) ?? 0),
      indiretos: Math.round(mInd.get(k) ?? 0),
      total: Math.round((mMo.get(k) ?? 0) + (mInd.get(k) ?? 0)),
    }));
  }, [ciFiltered, allocFiltered, custoMensalFunc]);

  // Ranking obras por custo total (MO rateada + indiretos)
  const rankingObras = useMemo(() => {
    const m = new Map<string, { mo: number; ind: number }>();
    const diariaPorFunc = new Map<string, number>();
    for (const [id, total] of custoMensalFunc) diariaPorFunc.set(id, total / 22);
    for (const a of allocFiltered) {
      const d = diariaPorFunc.get(a.funcionario_id) ?? 0;
      const o = m.get(a.obra_id) ?? { mo: 0, ind: 0 };
      o.mo += d; m.set(a.obra_id, o);
    }
    for (const c of ciFiltered) {
      const o = m.get(c.obra_id) ?? { mo: 0, ind: 0 };
      o.ind += Number(c.valor); m.set(c.obra_id, o);
    }
    return Array.from(m, ([id, v]) => ({
      nome: obrasMap.get(id) ?? "—",
      mo: Math.round(v.mo), indiretos: Math.round(v.ind),
      total: Math.round(v.mo + v.ind),
    })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [allocFiltered, ciFiltered, custoMensalFunc, obrasMap]);

  // Horas extras por período (mensal)
  const horasExtrasPeriodo = useMemo(() => {
    const m = new Map<string, { normais: number; extras: number }>();
    for (const r of regsFiltered) {
      const k = monthKey(r.data);
      const o = m.get(k) ?? { normais: 0, extras: 0 };
      o.normais += Number(r.horas_normais); o.extras += Number(r.horas_extras);
      m.set(k, o);
    }
    return Array.from(m).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ mes: k, label: monthLabel(k), normais: v.normais, extras: v.extras }));
  }, [regsFiltered]);

  // Distribuição custos indiretos por categoria
  const distCustosInd = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of ciFiltered) {
      const n = ciCatMap.get(c.categoria_id) ?? "—";
      m.set(n, (m.get(n) ?? 0) + Number(c.valor));
    }
    return Array.from(m, ([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor);
  }, [ciFiltered, ciCatMap]);

  // ---------- Alertas ----------
  // Obras com excesso de horas extras (>15% do total ou >40h no período)
  const obrasExtras = useMemo(() => {
    const m = new Map<string, { normais: number; extras: number }>();
    for (const r of regsFiltered) {
      const o = m.get(r.obra_id) ?? { normais: 0, extras: 0 };
      o.normais += Number(r.horas_normais); o.extras += Number(r.horas_extras);
      m.set(r.obra_id, o);
    }
    return Array.from(m, ([id, v]) => ({
      nome: obrasMap.get(id) ?? "—",
      extras: v.extras, total: v.normais + v.extras,
      pct: v.normais + v.extras > 0 ? (v.extras / (v.normais + v.extras)) * 100 : 0,
    })).filter((x) => x.pct > 15 || x.extras > 40)
      .sort((a, b) => b.extras - a.extras);
  }, [regsFiltered, obrasMap]);

  // Funcionários sobrecarregados (>20h extras ou >10% ausência no período)
  const funcsSobrecarregados = useMemo(() => {
    const m = new Map<string, { extras: number; dias: number; aus: number }>();
    for (const r of regsFiltered) {
      const o = m.get(r.funcionario_id) ?? { extras: 0, dias: 0, aus: 0 };
      o.extras += Number(r.horas_extras); o.dias += 1;
      if (r.ausencia) o.aus += 1;
      m.set(r.funcionario_id, o);
    }
    return Array.from(m, ([id, v]) => {
      const f = funcMap.get(id);
      return {
        nome: f?.nome ?? "—",
        extras: v.extras,
        ausencia: v.dias > 0 ? (v.aus / v.dias) * 100 : 0,
      };
    }).filter((x) => x.extras > 20 || x.ausencia > 10)
      .sort((a, b) => b.extras - a.extras).slice(0, 10);
  }, [regsFiltered, funcMap]);

  // ---------- Exports ----------
  const exportPDF = async () => {
    const { default: jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    doc.setFontSize(16); doc.text("Dashboard Gerencial", 14, 16);
    doc.setFontSize(10);
    doc.text(`Período: ${dataIni} a ${dataFim}`, 14, 24);

    autoTable(doc, {
      startY: 30,
      head: [["KPI", "Valor"]],
      body: [
        ["Custo total MO (mensal)", fmtBRL(custoTotalMO)],
        ["Horas extras %", `${pctExtras.toFixed(1)}%`],
        ["Custo médio / funcionário", fmtBRL(custoMedioFunc)],
        ["Custos indiretos", fmtBRL(custoIndiretoTotal)],
        ["Funcionários ativos", String(funcsAtivos.length)],
        ["Taxa de ausências", `${taxaAusencia.toFixed(1)}%`],
      ],
    });

    autoTable(doc, {
      head: [["Obra", "MO", "Indiretos", "Total"]],
      body: rankingObras.map((r) => [r.nome, fmtBRL(r.mo), fmtBRL(r.indiretos), fmtBRL(r.total)]),
    });

    if (obrasExtras.length) {
      autoTable(doc, {
        head: [["Obra com excesso de horas extras", "Extras (h)", "% extras"]],
        body: obrasExtras.map((r) => [r.nome, r.extras.toFixed(1), `${r.pct.toFixed(1)}%`]),
      });
    }

    doc.save(`dashboard-${dataIni}-${dataFim}.pdf`);
  };

  const exportXLSX = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    const kpis = [
      { KPI: "Custo total MO mensal", Valor: custoTotalMO },
      { KPI: "Horas extras %", Valor: pctExtras },
      { KPI: "Custo médio / funcionário", Valor: custoMedioFunc },
      { KPI: "Custos indiretos", Valor: custoIndiretoTotal },
      { KPI: "Funcionários ativos", Valor: funcsAtivos.length },
      { KPI: "Taxa de ausências %", Valor: taxaAusencia },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpis), "KPIs");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(evolucaoMensal), "Evolução");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rankingObras), "Ranking obras");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(distCustosInd), "Custos indiretos");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(horasExtrasPeriodo), "Horas");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(obrasExtras), "Alertas obras");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(funcsSobrecarregados), "Alertas funcionários");

    XLSX.writeFile(wb, `dashboard-${dataIni}-${dataFim}.xlsx`);
  };

  // ---------- Filter helpers ----------
  const toggleObra = (id: string) => {
    setObraSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearFiltros = () => {
    setDataIni(monthsBack(5)); setDataFim(todayISO());
    setObraSel(new Set()); setTipoMO("all");
  };

  // ---------- Render ----------
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard gerencial"
        description="Visão consolidada de custos, operação e alertas."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button><FileDown className="mr-1 h-4 w-4" />Exportar</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportPDF}>PDF</DropdownMenuItem>
              <DropdownMenuItem onClick={exportXLSX}>Excel (XLSX)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* Filters */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Filter className="h-4 w-4" />Filtros globais</CardTitle>
          <Button variant="ghost" size="sm" onClick={clearFiltros}><X className="mr-1 h-4 w-4" />Limpar</Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Tipo MO</Label>
            <Select value={tipoMO} onValueChange={(v) => setTipoMO(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="MOD">MOD (direta)</SelectItem>
                <SelectItem value="MOI">MOI (indireta)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Obras ({obraSel.size || "todas"})</Label>
            <div className="flex max-h-24 flex-wrap gap-1 overflow-auto rounded border p-2">
              {(obras ?? []).map((o) => (
                <Badge key={o.id}
                  variant={obraSel.has(o.id) ? "default" : "outline"}
                  className="cursor-pointer transition-colors"
                  onClick={() => toggleObra(o.id)}>
                  {o.nome}
                </Badge>
              ))}
              {(obras ?? []).length === 0 && <span className="text-xs text-muted-foreground">Sem obras</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ============ SECTION 1: KPIs financeiros ============ */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Financeiro</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={DollarSign} label="Custo total MO (mensal)" value={fmtBRL(custoTotalMO)} loading={loading} tone="primary" />
          <KpiCard icon={Clock} label="Horas extras" value={`${pctExtras.toFixed(1)}%`}
            sub={`${totalHorasExtras.toFixed(0)}h de ${totalHoras.toFixed(0)}h`} loading={loading}
            tone={pctExtras > 15 ? "warn" : "default"} />
          <KpiCard icon={UserCheck} label="Custo médio / funcionário" value={fmtBRL(custoMedioFunc)} loading={loading} />
          <KpiCard icon={Briefcase} label="Custos indiretos" value={fmtBRL(custoIndiretoTotal)} loading={loading} />
        </div>
      </section>

      {/* ============ SECTION 2: Operacional ============ */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Operacional</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="transition-all hover:-translate-y-0.5 hover:shadow-lg">
            <CardHeader><CardTitle className="text-base">Funcionários ativos por obra</CardTitle></CardHeader>
            <CardContent>
              {ativosPorObra.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={Math.max(180, ativosPorObra.length * 28)}>
                  <BarChart data={ativosPorObra} layout="vertical" margin={{ left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" fontSize={11} allowDecimals={false} />
                    <YAxis type="category" dataKey="nome" fontSize={11} width={120} />
                    <Tooltip />
                    <Bar dataKey="qtd" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="transition-all hover:-translate-y-0.5 hover:shadow-lg">
            <CardHeader><CardTitle className="text-base">Distribuição MOD / MOI</CardTitle></CardHeader>
            <CardContent>
              {modMoi.every((x) => x.qtd === 0) ? <Empty /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={modMoi} dataKey="qtd" nameKey="nome" outerRadius={80}
                      label={(e: any) => `${e.nome}: ${e.qtd}`}>
                      {modMoi.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="transition-all hover:-translate-y-0.5 hover:shadow-lg">
            <CardHeader><CardTitle className="text-base">Taxa de ausências</CardTitle></CardHeader>
            <CardContent className="flex h-[220px] flex-col items-center justify-center">
              <div className={cn("text-5xl font-bold", taxaAusencia > 10 ? "text-destructive" : "text-primary")}>
                {taxaAusencia.toFixed(1)}%
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {totalAusencias} ausências em {regsFiltered.length} registros
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ============ SECTION 3: Gráficos analíticos ============ */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Análises</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="transition-all hover:shadow-lg">
            <CardHeader>
              <CardTitle className="text-base">Evolução custos mensais</CardTitle>
              <CardDescription>Mão de obra rateada + indiretos</CardDescription>
            </CardHeader>
            <CardContent>
              {evolucaoMensal.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={evolucaoMensal}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: any) => fmtBRL(Number(v))} />
                    <Legend />
                    <Area type="monotone" dataKey="mo" name="Mão de obra" stackId="1"
                      stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.6} />
                    <Area type="monotone" dataKey="indiretos" name="Indiretos" stackId="1"
                      stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="transition-all hover:shadow-lg">
            <CardHeader><CardTitle className="text-base">Ranking obras por custo</CardTitle></CardHeader>
            <CardContent>
              {rankingObras.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={Math.max(220, rankingObras.length * 34)}>
                  <BarChart data={rankingObras} layout="vertical" margin={{ left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" fontSize={11} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="nome" fontSize={11} width={130} />
                    <Tooltip formatter={(v: any) => fmtBRL(Number(v))} />
                    <Legend />
                    <Bar dataKey="mo" name="MO" stackId="a" fill="hsl(var(--primary))" />
                    <Bar dataKey="indiretos" name="Indiretos" stackId="a" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="transition-all hover:shadow-lg">
            <CardHeader><CardTitle className="text-base">Horas extras por período</CardTitle></CardHeader>
            <CardContent>
              {horasExtrasPeriodo.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={horasExtrasPeriodo}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="normais" name="Normais" fill="hsl(var(--primary))" />
                    <Bar dataKey="extras" name="Extras" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="transition-all hover:shadow-lg">
            <CardHeader><CardTitle className="text-base">Distribuição custos indiretos</CardTitle></CardHeader>
            <CardContent>
              {distCustosInd.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={distCustosInd} dataKey="valor" nameKey="nome" outerRadius={90}
                      label={(e: any) => e.nome}>
                      {distCustosInd.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmtBRL(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ============ SECTION 4: Alertas e ações ============ */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Alertas e ações</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-destructive/30 transition-all hover:shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Obras com excesso de horas extras
              </CardTitle>
              <CardDescription>&gt; 15% do total ou &gt; 40h no período</CardDescription>
            </CardHeader>
            <CardContent>
              {obrasExtras.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhum alerta.</p>
              ) : (
                <ul className="divide-y">
                  {obrasExtras.map((o) => (
                    <li key={o.nome} className="flex items-center justify-between py-2">
                      <span className="truncate">{o.nome}</span>
                      <div className="flex gap-2">
                        <Badge variant="outline">{o.extras.toFixed(0)}h</Badge>
                        <Badge variant="destructive">{o.pct.toFixed(0)}%</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-warning/30 transition-all hover:shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-destructive" />
                Funcionários sobrecarregados
              </CardTitle>
              <CardDescription>&gt; 20h extras ou &gt; 10% ausências</CardDescription>
            </CardHeader>
            <CardContent>
              {funcsSobrecarregados.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Nenhum alerta.</p>
              ) : (
                <ul className="divide-y">
                  {funcsSobrecarregados.map((f) => (
                    <li key={f.nome} className="flex items-center justify-between py-2">
                      <span className="truncate">{f.nome}</span>
                      <div className="flex gap-2">
                        <Badge variant="outline">{f.extras.toFixed(0)}h extras</Badge>
                        {f.ausencia > 10 && <Badge variant="destructive">{f.ausencia.toFixed(0)}% aus.</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, loading, tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string; loading?: boolean;
  tone?: "default" | "primary" | "warn";
}) {
  return (
    <Card className="group transition-all duration-200 hover:-translate-y-1 hover:shadow-xl">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            {loading ? <Skeleton className="mt-2 h-8 w-32" /> : (
              <p className={cn(
                "mt-1 truncate text-2xl font-bold",
                tone === "primary" && "text-primary",
                tone === "warn" && "text-destructive",
              )}>{value}</p>
            )}
            {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className={cn(
            "rounded-lg p-2 transition-transform group-hover:scale-110",
            tone === "primary" ? "bg-primary/10 text-primary" :
            tone === "warn" ? "bg-destructive/10 text-destructive" :
            "bg-muted text-muted-foreground",
          )}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Empty() {
  return <p className="py-12 text-center text-sm text-muted-foreground">Sem dados no período.</p>;
}
