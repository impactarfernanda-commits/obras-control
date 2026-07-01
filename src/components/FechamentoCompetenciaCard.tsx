import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  calcularCompetencia,
  formatarPeriodoCompetencia,
  type FechamentoCompetencia,
} from "@/lib/competencias";

type ErrorLike = { message?: string };
type ProfileRow = { id: string; full_name: string | null };

function fechamentosTable() {
  return supabase.from("fechamentos_competencia" as never);
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

export function FechamentoCompetenciaCard() {
  const qc = useQueryClient();
  const { user, isManagerOrAbove } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [dataReferencia, setDataReferencia] = useState(today);
  const [observacoes, setObservacoes] = useState("");
  const [reabrir, setReabrir] = useState<FechamentoCompetencia | null>(null);
  const [motivo, setMotivo] = useState("");

  const competenciaSelecionada = useMemo(
    () => calcularCompetencia(dataReferencia),
    [dataReferencia],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["fechamentos-competencia"],
    queryFn: async () => {
      const { data: rows, error } = await fechamentosTable()
        .select("*")
        .order("competencia", { ascending: false });
      if (error) throw error;

      const fechamentos = (rows ?? []) as unknown as FechamentoCompetencia[];
      const ids = Array.from(
        new Set(
          fechamentos
            .flatMap((f) => [f.fechado_por, f.reaberto_por])
            .filter((id): id is string => Boolean(id)),
        ),
      );

      if (ids.length === 0) return { fechamentos, profiles: new Map<string, string>() };

      const { data: profilesRows, error: profilesError } = await supabase
        .from("users_profiles")
        .select("id,full_name")
        .in("id", ids);
      if (profilesError) throw profilesError;

      const profiles = new Map<string, string>();
      for (const profile of (profilesRows ?? []) as ProfileRow[]) {
        profiles.set(profile.id, profile.full_name || profile.id);
      }
      return { fechamentos, profiles };
    },
  });

  const fechar = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sessão expirada");
      if (!isManagerOrAbove) throw new Error("Apenas gerente ou diretor pode fechar competência.");

      const payload = {
        ...competenciaSelecionada,
        fechada: true,
        fechado_por: user.id,
        fechado_em: new Date().toISOString(),
        observacoes: observacoes.trim() || null,
      };

      const { error } = await fechamentosTable().upsert(payload as never, {
        onConflict: "competencia",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Competência fechada com sucesso.");
      setObservacoes("");
      qc.invalidateQueries({ queryKey: ["fechamentos-competencia"] });
    },
    onError: (e: ErrorLike) => toast.error(e.message ?? "Erro ao fechar competência"),
  });

  const reabrirMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sessão expirada");
      if (!isManagerOrAbove) throw new Error("Apenas gerente ou diretor pode reabrir competência.");
      const motivoLimpo = motivo.trim();
      if (!motivoLimpo) throw new Error("Informe o motivo da reabertura.");
      if (!reabrir) return;

      const { error } = await fechamentosTable()
        .update({
          fechada: false,
          reaberto_por: user.id,
          reaberto_em: new Date().toISOString(),
          motivo_reabertura: motivoLimpo,
        } as never)
        .eq("id", reabrir.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Competência reaberta com sucesso.");
      setReabrir(null);
      setMotivo("");
      qc.invalidateQueries({ queryKey: ["fechamentos-competencia"] });
    },
    onError: (e: ErrorLike) => toast.error(e.message ?? "Erro ao reabrir competência"),
  });

  const fechamentos = data?.fechamentos ?? [];
  const profiles = data?.profiles ?? new Map<string, string>();

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Fechamento de Competência</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Fechamento global 25–24 para bloquear lançamentos, edições e remoções em todas as obras.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="grid gap-3 md:grid-cols-[180px_1fr_auto] md:items-end">
            <div>
              <Label>Data de referência</Label>
              <Input
                type="date"
                value={dataReferencia}
                onChange={(e) => setDataReferencia(e.target.value)}
              />
            </div>
            <div className="text-sm">
              <div className="font-medium">Competência {competenciaSelecionada.competencia}</div>
              <div className="text-muted-foreground">
                {formatarPeriodoCompetencia(competenciaSelecionada)}
              </div>
              {isManagerOrAbove ? (
                <Textarea
                  className="mt-2"
                  rows={2}
                  placeholder="Observações do fechamento (opcional)"
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                />
              ) : (
                <div className="mt-2 text-xs text-muted-foreground">
                  Fechamento e reabertura disponíveis apenas para gerente e diretor.
                </div>
              )}
            </div>
            {isManagerOrAbove && (
              <Button onClick={() => fechar.mutate()} disabled={fechar.isPending || !user?.id}>
                <Lock className="mr-2 h-4 w-4" />
                {fechar.isPending ? "Fechando..." : "Fechar competência"}
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : fechamentos.length === 0 ? (
          <div className="rounded-md border py-8 text-center text-sm text-muted-foreground">
            Nenhuma competência fechada ou criada ainda.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Competência</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fechamento</TableHead>
                  <TableHead>Reabertura</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Observações</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fechamentos.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.competencia}</TableCell>
                    <TableCell>{formatarPeriodoCompetencia(f)}</TableCell>
                    <TableCell>
                      <Badge variant={f.fechada ? "default" : "outline"}>
                        {f.fechada ? "Fechada" : "Aberta"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        {f.fechado_por ? (profiles.get(f.fechado_por) ?? f.fechado_por) : "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(f.fechado_em)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        {f.reaberto_por ? (profiles.get(f.reaberto_por) ?? f.reaberto_por) : "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(f.reaberto_em)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[220px] whitespace-normal">
                      {f.motivo_reabertura || "—"}
                    </TableCell>
                    <TableCell className="max-w-[220px] whitespace-normal">
                      {f.observacoes || "—"}
                    </TableCell>
                    <TableCell>
                      {isManagerOrAbove && f.fechada && (
                        <Button variant="outline" size="sm" onClick={() => setReabrir(f)}>
                          <Unlock className="mr-2 h-4 w-4" />
                          Reabrir
                        </Button>
                      )}
                      {isManagerOrAbove && !f.fechada && <Badge variant="outline">Aberta</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!reabrir} onOpenChange={(open) => !open && setReabrir(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reabrir competência {reabrir?.competencia}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo da reabertura *</Label>
            <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReabrir(null)}>
              Cancelar
            </Button>
            <Button onClick={() => reabrirMutation.mutate()} disabled={reabrirMutation.isPending}>
              <CalendarCheck className="mr-2 h-4 w-4" />
              {reabrirMutation.isPending ? "Reabrindo..." : "Reabrir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
