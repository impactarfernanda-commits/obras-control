export function roundHours(value: number | string | null | undefined): number {
  const numericValue = Number(value ?? 0);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  return Math.round((safeValue + Number.EPSILON) * 100) / 100;
}

export function sumHours(values: ReadonlyArray<number | string | null | undefined>): number {
  return roundHours(
    values.reduce<number>((total, value) => {
      const numericValue = Number(value ?? 0);
      return total + (Number.isFinite(numericValue) ? numericValue : 0);
    }, 0),
  );
}

export function formatDecimalHours(value: number | string | null | undefined): string {
  const normalized = roundHours(value);
  return normalized.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatExtraHours(value: number | string | null | undefined): string {
  return `+${formatDecimalHours(value)}h`;
}
