interface ExecutarHookAlertasInput<T> {
  authorization: string | null;
  segredoEsperado: string | undefined;
  executar: () => Promise<T>;
}

type ResultadoHookAlertas<T> = { autorizado: false } | { autorizado: true; resultado: T };

function segredoValido(authorization: string | null, segredoEsperado: string | undefined) {
  if (!segredoEsperado) return false;
  return authorization === `Bearer ${segredoEsperado}`;
}

export async function executarHookAlertasAutorizado<T>({
  authorization,
  segredoEsperado,
  executar,
}: ExecutarHookAlertasInput<T>): Promise<ResultadoHookAlertas<T>> {
  if (!segredoValido(authorization, segredoEsperado)) {
    return { autorizado: false };
  }

  return { autorizado: true, resultado: await executar() };
}
