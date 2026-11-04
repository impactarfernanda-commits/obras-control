import { buscarTodasPaginas } from "./paginacao.ts";

type RespostaPagina = { data: unknown; error: unknown };

export function buscarDetalhesHorasPaginados<T>(
  criarConsulta: (inicio: number, fim: number) => PromiseLike<RespostaPagina>,
) {
  return buscarTodasPaginas<T>(async (inicio, fim) => {
    const resposta = await criarConsulta(inicio, fim);
    if (resposta.error) throw resposta.error;
    if (!Array.isArray(resposta.data))
      throw new Error("Resposta paginada de detalhes de horas incompleta.");
    return { data: resposta.data, error: null };
  });
}

type DetalheAgregavel = {
  minutos_normais: number;
  minutos_he_50: number;
  minutos_he_100: number;
  minutos_sem_adicional_he: number;
  minutos_noturnos_reais: number;
  minutos_noturnos_remuneraveis: number;
  jornada_excepcional?: boolean;
};

const CAMPOS_MINUTOS = [
  "minutos_normais",
  "minutos_he_50",
  "minutos_he_100",
  "minutos_sem_adicional_he",
  "minutos_noturnos_reais",
  "minutos_noturnos_remuneraveis",
] as const;

function agregar(detalhes: DetalheAgregavel[]) {
  const minutos = Object.fromEntries(CAMPOS_MINUTOS.map((campo) => [campo, 0])) as Record<
    (typeof CAMPOS_MINUTOS)[number],
    number
  >;
  let jornadasExcepcionais = 0;
  for (const detalhe of detalhes) {
    for (const campo of CAMPOS_MINUTOS) minutos[campo] += Number(detalhe[campo] ?? 0);
    if (detalhe.jornada_excepcional === true) jornadasExcepcionais += 1;
  }
  return { quantidade: detalhes.length, minutos, jornadasExcepcionais };
}

export function compararCompletudeDetalhesAgregada(
  consultaUnica: DetalheAgregavel[],
  consultaPaginada: DetalheAgregavel[],
) {
  const antes = agregar(consultaUnica);
  const depois = agregar(consultaPaginada);
  const diferencasMinutos = Object.fromEntries(
    CAMPOS_MINUTOS.map((campo) => [campo, depois.minutos[campo] - antes.minutos[campo]]),
  ) as Record<(typeof CAMPOS_MINUTOS)[number], number>;
  return {
    detalhesConsultaUnica: antes.quantidade,
    detalhesConsultaPaginada: depois.quantidade,
    detalhesAdicionais: depois.quantidade - antes.quantidade,
    diferencasMinutos,
    diferencaJornadasExcepcionais: depois.jornadasExcepcionais - antes.jornadasExcepcionais,
    possivelImpactoFinanceiro: Object.values(diferencasMinutos).some((valor) => valor !== 0),
  };
}
