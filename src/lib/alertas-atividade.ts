import { buscarTodasPaginas } from "./paginacao.ts";

export interface LinhaAtividadeFuncionario {
  funcionario_id: string;
}

interface BuscarIdsAtividadeEmLotesInput {
  funcionarioIds: string[];
  buscarPagina: (
    loteFuncionarioIds: string[],
    inicio: number,
    fim: number,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  tamanhoLote?: number;
}

interface IdentificarHistoricoCandidatosInput {
  funcionarioIdsAtivos: string[];
  funcionarioIdsComAtividadeRecente: ReadonlySet<string>;
  funcionarioIdsIgnorados: ReadonlySet<string>;
  buscarHistoricoAlocacoes: (funcionarioIds: string[]) => Promise<ReadonlySet<string>>;
  buscarHistoricoRegistros: (funcionarioIds: string[]) => Promise<ReadonlySet<string>>;
}

export interface HistoricoCandidatos {
  funcionarioIdsComHistorico: Set<string>;
  funcionarioIdsSemHistorico: Set<string>;
}

interface FuncionarioAtivoAlerta {
  id: string;
  nome: string;
}

export interface AlertaAtividadeFuncionario {
  tipo: "nunca_alocado" | "sem_alocacao";
  titulo: string;
  mensagem: string;
  severidade: "warning";
  metadata: { funcionario_id: string; funcionario_nome: string };
  dedupe_key: string;
}

interface CriarAlertasAtividadeInput {
  funcionariosAtivos: FuncionarioAtivoAlerta[];
  funcionarioIdsComAtividadeRecente: ReadonlySet<string>;
  funcionarioIdsComHistorico: ReadonlySet<string>;
  funcionarioIdsSupervisoresTratados: ReadonlySet<string>;
  funcionarioIdsSupervisoresComVigencia: ReadonlySet<string>;
  hojeStr: string;
  diasSemAlocacao: number;
}

const TAMANHO_LOTE_IDS = 100;

export function dataInicioAtividadeRecente(dataReferencia: Date, dias: number): string {
  const inicio = new Date(dataReferencia);
  inicio.setDate(inicio.getDate() - dias);
  return inicio.toISOString().slice(0, 10);
}

export async function buscarIdsAtividadeEmLotes({
  funcionarioIds,
  buscarPagina,
  tamanhoLote = TAMANHO_LOTE_IDS,
}: BuscarIdsAtividadeEmLotesInput): Promise<Set<string>> {
  const idsUnicos = [...new Set(funcionarioIds)];
  const encontrados = new Set<string>();

  for (let indice = 0; indice < idsUnicos.length; indice += tamanhoLote) {
    const lote = idsUnicos.slice(indice, indice + tamanhoLote);
    const linhas = await buscarTodasPaginas<LinhaAtividadeFuncionario>((inicio, fim) =>
      buscarPagina(lote, inicio, fim),
    );
    for (const linha of linhas) encontrados.add(linha.funcionario_id);
  }

  return encontrados;
}

export async function identificarHistoricoCandidatos({
  funcionarioIdsAtivos,
  funcionarioIdsComAtividadeRecente,
  funcionarioIdsIgnorados,
  buscarHistoricoAlocacoes,
  buscarHistoricoRegistros,
}: IdentificarHistoricoCandidatosInput): Promise<HistoricoCandidatos> {
  const candidatos = [...new Set(funcionarioIdsAtivos)].filter(
    (id) => !funcionarioIdsComAtividadeRecente.has(id) && !funcionarioIdsIgnorados.has(id),
  );

  if (candidatos.length === 0) {
    return { funcionarioIdsComHistorico: new Set(), funcionarioIdsSemHistorico: new Set() };
  }

  const comHistoricoAlocacoes = await buscarHistoricoAlocacoes(candidatos);
  const candidatosSemAlocacao = candidatos.filter((id) => !comHistoricoAlocacoes.has(id));
  const comHistoricoRegistros =
    candidatosSemAlocacao.length > 0
      ? await buscarHistoricoRegistros(candidatosSemAlocacao)
      : new Set<string>();

  const funcionarioIdsComHistorico = new Set([...comHistoricoAlocacoes, ...comHistoricoRegistros]);
  const funcionarioIdsSemHistorico = new Set(
    candidatos.filter((id) => !funcionarioIdsComHistorico.has(id)),
  );

  return { funcionarioIdsComHistorico, funcionarioIdsSemHistorico };
}

export function criarAlertasAtividadeFuncionarios({
  funcionariosAtivos,
  funcionarioIdsComAtividadeRecente,
  funcionarioIdsComHistorico,
  funcionarioIdsSupervisoresTratados,
  funcionarioIdsSupervisoresComVigencia,
  hojeStr,
  diasSemAlocacao,
}: CriarAlertasAtividadeInput): AlertaAtividadeFuncionario[] {
  const alertas: AlertaAtividadeFuncionario[] = [];

  for (const funcionario of funcionariosAtivos) {
    if (funcionarioIdsSupervisoresTratados.has(funcionario.id)) {
      if (!funcionarioIdsSupervisoresComVigencia.has(funcionario.id)) {
        alertas.push({
          tipo: "sem_alocacao",
          titulo: `Supervisor sem vigência de CC: ${funcionario.nome}`,
          mensagem: `${funcionario.nome} está ativo, mas não possui vigência de centro de custo na data atual.`,
          severidade: "warning",
          metadata: { funcionario_id: funcionario.id, funcionario_nome: funcionario.nome },
          dedupe_key: `supervisor_sem_vigencia:${funcionario.id}:${hojeStr}`,
        });
      }
      continue;
    }

    if (
      !funcionarioIdsComAtividadeRecente.has(funcionario.id) &&
      !funcionarioIdsComHistorico.has(funcionario.id)
    ) {
      alertas.push({
        tipo: "nunca_alocado",
        titulo: `Funcionário nunca alocado: ${funcionario.nome}`,
        mensagem: `${funcionario.nome} está cadastrado como ativo mas nunca foi alocado a nenhum centro de custo. Faça a primeira alocação ou desative o cadastro.`,
        severidade: "warning",
        metadata: { funcionario_id: funcionario.id, funcionario_nome: funcionario.nome },
        dedupe_key: `nunca_alocado:${funcionario.id}:${hojeStr}`,
      });
    } else if (!funcionarioIdsComAtividadeRecente.has(funcionario.id)) {
      alertas.push({
        tipo: "sem_alocacao",
        titulo: `Funcionário sem alocação: ${funcionario.nome}`,
        mensagem: `${funcionario.nome} está ativo mas não possui alocação nem registro de horas nos últimos ${diasSemAlocacao} dias. Verifique se está de folga de campo, férias, afastado, desligado ou se a alocação foi esquecida.`,
        severidade: "warning",
        metadata: { funcionario_id: funcionario.id, funcionario_nome: funcionario.nome },
        dedupe_key: `sem_alocacao:${funcionario.id}:${hojeStr}`,
      });
    }
  }

  return alertas;
}
