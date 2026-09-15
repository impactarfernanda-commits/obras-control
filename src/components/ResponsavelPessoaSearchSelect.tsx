import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizarBuscaResponsaveis } from "@/lib/responsaveis-obras";
import { cn } from "@/lib/utils";

export type OpcaoPessoaResponsavel = {
  opcao_id: string;
  pessoa_id: string | null;
  funcionario_id: string | null;
  nome: string;
  tipo: "funcionario" | "manual";
  detalhe: string | null;
};

export function ResponsavelPessoaSearchSelect({
  pessoas,
  value,
  onValueChange,
  onAddManual,
  disabled,
}: {
  pessoas: readonly OpcaoPessoaResponsavel[];
  value: string;
  onValueChange: (value: string) => void;
  onAddManual: (termo: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [termo, setTermo] = useState("");
  const selecionada = pessoas.find((pessoa) => pessoa.opcao_id === value);
  const filtradas = useMemo(() => {
    const busca = normalizarBuscaResponsaveis(termo);
    if (!busca) return pessoas;
    return pessoas.filter((pessoa) => normalizarBuscaResponsaveis(pessoa.nome).includes(busca));
  }, [pessoas, termo]);

  return (
    <Popover
      open={open}
      onOpenChange={(aberto) => {
        setOpen(aberto);
        if (!aberto) setTermo("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selecionada?.nome ?? "Selecione uma pessoa"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={termo}
            onValueChange={setTermo}
            placeholder="Buscar funcionário ou pessoa..."
          />
          <CommandList>
            {filtradas.length === 0 && <CommandEmpty>Nenhuma pessoa encontrada.</CommandEmpty>}
            {filtradas.map((pessoa) => (
              <CommandItem
                key={pessoa.opcao_id}
                value={pessoa.opcao_id}
                onSelect={() => {
                  onValueChange(pessoa.opcao_id);
                  setOpen(false);
                  setTermo("");
                }}
              >
                <Check
                  className={cn("h-4 w-4", value === pessoa.opcao_id ? "opacity-100" : "opacity-0")}
                />
                <span className="min-w-0 truncate">{pessoa.nome}</span>
              </CommandItem>
            ))}
            <CommandItem
              value="__nova_pessoa__"
              onSelect={() => {
                setOpen(false);
                onAddManual(termo);
              }}
            >
              <Plus className="h-4 w-4" />
              Adicionar nova pessoa
            </CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
