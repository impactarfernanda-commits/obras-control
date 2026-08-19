import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { filtrarFuncionariosBusca, type FuncionarioBusca } from "@/lib/funcionario-busca";
import { cn } from "@/lib/utils";

type Props<T extends FuncionarioBusca> = {
  funcionarios: readonly T[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  formatLabel: (funcionario: T) => string;
  disabled?: boolean;
  className?: string;
};

export function FuncionarioSearchSelect<T extends FuncionarioBusca>({
  funcionarios,
  value,
  onValueChange,
  placeholder = "Selecione",
  searchPlaceholder = "Buscar funcionário...",
  emptyMessage = "Nenhum funcionário encontrado.",
  formatLabel,
  disabled,
  className,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [termo, setTermo] = useState("");
  const selecionado = funcionarios.find((funcionario) => funcionario.id === value);
  const filtrados = useMemo(
    () => filtrarFuncionariosBusca(funcionarios, termo),
    [funcionarios, termo],
  );

  function alterarAbertura(aberto: boolean) {
    setOpen(aberto);
    if (!aberto) setTermo("");
  }

  return (
    <Popover open={open} onOpenChange={alterarAbertura}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate text-left">
            {selecionado ? formatLabel(selecionado) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={termo} onValueChange={setTermo} placeholder={searchPlaceholder} />
          <CommandList>
            {filtrados.length === 0 && <CommandEmpty>{emptyMessage}</CommandEmpty>}
            {filtrados.map((funcionario) => (
              <CommandItem
                key={funcionario.id}
                value={funcionario.id}
                onSelect={() => {
                  onValueChange(funcionario.id);
                  alterarAbertura(false);
                }}
              >
                <Check
                  className={cn("h-4 w-4", value === funcionario.id ? "opacity-100" : "opacity-0")}
                />
                <span>{formatLabel(funcionario)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
