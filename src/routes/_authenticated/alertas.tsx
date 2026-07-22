import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, Play } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { triggerAlertChecks } from "@/lib/alertas.functions";

export const Route = createFileRoute("/_authenticated/alertas")({ component: AlertasPage });

type Notificacao = {
  id: string;
  user_id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  severidade: "info" | "warning" | "critical";
  metadata: Record<string, unknown>;
  lida: boolean;
  resolvida: boolean;
  resolvida_em: string | null;
  created_at: string;
};

const TIPO_LABEL: Record<string, string> = {
  sem_alocacao: "Sem alocação",
  horas_extras: "Horas extras",
  custo_acima_media: "Custo elevado",
  ausencia_consecutiva: "Ausência prolongada",
  obra_sem_lancamento: "Centro de custo sem lançamento",
};

const sevColor: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  critical: "bg-red-500/10 text-red-700 dark:text-red-300",
};

const SevIcon = ({ s }: { s: string }) => {
  if (s === "critical") return <AlertCircle className="h-4 w-4 text-red-500" />;
  if (s === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <Info className="h-4 w-4 text-blue-500" />;
};

function AlertasPage() {
  const { isManagerOrAbove, user } = useAuth();
  const qc = useQueryClient();
  const trigger = useServerFn(triggerAlertChecks);

  const [tipo, setTipo] = useState<string>("todos");
  const [severidade, setSeveridade] = useState<string>("todas");
  const [status, setStatus] = useState<string>("ativos");
  const [periodo, setPeriodo] = useState<string>("30");


  const { data: notifs, isLoading } = useQuery({
    queryKey: ["alertas-all", periodo],
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - Number(periodo));
      const { data, error } = await supabase
        .from("notificacoes")
        .select("*")
        .gte("created_at", desde.toISOString())
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      // dedupe per dedupe_key (cada usuario recebe copia)
      const seen = new Set<string>();
      const out: Notificacao[] = [];
      for (const r of (data ?? []) as (Notificacao & { dedupe_key: string | null })[]) {
        const key = r.dedupe_key ?? r.id;
        const dedupGlobal = key.split(":").slice(1).join(":") || key;
        if (seen.has(dedupGlobal)) continue;
        seen.add(dedupGlobal);
        out.push(r);
      }
      return out;
    },
  });

  const filtered = useMemo(() => {
    let r = notifs ?? [];
    if (tipo !== "todos") r = r.filter((n) => n.tipo === tipo);
    if (severidade !== "todas") r = r.filter((n) => n.severidade === severidade);
    if (status === "ativos") r = r.filter((n) => !n.resolvida);
    if (status === "resolvidos") r = r.filter((n) => n.resolvida);
    return r;
  }, [notifs, tipo, severidade, status]);

  const kpis = useMemo(() => {
    const ativos = (notifs ?? []).filter((n) => !n.resolvida).length;
    const criticos = (notifs ?? []).filter((n) => !n.resolvida && n.severidade === "critical").length;
    const mesIni = new Date();
    mesIni.setDate(1);
    const resolvidosMes = (notifs ?? []).filter(
      (n) => n.resolvida && n.resolvida_em && new Date(n.resolvida_em) >= mesIni
    ).length;
    const total = notifs?.length ?? 0;
    const taxa = total > 0 ? ((notifs!.filter((n) => n.resolvida).length / total) * 100).toFixed(0) : "0";
    return { ativos, criticos, resolvidosMes, taxa };
  }, [notifs]);

  const porTipo = useMemo(() => {
    const acc = new Map<string, number>();
    for (const n of notifs ?? []) acc.set(n.tipo, (acc.get(n.tipo) ?? 0) + 1);
    return [...acc.entries()].map(([k, v]) => ({ tipo: TIPO_LABEL[k] ?? k, total: v }));
  }, [notifs]);

  const porDia = useMemo(() => {
    const acc = new Map<string, number>();
    for (const n of notifs ?? []) {
      const d = n.created_at.slice(0, 10);
      acc.set(d, (acc.get(d) ?? 0) + 1);
    }
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, total]) => ({ dia: d.slice(5), total }));
  }, [notifs]);

  const resolverMut = useMutation({
    mutationFn: async (n: Notificacao) => {
      // resolve para todos os usuários com mesma dedupe_key base
      const { data: row } = await supabase.from("notificacoes").select("dedupe_key").eq("id", n.id).maybeSingle();
      const dk = row?.dedupe_key as string | null;
      if (dk) {
        const base = dk.split(":").slice(1).join(":");
        await supabase
          .from("notificacoes")
          .update({ resolvida: true, resolvida_por: user!.id, resolvida_em: new Date().toISOString() })
          .like("dedupe_key", `%:${base}`);
      } else {
        await supabase
          .from("notificacoes")
          .update({ resolvida: true, resolvida_por: user!.id, resolvida_em: new Date().toISOString() })
          .eq("id", n.id);
      }
    },
    onSuccess: () => {
      toast.success("Alerta resolvido");
      qc.invalidateQueries({ queryKey: ["alertas-all"] });
    },
  });

  const runMut = useMutation({
    mutationFn: () => trigger(),
    onSuccess: (r) => {
      toast.success(`Verificação concluída: ${r.alerts} alertas processados`);
      qc.invalidateQueries({ queryKey: ["alertas-all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isManagerOrAbove) {
    return (
      <div className="space-y-4">
        <PageHeader title="Alertas" description="Acesso restrito a gerentes e diretores." />
      </div>
    );
  }


  return (
    <div className="space-y-4">
      <PageHeader
        title="Alertas"
        description="Histórico, frequência e resolução dos alertas do sistema."
        actions={
          <Button onClick={() => runMut.mutate()} disabled={runMut.isPending}>
            <Play className="mr-2 h-4 w-4" /> Verificar agora
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Ativos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.ativos}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-red-600">Críticos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.criticos}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Resolvidos (mês)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.resolvidosMes}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Taxa de resolução</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{kpis.taxa}%</div></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Alertas por tipo</CardTitle></CardHeader>
          <CardContent style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={porTipo}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="tipo" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Evolução por dia</CardTitle></CardHeader>
          <CardContent style={{ height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={porDia}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dia" />
                <YAxis />
                <Tooltip />
                <Line dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground">Tipo</label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {Object.entries(TIPO_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Severidade</label>
            <Select value={severidade} onValueChange={setSeveridade}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativos">Ativos</SelectItem>
                <SelectItem value="resolvidos">Resolvidos</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Período (dias)</label>
            <Input type="number" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Alertas ({filtered.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sev.</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum alerta</TableCell></TableRow>
                  ) : (
                    filtered.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell><SevIcon s={n.severidade} /></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={sevColor[n.severidade]}>
                            {TIPO_LABEL[n.tipo] ?? n.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{n.titulo}</div>
                          <div className="text-xs text-muted-foreground">{n.mensagem}</div>
                        </TableCell>
                        <TableCell className="text-xs">{new Date(n.created_at).toLocaleString("pt-BR")}</TableCell>
                        <TableCell>
                          {n.resolvida ? (
                            <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Resolvido</Badge>
                          ) : (
                            <Badge variant="outline">Ativo</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {!n.resolvida && (
                            <Button size="sm" variant="outline" onClick={() => resolverMut.mutate(n)}>
                              Resolver
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
