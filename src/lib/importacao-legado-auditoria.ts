import type { TipoMaoObraLegado } from "./importacao-legado-centros";

export type CelulaAlocacaoLegado = {
  sourceCellKey: string;
  funcionarioKey: string;
  funcionarioNome: string;
  funcionarioId?: string;
  obraId: string;
  data: string;
  valorOriginal: string;
  codigoBase: string;
  tipoMaoObra: TipoMaoObraLegado;
};

export type AlocacaoBancoAuditoria = {
  id: string;
  funcionario_id: string;
  obra_id: string;
  data: string;
};

export type CelulaExistenteAuditoria<T extends CelulaAlocacaoLegado = CelulaAlocacaoLegado> = T & {
  quantidadeMatches: number;
  idsExistentes: string[];
  motivo: string;
};

export function criarSourceCellKey(rowIndex: number, columnIndex: number, data: string) {
  return `linha ${rowIndex + 1} | coluna ${columnIndex + 1} | ${data}`;
}

export function chaveOperacional(funcionarioId: string, obraId: string, data: string) {
  return `${funcionarioId}|${obraId}|${data}`;
}

export function conciliarCelulasComAlocacoesExistentes<T extends CelulaAlocacaoLegado>(
  celulas: T[],
  registrosBanco: AlocacaoBancoAuditoria[],
) {
  const registrosPorChave = new Map<string, AlocacaoBancoAuditoria[]>();
  for (const registro of registrosBanco) {
    const chave = chaveOperacional(registro.funcionario_id, registro.obra_id, registro.data);
    const grupo = registrosPorChave.get(chave) ?? [];
    grupo.push(registro);
    registrosPorChave.set(chave, grupo);
  }

  const novas: T[] = [];
  const existentes: CelulaExistenteAuditoria<T>[] = [];
  for (const celula of celulas) {
    const matches = celula.funcionarioId
      ? (registrosPorChave.get(
          chaveOperacional(celula.funcionarioId, celula.obraId, celula.data),
        ) ?? [])
      : [];
    if (matches.length === 0) {
      novas.push(celula);
      continue;
    }
    existentes.push({
      ...celula,
      quantidadeMatches: matches.length,
      idsExistentes: matches.map((match) => match.id),
      motivo:
        "A chave operacional já possui alocação no banco; a célula será mantida sem alteração.",
    });
  }

  return {
    novas,
    existentes,
    celulasUnicasExistentes: existentes.length,
    totalMatchesBanco: existentes.reduce((total, item) => total + item.quantidadeMatches, 0),
    matchesAdicionaisBanco: existentes.reduce(
      (total, item) => total + Math.max(0, item.quantidadeMatches - 1),
      0,
    ),
    duplicidadesHistoricas: existentes.filter((item) => item.quantidadeMatches > 1),
  };
}

export function separarDuplicidadesInternas(celulas: CelulaAlocacaoLegado[]) {
  const primeiraPorChave = new Map<string, CelulaAlocacaoLegado>();
  const unicas: CelulaAlocacaoLegado[] = [];
  const duplicadas: Array<{
    celula: CelulaAlocacaoLegado;
    primeiraSourceCellKey: string;
  }> = [];

  for (const celula of celulas) {
    const identidadeFuncionario = celula.funcionarioId ?? celula.funcionarioKey;
    const chave = chaveOperacional(identidadeFuncionario, celula.obraId, celula.data);
    const primeira = primeiraPorChave.get(chave);
    if (primeira) {
      duplicadas.push({ celula, primeiraSourceCellKey: primeira.sourceCellKey });
    } else {
      primeiraPorChave.set(chave, celula);
      unicas.push(celula);
    }
  }
  return { unicas, duplicadas };
}

export function somarGruposMutuamenteExclusivos(grupos: Record<string, number>) {
  return Object.values(grupos).reduce((total, quantidade) => total + quantidade, 0);
}
