import { createFileRoute, redirect } from "@tanstack/react-router";
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
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCategorias, tipoCategoria } from "@/lib/categorias";
import {
  calcularCusto,
  fmtBRL,
  useBeneficios,
  useSegurosVida,
  diasUteisNoIntervalo,
  custoDoDia,
} from "@/lib/custos";

export const Route = createFileRoute("/_authenticated/relatorios")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const roles = (data ?? []).map((r) => r.role);
    if (!roles.includes("gerente") && !roles.includes("diretor")) {
      throw redirect({ to: "/funcionarios" });
    }
  },
  component: RelatoriosPage,
});

type FuncRow = {
  id: string;
  nome: string;
  categoria_mo: string;
  ativo: boolean;
  salario: number | null;
};
type TipoMaoObra = "montagem" | "civil" | "indireta" | null;
type AlocRow = {
  funcionario_id: string;
  obra_id: string;
  data: string;
  tipo_mao_obra: TipoMaoObra;
};
type RegRow = {
  funcionario_id: string;
  obra_id: string;
  data: string;
  horas_normais: number;
  horas_extras: number;
  ausencia: boolean;
};
type ObraRow = { id: string; nome: string };

function payrollRange(year: number, month: number) {
  // Folha: dia 25 do mês anterior até dia 24 do mês selecionado
  const start = new Date(year, month - 1, 25);
  const end = new Date(year, month, 24);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end), startDate: start, endDate: end };
}

