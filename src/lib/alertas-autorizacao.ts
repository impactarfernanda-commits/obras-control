type RoleRow = { role: string | null };

type RoleQueryResult = {
  data: RoleRow[] | null;
  error: { message: string } | null;
};

const ROLES_ALERTAS_MANUAIS = new Set(["gerente", "diretor"]);

export async function executarAlertasManualAutorizado<T>(input: {
  buscarRoles: () => PromiseLike<RoleQueryResult>;
  executar: () => Promise<T>;
}): Promise<T> {
  const { data, error } = await input.buscarRoles();
  if (error) throw new Error(error.message);

  const autorizado = (data ?? []).some(
    ({ role }) => role !== null && ROLES_ALERTAS_MANUAIS.has(role),
  );
  if (!autorizado) {
    throw new Error("Forbidden: alertas disponíveis apenas para gerente e diretor");
  }

  return input.executar();
}
