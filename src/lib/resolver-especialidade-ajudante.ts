import { calcularCompetencia } from "./competencias.ts";
import type { EspecialidadeAjudante } from "./especialidade-ajudante.ts";

export type RegistroEspecialidadeAjudante = {
  funcionario_id: string;
  obra_id: string;
  data: string;
  especialidade_ajudante?: EspecialidadeAjudante | null;
};

export type ResolucaoEspecialidadeAjudante =
  | {
      estado: "resolvida";
      especialidade: EspecialidadeAjudante;
      origem: "alocacao_origem" | "historico";
    }
  | { estado: "indefinida"; especialidade: null; origem: null }
  | { estado: "conflitante"; especialidade: null; origem: "historico" };

export function resolverEspecialidadeAjudante({
  funcionarioId,
  obraId,
  competencia,
  dataDestino,
  especialidadeOrigem,
  historico,
}: {
  funcionarioId: string;
  obraId: string;
  competencia: string;
  dataDestino?: string;
  especialidadeOrigem?: EspecialidadeAjudante | null;
  historico: readonly RegistroEspecialidadeAjudante[];
}): ResolucaoEspecialidadeAjudante {
  if (especialidadeOrigem)
    return { estado: "resolvida", especialidade: especialidadeOrigem, origem: "alocacao_origem" };

  const classificadas = historico
    .filter(
      (item) =>
        item.funcionario_id === funcionarioId &&
        item.obra_id === obraId &&
        calcularCompetencia(item.data).competencia === competencia &&
        (!dataDestino || item.data < dataDestino) &&
        item.especialidade_ajudante != null,
    )
    .sort((a, b) => b.data.localeCompare(a.data));
  const distintas = new Set(classificadas.map((item) => item.especialidade_ajudante));
  if (distintas.size > 1)
    return { estado: "conflitante", especialidade: null, origem: "historico" };
  const maisRecente = classificadas[0]?.especialidade_ajudante;
  return maisRecente
    ? { estado: "resolvida", especialidade: maisRecente, origem: "historico" }
    : { estado: "indefinida", especialidade: null, origem: null };
}

export function sugerirEspecialidadePeriodo({
  funcionarioId,
  obraId,
  competencias,
  historico,
}: {
  funcionarioId: string;
  obraId: string;
  competencias: readonly string[];
  historico: readonly RegistroEspecialidadeAjudante[];
}): ResolucaoEspecialidadeAjudante {
  const resolucoes = Array.from(new Set(competencias)).map((competencia) =>
    resolverEspecialidadeAjudante({ funcionarioId, obraId, competencia, historico }),
  );
  if (resolucoes.some(({ estado }) => estado === "conflitante"))
    return { estado: "conflitante", especialidade: null, origem: "historico" };
  if (resolucoes.some(({ estado }) => estado === "indefinida"))
    return { estado: "indefinida", especialidade: null, origem: null };
  const especialidades = new Set(
    resolucoes.flatMap((resolucao) =>
      resolucao.estado === "resolvida" ? [resolucao.especialidade] : [],
    ),
  );
  return especialidades.size === 1
    ? {
        estado: "resolvida",
        especialidade: Array.from(especialidades)[0],
        origem: "historico",
      }
    : { estado: "conflitante", especialidade: null, origem: "historico" };
}

export function especialidadeNovaAlocacao({
  ajudante,
  resolucao,
  escolha,
}: {
  ajudante: boolean;
  resolucao: ResolucaoEspecialidadeAjudante | null;
  escolha?: EspecialidadeAjudante;
}) {
  if (!ajudante) return null;
  return resolucao?.estado === "resolvida" ? resolucao.especialidade : (escolha ?? null);
}

export function funcionariosAjudantesSemEspecialidade<
  T extends {
    funcionario_id: string;
    status: string;
    ajudante: boolean;
    resolucao: ResolucaoEspecialidadeAjudante | null;
  },
>(itens: readonly T[], escolhas: Readonly<Record<string, EspecialidadeAjudante>>) {
  return itens.filter(
    (item) =>
      item.status === "adicionar" &&
      item.ajudante &&
      item.resolucao?.estado !== "resolvida" &&
      !escolhas[item.funcionario_id],
  );
}
