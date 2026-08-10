type BeneficiosConfig = {
  assistencia_medica: number;
  assistencia_odontologica: number;
  vale_alimentacao: number;
  multibeneficio: number;
};

type CategoriaConfig = { nome: string; tipo: "MOI" | "MOD" };

export type ConfigQueryOperation =
  | "categorias"
  | "categoria_salarios"
  | "beneficios_config"
  | "fechamentos_competencia"
  | "users_profiles";

export type QueryErrorLike = {
  code?: string;
  message?: string;
  status?: number;
};

export type CategoriaSalario = {
  categoria: string;
  salario: number | null;
  encargos: number | null;
  seguro_vida: number | null;
};

export type LinhaSalario = {
  categoria: string;
  salario: string;
  encargos: string;
  seguro_vida: string;
};

export function logConfigQueryError(operation: ConfigQueryOperation, error: unknown) {
  const candidate = error && typeof error === "object" ? (error as QueryErrorLike) : {};
  console.error(`[Configuracoes] ${operation}`, {
    code: candidate.code ?? "unknown",
    message: candidate.message ?? "Erro desconhecido",
    status: candidate.status ?? null,
  });
}

export function combinarCategoriasSalarios(
  categorias: CategoriaConfig[],
  salarios: CategoriaSalario[],
): LinhaSalario[] {
  const porCategoria = new Map(salarios.map((row) => [row.categoria, row]));
  return categorias.map((categoria) => {
    const salario = porCategoria.get(categoria.nome);
    return {
      categoria: categoria.nome,
      salario: String(salario?.salario ?? 0),
      encargos: String(salario?.encargos ?? 0),
      seguro_vida: String(salario?.seguro_vida ?? 0),
    };
  });
}

export function beneficiosOuZero(
  row: Partial<BeneficiosConfig> | null | undefined,
): BeneficiosConfig {
  if (!row)
    return {
      assistencia_medica: 0,
      assistencia_odontologica: 0,
      vale_alimentacao: 0,
      multibeneficio: 0,
    };
  return {
    assistencia_medica: Number(row.assistencia_medica ?? 0),
    assistencia_odontologica: Number(row.assistencia_odontologica ?? 0),
    vale_alimentacao: Number(row.vale_alimentacao ?? 0),
    multibeneficio: Number(row.multibeneficio ?? 0),
  };
}

export function nomeUsuarioDisponivel(
  profiles: Map<string, string> | undefined,
  id: string | null,
): string {
  if (!id) return "—";
  return profiles?.get(id) ?? "Usuário não disponível";
}
