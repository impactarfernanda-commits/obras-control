export type SituacaoAlocacaoCc = "alocado" | "ausencia" | "sem_alocacao" | "inconsistencia";
export type OrigemHorasAlocacaoCc = "detalhe" | "legado" | "sem_horas";

export type LinhaDiariaAlocacaoCc = {
  competencia: string;
  periodo_inicio: string;
  periodo_fim: string;
  funcionario_id: string;
  funcionario_nome: string;
  categoria: string;
  data: string;
  data_inicio: string | null;
  data_saida: string | null;
  hora_entrada: string | null;
  hora_saida: string | null;
  situacao: SituacaoAlocacaoCc;
  tipo_registro: string | null;
  falta_tipo: string | null;
  obra_id: string | null;
  obra_nome: string | null;
  minutos_normais: number;
  minutos_he_50: number;
  minutos_he_100: number;
  minutos_sem_adicional_he: number;
  minutos_noturnos: number;
  observacoes: string | null;
  possui_inconsistencia: boolean;
  tipo_inconsistencia: string | null;
  origem_horas: OrigemHorasAlocacaoCc;
  dia_esperado: boolean;
  dias_esperados_funcionario: number;
};

export type PartesCentroCusto = {
  centroCusto: string;
  obra: string;
  nomeCompleto: string;
  formatoReconhecido: boolean;
};

export function separarCentroCustoObra(nome: string | null | undefined): PartesCentroCusto {
  const nomeCompleto = nome?.trim() ?? "";
  const separador = nomeCompleto.indexOf(" - ");
  if (separador <= 0 || separador >= nomeCompleto.length - 3) {
    return {
      centroCusto: nomeCompleto || "Não definido",
      obra: nomeCompleto || "Não definida",
      nomeCompleto,
      formatoReconhecido: false,
    };
  }
  return {
    centroCusto: nomeCompleto.slice(0, separador).trim(),
    obra: nomeCompleto.slice(separador + 3).trim(),
    nomeCompleto,
    formatoReconhecido: true,
  };
}

export type ResumoAlocacaoCc = {
  funcionarioId: string;
  funcionarioNome: string;
  categoria: string;
  obraId: string;
  obraNome: string;
  centroCusto: string;
  obra: string;
  diasAlocados: number;
  percentualDiasAlocados: number;
};

export type FuncionarioAlocacaoCc = {
  funcionarioId: string;
  funcionarioNome: string;
  categoria: string;
  totalDiasDisponiveis: number;
  totalDiasAlocados: number;
  observacao: string;
  centros: ResumoAlocacaoCc[];
  detalhes: LinhaDiariaAlocacaoCc[];
};

export type RelatorioAlocacaoCc = {
  resumo: ResumoAlocacaoCc[];
  funcionarios: FuncionarioAlocacaoCc[];
  detalhes: LinhaDiariaAlocacaoCc[];
  inconsistencias: number;
};

export type FiltrosAlocacaoCc = {
  busca: string;
  funcionarioId: string;
  obraId: string;
  categoria: string;
};

export function filtrarFuncionariosAlocacaoCc(
  funcionarios: readonly FuncionarioAlocacaoCc[],
  filtros: FiltrosAlocacaoCc,
) {
  const termo = filtros.busca.trim().toLocaleLowerCase("pt-BR");
  return funcionarios.filter(
    (funcionario) =>
      (!termo || funcionario.funcionarioNome.toLocaleLowerCase("pt-BR").includes(termo)) &&
      (filtros.funcionarioId === "all" || funcionario.funcionarioId === filtros.funcionarioId) &&
      (filtros.obraId === "all" ||
        funcionario.centros.some((centro) => centro.obraId === filtros.obraId)) &&
      (filtros.categoria === "all" || funcionario.categoria === filtros.categoria),
  );
}

const chaveFuncionarioObra = (funcionarioId: string, obraId: string) =>
  `${funcionarioId}|${obraId}`;

