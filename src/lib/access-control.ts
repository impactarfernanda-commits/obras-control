export const ROLES = ["assistente", "supervisor", "coordenador", "gerente", "diretor"] as const;

export type Role = (typeof ROLES)[number];

const ROLE_PRIORITY: Role[] = ["diretor", "gerente", "coordenador", "supervisor", "assistente"];

export function highestRole(roles: Array<string | null | undefined>): Role | null {
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? null;
}

export function hasAnyRole(role: Role | null, allowed: readonly Role[]): boolean {
  return role !== null && allowed.includes(role);
}

export function canDeactivateEmployee(role: Role | null, active: boolean): boolean {
  return role !== null && active;
}

export function canEditEmployeeTerminationDate(role: Role | null, active: boolean): boolean {
  return (role === "gerente" || role === "diretor") && !active;
}

export function canDeleteDailyAllocation(
  role: Role | null,
  userId: string | null | undefined,
  allocationCreatedBy: string | null,
  recordCreatedBy: string | null | undefined,
): boolean {
  if (role === "gerente" || role === "diretor") return true;
  return Boolean(
    userId &&
    allocationCreatedBy === userId &&
    (recordCreatedBy == null || recordCreatedBy === userId),
  );
}

export function isExpectedAccessError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: number; code?: string };
  return candidate.status === 401 || candidate.status === 403 || candidate.code === "42501";
}

export function isTransientReadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: number; name?: string; code?: string };
  if (candidate.status === 401 || candidate.status === 403 || candidate.code === "42501")
    return false;
  return (
    candidate.name === "TypeError" ||
    candidate.name === "AbortError" ||
    (candidate.status ?? 0) >= 500
  );
}

export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && isTransientReadError(error);
}

export function safeErrorDetails(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (!(error instanceof Error)) return { name: "Error", message: "Unknown error" };
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  };
}
