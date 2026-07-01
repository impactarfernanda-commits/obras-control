import { useEffect, useState } from "react";
import { Bell, Check, CheckCheck, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  severidade: "info" | "warning" | "critical";
  lida: boolean;
  created_at: string;
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

const sevIcon = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
};

const sevColor = {
  info: "text-blue-500",
  warning: "text-amber-500",
  critical: "text-red-500",
};

export function NotificacoesPopover() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notificacao[]>([]);
  const [open, setOpen] = useState(false);

  const naoLidas = items.filter((i) => !i.lida).length;

  const fetchAll = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notificacoes")
      .select("id, tipo, titulo, mensagem, severidade, lida, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setItems((data ?? []) as Notificacao[]);
  };

  useEffect(() => {
    fetchAll();
    if (!user) return;
    const ch = supabase
      .channel(`notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notificacoes", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as Notificacao;
          setItems((prev) => [n, ...prev].slice(0, 50));
          if (n.severidade === "critical") {
            toast.error(n.titulo, { description: n.mensagem });
          } else if (n.severidade === "warning") {
            toast.warning(n.titulo, { description: n.mensagem });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const marcarLida = async (id: string) => {
    setItems((p) => p.map((i) => (i.id === id ? { ...i, lida: true } : i)));
    await supabase.from("notificacoes").update({ lida: true }).eq("id", id);
  };

  const marcarTodas = async () => {
    if (!user) return;
    setItems((p) => p.map((i) => ({ ...i, lida: true })));
    await supabase.from("notificacoes").update({ lida: true }).eq("user_id", user.id).eq("lida", false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {naoLidas > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 min-w-5 justify-center px-1 text-[10px]"
            >
              {naoLidas > 9 ? "9+" : naoLidas}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="font-semibold text-sm">Notificações</div>
          {naoLidas > 0 && (
            <Button variant="ghost" size="sm" onClick={marcarTodas} className="h-7 text-xs">
              <CheckCheck className="mr-1 h-3 w-3" /> Marcar todas
            </Button>
          )}
        </div>
        <ScrollArea className="h-96">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sem notificações</div>
          ) : (
            <div className="divide-y">
              {items.map((n) => {
                const Icon = sevIcon[n.severidade];
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex gap-3 p-3 hover:bg-muted/50 transition-colors",
                      !n.lida && "bg-muted/30"
                    )}
                  >
                    <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", sevColor[n.severidade])} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm leading-tight">{n.titulo}</div>
                        <div className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.created_at)}</div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{n.mensagem}</div>
                    </div>
                    {!n.lida && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        onClick={() => marcarLida(n.id)}
                        title="Marcar como lida"
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
