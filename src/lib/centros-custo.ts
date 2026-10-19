export function prepararCodigoExibicaoCentroCusto(valor: string): string {
  return valor.trim().toUpperCase().replace(/ {2,}/g, " ");
}

export function normalizarCodigoCentroCusto(valor: string): string {
  return prepararCodigoExibicaoCentroCusto(valor).replace(/[^A-Z0-9]/g, "");
}

export function validarCodigoExibicaoCentroCusto(valor: string): boolean {
  const codigo = prepararCodigoExibicaoCentroCusto(valor);
  const possuiControle = Array.from(valor).some((caractere) => {
    const ponto = caractere.codePointAt(0) ?? 0;
    return ponto <= 31 || (ponto >= 127 && ponto <= 159);
  });
  return (
    codigo.length > 0 &&
    codigo.length <= 30 &&
    normalizarCodigoCentroCusto(codigo).length > 0 &&
    !codigo.includes(" - ") &&
    !possuiControle
  );
}

export function normalizarDescricaoCentroCusto(valor: string): string {
  return valor.trim().replace(/\s+/g, " ");
}

export function podeCriarCentroCusto(autenticado: boolean): boolean {
  return autenticado;
}

type CentroCustoNome = { nome: string };

export function extrairCodigoCentroCusto(nome: string) {
  const correspondencia = /^\s*(\d+)(?:\.(\d+))?/.exec(nome);
  if (!correspondencia) return null;
  return {
    principal: Number.parseInt(correspondencia[1], 10),
    subnumero: correspondencia[2] ? Number.parseInt(correspondencia[2], 10) : null,
  };
}

export function compararCentrosCusto(a: CentroCustoNome, b: CentroCustoNome): number {
  const codigoA = extrairCodigoCentroCusto(a.nome);
  const codigoB = extrairCodigoCentroCusto(b.nome);
  if (codigoA && !codigoB) return -1;
  if (!codigoA && codigoB) return 1;
  if (codigoA && codigoB) {
    if (codigoA.principal !== codigoB.principal) return codigoA.principal - codigoB.principal;
    if (codigoA.subnumero === null && codigoB.subnumero !== null) return -1;
    if (codigoA.subnumero !== null && codigoB.subnumero === null) return 1;
    if (codigoA.subnumero !== codigoB.subnumero)
      return (codigoA.subnumero ?? 0) - (codigoB.subnumero ?? 0);
  }
  return a.nome.localeCompare(b.nome, "pt-BR");
}

export function existeCodigoCentroCusto(
  obras: readonly CentroCustoNome[],
  codigo: string,
): boolean {
  const codigoNormalizado = normalizarCodigoCentroCusto(codigo);
  return obras.some((obra) => {
    const prefixo = /^\s*([^\s]+)\s*-/.exec(obra.nome)?.[1];
    return prefixo ? normalizarCodigoCentroCusto(prefixo) === codigoNormalizado : false;
  });
}

export function mensagemErroCriacaoCentroCusto(error: {
  code?: string | null;
  message?: string | null;
}): string {
  if (error.code === "23505" || /centro de custo.*(?:existe|cadastrado)/i.test(error.message ?? ""))
    return "Já existe um centro de custo com este código.";
  return error.message || "Não foi possível cadastrar o centro de custo.";
}

export function mensagemErroExclusaoCentroCusto(error: {
  code?: string | null;
  message?: string | null;
}): string {
  if (error.code === "23503")
    return "Este centro de custo possui registros vinculados e não pode ser excluído.";
  return error.message || "Não foi possível remover o centro de custo.";
}
