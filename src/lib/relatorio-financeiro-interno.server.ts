import {
  calcularCusto,
  custoDoDia,
  diasUteisNoIntervalo,
  horasPadraoDoDia,
  type Beneficios,
  type CustoBreakdown,
} from "./custos-core.ts";
import { tipoCategoria, type Categoria } from "./categorias-core.ts";
import { competenciaUsaSegmentacaoMod } from "./especialidade-ajudante.ts";
import {
  consolidarCustosCentros,
  type AlocacaoRelatorio,
  type RegistroRelatorio,
} from "./relatorio-centro-custo.ts";
import { consolidarCustoFuncionario } from "./relatorio-funcionario.ts";
import type { DetalheJornadaVisual } from "./horas-visualizacao.ts";
import type { RegimeVigencia } from "./regimes.ts";
import type { VigenciaCentroCusto } from "./supervisor-cc.ts";

export type FuncionarioFinanceiroInterno = {
  id: string;
  nome: string;
  categoria_mo: string;
  ativo?: boolean;
  salario: number | null;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
  data_admissao: string | null;
  data_desligamento: string | null;
};

export type EntradaProcessamentoFinanceiroInterno = {
  competencia: string;
  periodo: { start: string; end: string; startDate: Date; endDate: Date };
  funcionarios: FuncionarioFinanceiroInterno[];
  beneficios: Beneficios | null;
  seguros: Array<{ categoria: string; seguro_vida: number | null }>;
  categorias: Categoria[];
  obras: Array<{ id: string; nome: string }>;
  alocacoes: AlocacaoRelatorio[];
  registros: RegistroRelatorio[];
  detalhes?: Array<DetalheJornadaVisual & { registro_horas_id: string }>;
  feriados?: string[];
  vigenciasRegime?: RegimeVigencia[];
  alocacoesReferenciaRegime?: Array<{
    funcionarioId: string;
    obraId: string;
    data: string;
  }>;
  alocacoesReferenciaClassificacao?: AlocacaoRelatorio[];
  vigenciasCentroCusto?: VigenciaCentroCusto[];
};

export type ProjecaoFinanceiraFuncionarioInterna = {
  funcionarioId: string;
  funcionarioNome: string;
  categoria: string;
  tipo: "MOD" | "MOI" | null;
  ativo: boolean;
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  custoMensal: CustoBreakdown;
  totalMensalIntegral: number;
  proporcionalCompetencia: ReturnType<typeof consolidarCustoFuncionario>;
  totalProporcionalCompetencia: number;
};

export function processarFinanceiroRelatoriosInterno(
  input: EntradaProcessamentoFinanceiroInterno,
  options: { incluirProjecaoFolha: boolean },
) {
  const funcionarios = input.funcionarios.filter(
    (funcionario) => funcionario.deleted_at == null && funcionario.visivel_obras_control !== false,
  );
  const seguros = new Map(
    input.seguros.map((registro) => [registro.categoria, Number(registro.seguro_vida ?? 0)]),
  );
  const custos = new Map(
    funcionarios.map((funcionario) => [
      funcionario.id,
      calcularCusto(
        funcionario.salario,
        input.beneficios,
        seguros.get(funcionario.categoria_mo) ?? 0,
      ),
    ]),
  );
  const detalhePorRegistro = new Map(
    (input.detalhes ?? []).map((detalhe) => [detalhe.registro_horas_id, detalhe]),
  );
  const registros = input.registros.map((registro) => ({
    ...registro,
    detalhe: registro.id ? (detalhePorRegistro.get(registro.id) ?? null) : null,
  }));
  const segmentarMod = competenciaUsaSegmentacaoMod(input.competencia);
  const consolidacao = consolidarCustosCentros({
    alocacoes: input.alocacoes,
    registros,
    funcionarios,
    custos,
    obras: new Map(input.obras.map((obra) => [obra.id, obra.nome])),
    diasUteis: diasUteisNoIntervalo(input.periodo.startDate, input.periodo.endDate),
    resolverTipo: (alocacao, funcionario) => {
      if (alocacao?.tipo_mao_obra === "montagem" || alocacao?.tipo_mao_obra === "civil")
        return "MOD";
      if (alocacao?.tipo_mao_obra === "indireta") return "MOI";
      return tipoCategoria(funcionario.categoria_mo, input.categorias) ?? "MOD";
    },
    calcularCustoBase: (args) => custoDoDia({ ...args, horasExtras: 0 }),
    horasNormaisPadrao: horasPadraoDoDia,
    segmentarMod,
    feriados: new Set(input.feriados ?? []),
    periodoInicial: input.periodo.start,
    periodoFinal: input.periodo.end,
    vigenciasRegime: input.vigenciasRegime,
    alocacoesReferenciaRegime: input.alocacoesReferenciaRegime,
    alocacoesReferenciaClassificacao: input.alocacoesReferenciaClassificacao,
    vigenciasCentroCusto: input.vigenciasCentroCusto,
  });

  let projecaoFolha: ProjecaoFinanceiraFuncionarioInterna[] | null = null;
  if (options.incluirProjecaoFolha) {
    const idsComLancamento = new Set<string>();
    for (const alocacao of input.alocacoes) idsComLancamento.add(alocacao.funcionario_id);
    for (const registro of input.registros) idsComLancamento.add(registro.funcionario_id);
    projecaoFolha = funcionarios
      .filter((funcionario) => funcionario.ativo !== false || idsComLancamento.has(funcionario.id))
      .map((funcionario) => {
        const custoMensal = custos.get(funcionario.id)!;
        const proporcionalCompetencia = consolidarCustoFuncionario(
          consolidacao.centros,
          funcionario.id,
        );
        return {
          funcionarioId: funcionario.id,
          funcionarioNome: funcionario.nome,
          categoria: funcionario.categoria_mo,
          tipo: tipoCategoria(funcionario.categoria_mo, input.categorias),
          ativo: funcionario.ativo !== false,
          dataAdmissao: funcionario.data_admissao,
          dataDesligamento: funcionario.data_desligamento,
          custoMensal,
          // Paridade intencional com a tabela atual: não inclui refeição nem adicional noturno.
          totalMensalIntegral: custoMensal.total + proporcionalCompetencia.custoHE,
          proporcionalCompetencia,
          totalProporcionalCompetencia: proporcionalCompetencia.total,
        };
      });
  }

  return { consolidacao, segmentarMod, projecaoFolha };
}
