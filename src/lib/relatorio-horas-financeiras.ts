import { categoriaEhSupervisor } from "./funcionario-categoria.ts";

export type ApuracaoHorasFinanceiras = {
  horasNormaisApuradas: number;
  horasExtra50Apuradas: number;
  horasExtra100Apuradas: number;
  horasSemAdicionalHeApuradas?: number;
};

export function normalizarApuracaoHorasFinanceiras(
  categoria: string | null | undefined,
  apuracao: ApuracaoHorasFinanceiras,
) {
  const horasSemAdicionalHeApuradas = apuracao.horasSemAdicionalHeApuradas ?? 0;
  if (!categoriaEhSupervisor(categoria)) {
    return { ...apuracao, horasSemAdicionalHeApuradas };
  }

  return {
    horasNormaisApuradas: apuracao.horasNormaisApuradas,
    horasExtra50Apuradas: 0,
    horasExtra100Apuradas: 0,
    horasSemAdicionalHeApuradas:
      horasSemAdicionalHeApuradas + apuracao.horasExtra50Apuradas + apuracao.horasExtra100Apuradas,
  };
}