export function montarRelatorioAlocacaoCentroCusto(
  entrada: readonly LinhaDiariaAlocacaoCc[],
): RelatorioAlocacaoCc {
  const diasEsperadosPorFuncionario = new Map<string, Set<string>>();
  const disponibilidadeInformada = new Map<string, number>();
  const datasEsperadasGlobais = new Set<string>();
  for (const linha of entrada) {
    disponibilidadeInformada.set(
      linha.funcionario_id,
      Math.max(
        disponibilidadeInformada.get(linha.funcionario_id) ?? 0,
        linha.dias_esperados_funcionario,
      ),
    );
    if (!linha.dia_esperado) continue;
    const datas = diasEsperadosPorFuncionario.get(linha.funcionario_id) ?? new Set<string>();
    datas.add(linha.data);
    diasEsperadosPorFuncionario.set(linha.funcionario_id, datas);
    datasEsperadasGlobais.add(linha.data);
  }
  const primeiraDataEsperadaGlobal = [...datasEsperadasGlobais].sort()[0] ?? null;
  const ultimaDataEsperadaGlobal = [...datasEsperadasGlobais].sort().at(-1) ?? null;
  const maiorDisponibilidade = Math.max(0, ...disponibilidadeInformada.values());
  const detalhesUnicos = new Map<string, LinhaDiariaAlocacaoCc>();
  for (const linha of entrada) {
    if (linha.situacao !== "alocado" || !linha.obra_id) continue;
    const chave = `${linha.funcionario_id}|${linha.obra_id}|${linha.data}`;
    if (!detalhesUnicos.has(chave)) detalhesUnicos.set(chave, linha);
  }
  const detalhes = [...detalhesUnicos.values()].sort(
    (a, b) =>
      a.funcionario_nome.localeCompare(b.funcionario_nome, "pt-BR") ||
      a.data.localeCompare(b.data) ||
      (a.obra_nome ?? "").localeCompare(b.obra_nome ?? "", "pt-BR"),
  );
  const porFuncionario = new Map<string, LinhaDiariaAlocacaoCc[]>();
  for (const linha of detalhes) {
    const atuais = porFuncionario.get(linha.funcionario_id) ?? [];
    atuais.push(linha);
    porFuncionario.set(linha.funcionario_id, atuais);
  }

  const funcionarios: FuncionarioAlocacaoCc[] = [];
  const resumo: ResumoAlocacaoCc[] = [];
  for (const [funcionarioId, linhas] of porFuncionario) {
    const primeira = linhas[0];
    const datasAlocadas = new Set(
      linhas
        .filter((linha) => linha.obra_id && linha.situacao === "alocado")
        .map((linha) => linha.data),
    );
    const porObra = new Map<string, LinhaDiariaAlocacaoCc[]>();
    const datasEsperadas = [...(diasEsperadosPorFuncionario.get(funcionarioId) ?? [])].sort();
    const totalDiasDisponiveis = Math.max(
      disponibilidadeInformada.get(funcionarioId) ?? 0,
      datasEsperadas.length,
    );
    const observacoes: string[] = [];
    if (
      primeiraDataEsperadaGlobal &&
      datasEsperadas[0] &&
      datasEsperadas[0] > primeiraDataEsperadaGlobal
    )
      observacoes.push("Admitido no período");
    if (
      ultimaDataEsperadaGlobal &&
      datasEsperadas.at(-1) &&
      datasEsperadas.at(-1)! < ultimaDataEsperadaGlobal
    )
      observacoes.push("Desligado no período");
    if (totalDiasDisponiveis < maiorDisponibilidade)
      observacoes.push("Dias disponíveis diferentes do período completo");
    if (totalDiasDisponiveis > datasAlocadas.size) observacoes.push("Alocação incompleta");
    for (const linha of linhas) {
      if (!linha.obra_id || linha.situacao !== "alocado") continue;
      const chave = chaveFuncionarioObra(funcionarioId, linha.obra_id);
      const atuais = porObra.get(chave) ?? [];
      atuais.push(linha);
      porObra.set(chave, atuais);
    }
    const linhasResumo: ResumoAlocacaoCc[] = [];
    for (const linhasObra of porObra.values()) {
      const base = linhasObra[0];
      const partes = separarCentroCustoObra(base.obra_nome);
      const dias = new Set(linhasObra.map((linha) => linha.data)).size;
      const item: ResumoAlocacaoCc = {
        funcionarioId,
        funcionarioNome: base.funcionario_nome,
        categoria: base.categoria,
        obraId: base.obra_id!,
        obraNome: base.obra_nome ?? "",
        centroCusto: partes.centroCusto,
        obra: partes.obra,
        diasAlocados: dias,
        percentualDiasAlocados: totalDiasDisponiveis ? (dias / totalDiasDisponiveis) * 100 : 0,
      };
      linhasResumo.push(item);
      resumo.push(item);
    }
    linhasResumo.sort((a, b) =>
      a.centroCusto.localeCompare(b.centroCusto, "pt-BR", { numeric: true }),
    );
    funcionarios.push({
      funcionarioId,
      funcionarioNome: primeira.funcionario_nome,
      categoria: primeira.categoria,
      totalDiasDisponiveis,
      totalDiasAlocados: datasAlocadas.size,
      observacao: observacoes.join(" · ") || "—",
      centros: linhasResumo,
      detalhes: linhas,
    });
  }
  funcionarios.sort((a, b) => a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR"));
  resumo.sort(
    (a, b) =>
      a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR") ||
      a.centroCusto.localeCompare(b.centroCusto, "pt-BR", { numeric: true }),
  );
  return {
    resumo,
    funcionarios,
    detalhes,
    inconsistencias: detalhes.filter((linha) => linha.possui_inconsistencia).length,
  };
}
