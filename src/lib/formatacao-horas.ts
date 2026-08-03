export function formatDecimalHours(value: number | string | null | undefined): string {
  const numericValue = Number(value ?? 0);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  const normalized = Math.round((safeValue + Number.EPSILON) * 100) / 100;
  return normalized.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatExtraHours(value: number | string | null | undefined): string {
  return `+${formatDecimalHours(value)}h`;
}
