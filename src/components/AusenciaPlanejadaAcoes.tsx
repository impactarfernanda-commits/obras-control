import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  editarAusencia,
  excluirAusencia,
  permissoesAusencia,
  obterPeriodoAusencia,
  QUERIES_AUSENCIAS,
  type PeriodoAusencia,
  type AusenciaSelecionada,
} from "@/lib/gestao-ausencia-planejada";
import { rotuloTipoRegistro } from "@/lib/registro-falta";

export function AusenciaPlanejadaAcoes({
  registro,
  nome,
}: {
  registro: AusenciaSelecionada;
  nome: string;
}) {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [periodo, setPeriodo] = useState<PeriodoAusencia | null>(null);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [observacoes, setObservacoes] = useState(registro.observacoes ?? "");
  const permissoes = permissoesAusencia(true, registro, user?.id, role);
  const titulo = rotuloTipoRegistro(registro.tipo_registro);
  const atualizar = async () => {
    await Promise.all(QUERIES_AUSENCIAS.map((key) => qc.invalidateQueries({ queryKey: [key] })));
  };
  const carregarPeriodo = useMutation({
    mutationFn: async () => {
      if (!permissoes.editar) throw new Error("Sem permissão para editar este lançamento.");
      return obterPeriodoAusencia(supabase, registro);
    },
    onSuccess: (resultado) => {
      setPeriodo(resultado);
      setDataInicio(resultado.data_inicio);
      setDataFim(resultado.data_fim);
      setObservacoes(resultado.observacoes ?? "");
      setOpen(true);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const editar = useMutation({
    mutationFn: async () => {
      if (!permissoes.editar) throw new Error("Sem permissão para editar este lançamento.");
      if (!periodo) throw new Error("Carregue o período antes de editar.");
      await editarAusencia(supabase, registro, dataInicio, dataFim, observacoes);
    },
    onSuccess: async () => {
      setOpen(false);
      toast.success("Lançamento atualizado");
      await atualizar();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const excluir = useMutation({
    mutationFn: async () => {
      if (!permissoes.excluir) throw new Error("Sem permissão para excluir este lançamento.");
      return excluirAusencia(supabase, registro, (mensagem) =>
        window.confirm(
          `${titulo} — ${nome} — ${registro.data.split("-").reverse().join("/")}\n\n${mensagem}`,
        ),
      );
    },
    onSuccess: async (excluido) => {
      if (!excluido) return;
      qc.setQueriesData<AusenciaSelecionada[]>({ queryKey: ["registros-mes"] }, (anteriores) =>
        anteriores?.filter((r) => r.id !== registro.id),
      );
      toast.success("Lançamento excluído");
      await atualizar();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const pending = carregarPeriodo.isPending || editar.isPending || excluir.isPending;
  return (
    <>
      {permissoes.editar && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => carregarPeriodo.mutate()}
        >
          Editar
        </Button>
      )}
      {permissoes.excluir && (
        <Button
          size="icon"
          variant="ghost"
          disabled={pending}
          onClick={() => excluir.mutate()}
          aria-label="Excluir lançamento"
          title="Excluir lançamento"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar {titulo}</DialogTitle>
            <DialogDescription>
              {nome}. A alteração se refere ao bloco contínuo de{" "}
              {periodo?.data_inicio.split("-").reverse().join("/")} a{" "}
              {periodo?.data_fim.split("-").reverse().join("/")} ({periodo?.quantidade_dias} dias),
              carregado para este lançamento.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending) editar.mutate();
            }}
          >
            <label className="grid gap-2">
              Data inicial
              <Input
                type="date"
                required
                value={dataInicio}
                disabled={pending}
                onChange={(event) => setDataInicio(event.target.value)}
              />
            </label>
            <label className="mt-4 grid gap-2">
              Data final
              <Input
                type="date"
                required
                min={dataInicio}
                value={dataFim}
                disabled={pending}
                onChange={(event) => setDataFim(event.target.value)}
              />
            </label>
            <label className="mt-4 grid gap-2">
              Observações
              <Textarea
                value={observacoes}
                disabled={pending}
                onChange={(event) => setObservacoes(event.target.value)}
              />
            </label>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={pending || !periodo || !dataInicio || !dataFim || dataFim < dataInicio}
              >
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
