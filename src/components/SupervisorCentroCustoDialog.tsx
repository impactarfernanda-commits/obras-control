import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, History } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SUPERVISOR_CC_DATA_CORTE } from "@/lib/supervisor-cc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Vigencia = {
  id: string;
  obra_id: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  origem: string;
  observacao: string | null;
};

export function SupervisorCentroCustoDialog({
  funcionario,
  obras,
  podeTransferir,
}: {
  funcionario: { id: string; nome: string };
  obras: Array<{ id: string; nome: string }>;
  podeTransferir: boolean;
}) {
  const qc = useQueryClient();
  const [transferirOpen, setTransferirOpen] = useState(false);
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [obraId, setObraId] = useState("");
  const [data, setData] = useState(SUPERVISOR_CC_DATA_CORTE);
  const [observacao, setObservacao] = useState("");
  const { data: vigencias = [] } = useQuery({
    queryKey: ["supervisor-cc-vigencias", funcionario.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionario_cc_vigencias" as never)
        .select("id,obra_id,vigencia_inicio,vigencia_fim,origem,observacao" as never)
        .eq("funcionario_id" as never, funcionario.id as never)
        .order("vigencia_inicio" as never, { ascending: false });
      if (error) throw error;
      return data as unknown as Vigencia[];
    },
  });
  const hoje = new Date().toISOString().slice(0, 10);
  const atual =
    vigencias.find(
      (v) => v.vigencia_inicio <= hoje && (!v.vigencia_fim || v.vigencia_fim >= hoje),
    ) ?? vigencias[0];
  const obraNome = new Map(obras.map((obra) => [obra.id, obra.nome]));
  const mutation = useMutation({
    mutationFn: async () => {
      if (!obraId || !data)
        throw new Error("Informe o novo centro de custo e a data da transferência.");
      const { error } = await supabase.rpc(
        "transferir_supervisor_centro_custo" as never,
        {
          p_funcionario_id: funcionario.id,
          p_novo_obra_id: obraId,
          p_data_transferencia: data,
          p_observacao: observacao || null,
        } as never,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Centro de custo do Supervisor atualizado.");
      setTransferirOpen(false);
      setObraId("");
      setObservacao("");
      qc.invalidateQueries({ queryKey: ["supervisor-cc-vigencias", funcionario.id] });
      qc.invalidateQueries({ queryKey: ["relatorio-centros-custo"] });
      qc.invalidateQueries({ queryKey: ["relatorio-sem-alocacao"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="flex min-w-[220px] items-center gap-1">
      <div className="mr-1 min-w-0 flex-1 text-sm">
        <div className="truncate">
          {atual ? (
            (obraNome.get(atual.obra_id) ?? "CC não encontrado")
          ) : (
            <span className="text-destructive">Sem vigência</span>
          )}
        </div>
        {atual && (
          <div className="text-[10px] text-muted-foreground">
            Desde {new Date(atual.vigencia_inicio + "T00:00:00").toLocaleDateString("pt-BR")}
          </div>
        )}
      </div>
      {podeTransferir && (
        <Dialog open={transferirOpen} onOpenChange={setTransferirOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Transferir centro de custo">
              <ArrowRightLeft className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Transferir centro de custo</DialogTitle>
              <DialogDescription>
                {funcionario.nome}. A vigência anterior será encerrada automaticamente no dia
                anterior.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Novo centro de custo</Label>
                <Select value={obraId} onValueChange={setObraId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {obras.map((obra) => (
                      <SelectItem key={obra.id} value={obra.id}>
                        {obra.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data da transferência</Label>
                <Input
                  type="date"
                  min={SUPERVISOR_CC_DATA_CORTE}
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Observação (opcional)</Label>
                <Input
                  maxLength={1000}
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? "Transferindo..." : "Transferir"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={historicoOpen} onOpenChange={setHistoricoOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Histórico de centros de custo">
            <History className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Histórico de centro de custo</DialogTitle>
            <DialogDescription>{funcionario.nome}</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CC</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Fim</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Observação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vigencias.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{obraNome.get(v.obra_id) ?? "—"}</TableCell>
                  <TableCell>{v.vigencia_inicio}</TableCell>
                  <TableCell>{v.vigencia_fim ?? "Vigente"}</TableCell>
                  <TableCell>{v.origem}</TableCell>
                  <TableCell>{v.observacao ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </div>
  );
}
