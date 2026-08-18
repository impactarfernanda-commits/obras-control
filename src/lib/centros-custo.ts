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

export function mensagemErroCriacaoCentroCusto(error: {
  code?: string | null;
  message?: string | null;
}): string {
  if (error.code === "23505" || /centro de custo.*(?:existe|cadastrado)/i.test(error.message ?? ""))
    return "Já existe um centro de custo com este código.";
  return error.message || "Não foi possível cadastrar o centro de custo.";
}
