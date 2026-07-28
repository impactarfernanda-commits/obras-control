const EMAIL_AUTORIZADO_IMPORTACAO_LEGADO = "fernanda.souza@tanksbr.com.br";

export function canImportarPlanilhaLegado(email?: string) {
  return email?.trim().toLowerCase() === EMAIL_AUTORIZADO_IMPORTACAO_LEGADO;
}
