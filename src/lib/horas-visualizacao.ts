import { formatDecimalHours } from "./formatacao-horas.ts";
import { classificarHorasPorData, type ClassificacaoHoras } from "./horas-extras.ts";

export type TipoHoraVisual = "normal" | "he50" | "he100";

export type LinhaHoraVisual = {
  tipo: TipoHoraVisual;
  horas: number;
  texto: string;
};

export type ComposicaoHorasVisual = ClassificacaoHoras & {
  total: number;
  linhas: LinhaHoraVisual[];
  destaque: TipoHoraVisual | "vazio";
};

export function comporHorasParaVisualizacao(input: {
  data: string;
  horasNormais: number | null | undefined;
  horasExtras: number | null | undefined;
  feriado?: boolean;
}): ComposicaoHorasVisual {
  const classificacao = classificarHorasPorData(input);
  const linhas: LinhaHoraVisual[] = [];

  if (classificacao.horasNormaisApuradas > 0) {
    linhas.push({
      tipo: "normal",
      horas: classificacao.horasNormaisApuradas,
      texto: `${formatDecimalHours(classificacao.horasNormaisApuradas)}h normais`,
    });
  }
  if (classificacao.horasExtra50Apuradas > 0) {
    linhas.push({
      tipo: "he50",
      horas: classificacao.horasExtra50Apuradas,
      texto: `${formatDecimalHours(classificacao.horasExtra50Apuradas)}h HE 50%`,
    });
  }
  if (classificacao.horasExtra100Apuradas > 0) {
    linhas.push({
      tipo: "he100",
      horas: classificacao.horasExtra100Apuradas,
      texto: `${formatDecimalHours(classificacao.horasExtra100Apuradas)}h HE 100%`,
    });
  }

  const total =
    classificacao.horasNormaisApuradas +
    classificacao.horasExtra50Apuradas +
    classificacao.horasExtra100Apuradas;

  return {
    ...classificacao,
    total,
    linhas,
    destaque:
      classificacao.horasExtra100Apuradas > 0
        ? "he100"
        : classificacao.horasExtra50Apuradas > 0
          ? "he50"
          : classificacao.horasNormaisApuradas > 0
            ? "normal"
            : "vazio",
  };
}
