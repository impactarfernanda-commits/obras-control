import { formatDecimalHours } from "./formatacao-horas.ts";
import { classificarHorasPorData, type ClassificacaoHoras } from "./horas-extras.ts";

export type TipoHoraVisual = "normal" | "he50" | "he100" | "sem_he" | "noturna";

export type DetalheJornadaVisual = {
  minutos_normais: number;
  minutos_he_50: number;
  minutos_he_100: number;
  minutos_sem_adicional_he: number;
  minutos_noturnos_reais: number;
  minutos_noturnos_remuneraveis: number;
  minutos_noturnos_normais_remuneraveis?: number;
  minutos_noturnos_he_50_remuneraveis?: number;
  minutos_noturnos_he_100_remuneraveis?: number;
  minutos_noturnos_sem_adicional_he_remuneraveis?: number;
  jornada_excepcional?: boolean;
};

export type LinhaHoraVisual = {
  tipo: TipoHoraVisual;
  horas: number;
  texto: string;
};

export type ComposicaoHorasVisual = ClassificacaoHoras & {
  total: number;
  linhas: LinhaHoraVisual[];
  destaque: TipoHoraVisual | "vazio";
  horasSemAdicionalHe: number;
  horasNoturnasReais: number;
  horasNoturnasRemuneraveis: number;
  jornadaExcepcional: boolean;
};

export function comporHorasParaVisualizacao(input: {
  data: string;
  horasNormais: number | null | undefined;
  horasExtras: number | null | undefined;
  feriado?: boolean;
  detalhe?: DetalheJornadaVisual | null;
}): ComposicaoHorasVisual {
  const classificacao = input.detalhe
    ? {
        horasNormaisApuradas: Number(input.detalhe.minutos_normais) / 60,
        horasExtra50Apuradas: Number(input.detalhe.minutos_he_50) / 60,
        horasExtra100Apuradas: Number(input.detalhe.minutos_he_100) / 60,
      }
    : classificarHorasPorData(input);
  const horasSemAdicionalHe = Number(input.detalhe?.minutos_sem_adicional_he ?? 0) / 60;
  const horasNoturnasReais = Number(input.detalhe?.minutos_noturnos_reais ?? 0) / 60;
  const horasNoturnasRemuneraveis = Number(input.detalhe?.minutos_noturnos_remuneraveis ?? 0) / 60;
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
  if (horasSemAdicionalHe > 0) {
    linhas.push({
      tipo: "sem_he",
      horas: horasSemAdicionalHe,
      texto: `${formatDecimalHours(horasSemAdicionalHe)}h trabalhadas sem adicional de HE`,
    });
  }
  if (horasNoturnasRemuneraveis > 0) {
    linhas.push({
      tipo: "noturna",
      horas: horasNoturnasRemuneraveis,
      texto: `${formatDecimalHours(horasNoturnasRemuneraveis)}h noturnas remuneráveis`,
    });
  }

  const total =
    classificacao.horasNormaisApuradas +
    classificacao.horasExtra50Apuradas +
    classificacao.horasExtra100Apuradas +
    horasSemAdicionalHe;

  return {
    ...classificacao,
    total,
    horasSemAdicionalHe,
    horasNoturnasReais,
    horasNoturnasRemuneraveis,
    jornadaExcepcional: Boolean(input.detalhe?.jornada_excepcional),
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
