import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { formatarDataCopia, type ResumoCopiaDia } from "@/lib/copiar-dia-anterior";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CopiarDiaAnteriorDialog({
  obraId,
  obraNome,
}: {
  obraId: string;
  obraNome: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [destino, setDestino] = useState(new Date().toISOString().slice(0, 10));
  const [previa, setPrevia] = useState<ResumoCopiaDia | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function buscarPrevia() {
    setCarregando(true);
    setPrevia(null);
    try {
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
      const { data, error } = await supabase.rpc(
        "obras_copiar_dia_anterior" as never,
        {
          p_obra_id: obraId,
          p_data_origem: origem.data,
          p_data_destino: destino,
          p_aplicar: false,
        } as never,
      );
      if (error) throw error;
      setPrevia(data as unknown as ResumoCopiaDia);
    } catch (error) {
      toast.error((error as { message?: string }).message ?? "Erro ao preparar a cópia");
    } finally {
      setCarregando(false);
    }
  }

  async function confirmar() {
    if (!previa) return;
    setCarregando(true);
    try {
      const { data, error } = await supabase.rpc(
        "obras_copiar_dia_anterior" as never,
        {
          p_obra_id: obraId,
          p_data_origem: previa.origem_data,
          p_data_destino: previa.destino_data,
          p_aplicar: true,
        } as never,
      );
      if (error) throw error;
      const resultado = data as unknown as ResumoCopiaDia;
      if (resultado.total_copiados === 0)
        toast.info("Nenhum funcionário para copiar. A equipe do dia já está atualizada.");
      else
        toast.success(
          `${resultado.total_copiados} funcionários copiados de ${formatarDataCopia(resultado.origem_data)} para ${formatarDataCopia(resultado.destino_data)}.`,
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
      toast.error((error as { message?: string }).message ?? "Erro ao copiar equipe");
    } finally {
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
        <Button variant="outline">
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
                    className="flex items-center justify-between gap-2 p-2 text-sm"
                  >
                    <span>{item.nome}</span>
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
