import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/notificacoes-config")({ component: ConfigPage });

const TIPOS = [
  { key: "sem_alocacao", label: "Funcionário sem alocação no último mês" },
  { key: "horas_extras", label: "Horas extras acima do limite semanal" },
  { key: "custo_acima_media", label: "Custos mensais acima da média histórica" },
  { key: "ausencia_consecutiva", label: "Ausências consecutivas prolongadas" },
  { key: "obra_sem_lancamento", label: "Obra sem lançamentos recentes" },
];

const DEFAULTS = {
  tipos_ativos: {
    sem_alocacao: true,
    horas_extras: true,
    custo_acima_media: true,
    ausencia_consecutiva: true,
    obra_sem_lancamento: true,
  } as Record<string, boolean>,
  thresholds: {
    horas_extras_semanal: 15,
    pct_acima_media: 120,
    dias_ausencia: 5,
    dias_sem_lancamento: 3,
    dias_sem_alocacao: 30,
  } as Record<string, number>,
  frequencia_email: "realtime",
};

function ConfigPage() {
  const { user } = useAuth();
  const [tipos, setTipos] = useState(DEFAULTS.tipos_ativos);
  const [thr, setThr] = useState(DEFAULTS.thresholds);
  const [freq, setFreq] = useState(DEFAULTS.frequencia_email);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("notificacao_config")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setTipos({ ...DEFAULTS.tipos_ativos, ...(data.tipos_ativos as Record<string, boolean>) });
        setThr({ ...DEFAULTS.thresholds, ...(data.thresholds as Record<string, number>) });
        setFreq(data.frequencia_email);
      }
      setLoading(false);
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("notificacao_config").upsert({
      user_id: user.id,
      tipos_ativos: tipos,
      thresholds: thr,
      frequencia_email: freq,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Preferências salvas");
  };

  if (loading) return <div>Carregando...</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Notificações" description="Personalize quais alertas deseja receber." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tipos de alerta</CardTitle>
          <CardDescription>Ative ou desative cada categoria.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TIPOS.map((t) => (
            <div key={t.key} className="flex items-center justify-between gap-3">
              <Label htmlFor={t.key} className="font-normal">{t.label}</Label>
              <Switch
                id={t.key}
                checked={tipos[t.key] ?? true}
                onCheckedChange={(v) => setTipos({ ...tipos, [t.key]: v })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Limites personalizados</CardTitle>
          <CardDescription>Ajuste os thresholds que disparam alertas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Horas extras semanais (h)</Label>
            <Input type="number" value={thr.horas_extras_semanal}
              onChange={(e) => setThr({ ...thr, horas_extras_semanal: Number(e.target.value) })} />
          </div>
          <div>
            <Label>% acima da média de custos</Label>
            <Input type="number" value={thr.pct_acima_media}
              onChange={(e) => setThr({ ...thr, pct_acima_media: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Dias consecutivos de ausência</Label>
            <Input type="number" value={thr.dias_ausencia}
              onChange={(e) => setThr({ ...thr, dias_ausencia: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Dias sem lançamento (obra)</Label>
            <Input type="number" value={thr.dias_sem_lancamento}
              onChange={(e) => setThr({ ...thr, dias_sem_lancamento: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Dias sem alocação (funcionário)</Label>
            <Input type="number" value={thr.dias_sem_alocacao}
              onChange={(e) => setThr({ ...thr, dias_sem_alocacao: Number(e.target.value) })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frequência de email</CardTitle>
          <CardDescription>Envio por email — em breve.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={freq} onValueChange={setFreq} disabled>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="realtime">Tempo real</SelectItem>
              <SelectItem value="diario">Diário</SelectItem>
              <SelectItem value="semanal">Semanal</SelectItem>
              <SelectItem value="desativado">Desativado</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar preferências"}</Button>
    </div>
  );
}
