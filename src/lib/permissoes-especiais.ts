const EMAIL_CONTA_AUTORIZADA = "fernanda.souza@tanksbr.com.br";

function isContaAutorizada(email?: string) {
  return email?.trim().toLowerCase() === EMAIL_CONTA_AUTORIZADA;
}

export function canImportarPlanilhaLegado(email?: string) {
  return isContaAutorizada(email);
}

export function canGerenciarUsuarios(email?: string) {
  return isContaAutorizada(email);
}