async function fetchAll<T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
) {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function tipoPorAlocacao(
  alocacao: AlocRow,
  funcionario: FuncRow,
  categorias: Parameters<typeof tipoCategoria>[1],
) {
  if (alocacao.tipo_mao_obra === "montagem" || alocacao.tipo_mao_obra === "civil") return "MOD";
  if (alocacao.tipo_mao_obra === "indireta") return "MOI";
  return tipoCategoria(funcionario.categoria_mo, categorias) ?? "MOD";
}

function RelatoriosPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const { data: beneficios } = useBeneficios();
  const { data: segurosVida } = useSegurosVida();
  const { data: categorias } = useCategorias();

  const { data: funcionarios, isLoading: lf } = useQuery({
    queryKey: ["funcionarios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios_safe" as unknown as "funcionarios")
        .select("id,nome,categoria_mo,ativo,salario")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as FuncRow[];
    },
  });

  const { data: obras } = useQuery({
    queryKey: ["obras"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obras").select("id,nome").order("nome");
      if (error) throw error;
      return (data ?? []) as ObraRow[];
    },
  });

  const { start, end, startDate, endDate } = payrollRange(year, month);

  const { data: alocacoes, isLoading: la } = useQuery({
    queryKey: ["alocacoes-mes", start, end],
    queryFn: async () =>
      fetchAll<AlocRow>((from, to) =>
        supabase
          .from("alocacoes")
          .select("funcionario_id,obra_id,data,tipo_mao_obra" as never)
          .gte("data", start)
          .lte("data", end)
          .order("data", { ascending: true })
          .range(from, to),
      ),
  });

  const { data: registros, isLoading: lr } = useQuery({
    queryKey: ["registros-mes", start, end],
    queryFn: async () =>
      fetchAll<RegRow>((from, to) =>
        supabase
          .from("registros_horas")
          .select("funcionario_id,obra_id,data,horas_normais,horas_extras,ausencia")
          .gte("data", start)
          .lte("data", end)
          .order("data", { ascending: true })
          .range(from, to),
      ),
  });

  const custoPorFunc = useMemo(() => {
    const m = new Map<string, ReturnType<typeof calcularCusto>>();
    for (const f of funcionarios ?? []) {
      m.set(
        f.id,
        calcularCusto(f.salario, beneficios ?? null, segurosVida?.get(f.categoria_mo) ?? 0),
      );
    }
    return m;
  }, [funcionarios, beneficios, segurosVida]);

  const diasUteis = useMemo(() => diasUteisNoIntervalo(startDate, endDate), [startDate, endDate]);

  const resultadoObras = useMemo(() => {
    const obraMap = new Map((obras ?? []).map((o) => [o.id, o.nome]));
    const funcMap = new Map((funcionarios ?? []).map((f) => [f.id, f]));
    const acc = new Map<
      string,
      { nome: string; mod: number; moi: number; total: number; funcs: Set<string> }
    >();
    const avisos = new Set<string>();

    const regIndex = new Map<string, RegRow>();
    for (const r of registros ?? []) {
      regIndex.set(`${r.funcionario_id}|${r.obra_id}|${r.data}`, r);
    }

    for (const a of alocacoes ?? []) {
      const func = funcMap.get(a.funcionario_id);
      if (!func) {
        avisos.add("Ha alocacoes sem funcionario correspondente carregado no relatorio.");
        continue;
      }
      const custo = custoPorFunc.get(a.funcionario_id);
      if (!custo || custo.total <= 0) {
        avisos.add("Ha alocacoes com funcionario sem custo mensal calculado.");
        continue;
      }

      const reg = regIndex.get(`${a.funcionario_id}|${a.obra_id}|${a.data}`);
      if (!reg) {
        avisos.add(
          "Ha alocacoes sem registro de horas correspondente; foi usada a jornada padrao do dia.",
        );
      } else if (
        !reg.ausencia &&
        Number(reg.horas_normais || 0) + Number(reg.horas_extras || 0) <= 0
      ) {
        avisos.add("Ha registros de horas sem horas normais/extras; essas linhas nao geram custo.");
      }
      if (!a.tipo_mao_obra) {
        avisos.add(
          "Ha alocacoes sem tipo de mao de obra; foi usado o tipo padrao da categoria ou MOD como fallback.",
        );
      }

      const valor = custoDoDia({
        custoMensal: custo.total,
        diasUteis,
        dataISO: a.data,
        horasNormais: reg?.horas_normais ?? null,
        horasExtras: reg?.horas_extras ?? null,
        ausencia: reg?.ausencia ?? null,
      });
      if (valor <= 0) continue;

      const tipo = tipoPorAlocacao(a, func, categorias);
      const e = acc.get(a.obra_id) ?? {
        nome: obraMap.get(a.obra_id) ?? "-",
        mod: 0,
        moi: 0,
        total: 0,
        funcs: new Set<string>(),
      };
      if (tipo === "MOI") e.moi += valor;
      else e.mod += valor;
      e.total += valor;
      e.funcs.add(a.funcionario_id);
      acc.set(a.obra_id, e);
    }

    const obrasComCusto = Array.from(acc.entries())
      .map(([id, v]) => ({
        id,
        nome: v.nome,
        mod: v.mod,
        moi: v.moi,
        total: v.total,
        funcs: v.funcs.size,
      }))
      .sort((a, b) => b.total - a.total);
    return { obrasComCusto, avisos: Array.from(avisos) };
  }, [alocacoes, registros, custoPorFunc, funcionarios, categorias, obras, diasUteis]);

  const obrasComCusto = resultadoObras.obrasComCusto;
  const avisosObras = resultadoObras.avisos;

  const totaisObra = useMemo(
    () =>
      obrasComCusto.reduce(
        (acc, o) => ({ mod: acc.mod + o.mod, moi: acc.moi + o.moi, total: acc.total + o.total }),
        { mod: 0, moi: 0, total: 0 },
      ),
    [obrasComCusto],
  );

  const funcIdsComLancamento = useMemo(() => {
    const s = new Set<string>();
    for (const a of alocacoes ?? []) s.add(a.funcionario_id);
    for (const r of registros ?? []) s.add(r.funcionario_id);
    return s;
  }, [alocacoes, registros]);
  // Mostra ativos + inativos com lançamentos no período (custos pagos mesmo após desligamento).
  const ativos = (funcionarios ?? []).filter((f) => f.ativo || funcIdsComLancamento.has(f.id));
  const totalFolhaAtiva = ativos.reduce((s, f) => s + (custoPorFunc.get(f.id)?.total ?? 0), 0);

  const mesLabel = new Date(year, month, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  const periodoLabel = `${startDate.toLocaleDateString("pt-BR")} a ${endDate.toLocaleDateString("pt-BR")}`;

  function nav(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  const loading = lf || la || lr;

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Custos consolidados de mão de obra por funcionário e por obra."
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

      <Tabs defaultValue="funcionarios" className="space-y-4">
        <TabsList>
          <TabsTrigger value="funcionarios">Custo por funcionário</TabsTrigger>
          <TabsTrigger value="obras">Custo por obra</TabsTrigger>
        </TabsList>

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
                <Table>
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
                      <TableHead className="text-right">Benefícios</TableHead>
                      <TableHead className="text-right">Seguro vida</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ativos.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
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
                              <div className="flex items-center gap-2">
                                <span>{f.nome}</span>
                                {!f.ativo && (
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                    Inativo
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{f.categoria_mo}</TableCell>
                            <TableCell>{tipo && <Badge variant="outline">{tipo}</Badge>}</TableCell>
                            <TableCell className="text-right">{fmtBRL(c.salario)}</TableCell>
                            <TableCell className="text-right">{fmtBRL(c.encargos)}</TableCell>
                            <TableCell className="text-right">{fmtBRL(c.prov13)}</TableCell>
                            <TableCell className="text-right">
                              {fmtBRL(c.provAvisoPrevio)}
                            </TableCell>
                            <TableCell className="text-right">{fmtBRL(c.provFerias)}</TableCell>
                            <TableCell className="text-right">{fmtBRL(c.beneficios)}</TableCell>
                            <TableCell className="text-right">{fmtBRL(c.seguroVida)}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {fmtBRL(c.total)}
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="obras">
          <Card>
            <CardHeader>
              <CardTitle>
                Custo de mão de obra por obra — {mesLabel}{" "}
                <span className="text-sm font-normal text-muted-foreground">({periodoLabel})</span>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Custo proporcional: (custo mensal ÷ {diasUteis} dias úteis) × dias alocados, com
                horas extras (1,5×) somadas quando registradas.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
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
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Obra</TableHead>
                        <TableHead className="text-right">MOD</TableHead>
                        <TableHead className="text-right">MOI</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {obrasComCusto.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                            Nenhuma alocação no mês.
                          </TableCell>
                        </TableRow>
                      ) : (
                        obrasComCusto.map((o) => (
                          <TableRow key={o.id}>
                            <TableCell className="font-medium">{o.nome}</TableCell>
                            <TableCell className="text-right">{fmtBRL(o.mod)}</TableCell>
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
                        <TableCell className="text-right font-medium">
                          {fmtBRL(totaisObra.mod)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {fmtBRL(totaisObra.moi)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {fmtBRL(totaisObra.total)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
