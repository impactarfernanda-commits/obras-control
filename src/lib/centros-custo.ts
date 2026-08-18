export function normalizarCodigoCentroCusto(valor: string): string {
  return valor
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
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
