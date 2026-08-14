import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buscarTodasPaginas } from "@/lib/paginacao";
import { diasUteisNoIntervalo } from "@/lib/custos-core";
import {
  classificarRegistroGerencial,
  custoRegistroNaVigencia,
  indicadores,
  normalizarFuncaoOrcamento,
  vigenciaNaData,
  type CustoVigencia,
  type TipoAusencia,
  type TipoMO,
} from "@/lib/planejamento-hh-core";

type Role = "assistente" | "supervisor" | "coordenador" | "gerente" | "diretor";
type ItemBase = {
  id: string;
  funcao_orcamento: string;
  categoria_mo_mapeada: string | null;
  tipo_mo: TipoMO;
  hh_previsto: number;
  custo_previsto: number;
};
type Registro = {
  funcionario_id: string;
  data: string;
  horas_normais: number;
  horas_extras: number;
  tipo_registro: "horas" | "falta" | "ferias" | "folga_campo";
  falta_tipo: string | null;
};
type Funcionario = {
  id: string;
  deleted_at: string | null;
  visivel_obras_control: boolean | null;
};
type CustoVigenciaRow = {
  funcionario_id: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  categoria_mo: string;
  custo_mensal_total: number;
  status_historico: "estimado_inicial" | "apurado_por_vigencia";
};

const consultaSchema = z
  .object({
    obraId: z.string().uuid(),
    dataInicial: z.string().date(),
    dataFinal: z.string().date(),
  })
  .refine((v) => v.dataFinal >= v.dataInicial, "Periodo invalido");
const itemImportadoSchema = z.object({
  funcaoOrcamento: z.string().min(1),
  tipoMo: z.enum(["MOI", "MOD"]),
  hhPrevisto: z.number().nonnegative(),
  custoPrevisto: z.number().nonnegative(),
  origem: z.enum(["MO", "EAP/CPUs"]),
  metadataCalculo: z.record(z.unknown()),
});

async function permissoes(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const result = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (result.error) throw new Error(result.error.message);
  const roles = (result.data ?? []).map((r) => r.role as Role);
  const operacional = roles.some((r) => ["coordenador", "gerente", "diretor"].includes(r));
  const financeiro = roles.some((r) => r === "gerente" || r === "diretor");
  return { operacional, financeiro };
}

function isoLocal(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const getPlanejamentoHH = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => consultaSchema.parse(v))
  .handler(async ({ data, context }) => {
    const acesso = await permissoes(context.userId);
    if (!acesso.operacional)
      throw new Error("Forbidden: planejamento indisponivel para este perfil");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const baselineRes = await supabaseAdmin
      .from("planejamento_hh_baselines" as never)
      .select("id,nome,versao,arquivo_origem,criado_em" as never)
      .eq("obra_id" as never, data.obraId as never)
      .eq("ativa" as never, true as never)
      .maybeSingle();
    if (baselineRes.error) throw new Error(baselineRes.error.message);
    const baseline = baselineRes.data as unknown as {
      id: string;
      nome: string;
      versao: number;
      arquivo_origem: string;
      criado_em: string;
    } | null;
    if (!baseline)
      return {
        acessoFinanceiro: acesso.financeiro,
        baseline: null,
        linhas: [],
        totais: null,
        alertas: ["Baseline inexistente para este centro de custo."],
      };
    const inicio = new Date(`${data.dataInicial}T00:00:00`),
      fim = new Date(`${data.dataFinal}T00:00:00`);
    const [itens, funcionarios, registros, vigenciasRows, categorias] = await Promise.all([
      buscarTodasPaginas<ItemBase>(
        (from, to) =>
          supabaseAdmin
            .from("planejamento_hh_baseline_itens" as never)
            .select(
              "id,funcao_orcamento,categoria_mo_mapeada,tipo_mo,hh_previsto,custo_previsto" as never,
            )
            .eq("baseline_id" as never, baseline.id as never)
            .order("id" as never)
            .range(from, to) as never,
      ),
      buscarTodasPaginas<Funcionario>((from, to) =>
        supabaseAdmin
          .from("funcionarios")
          .select("id,deleted_at,visivel_obras_control")
          .order("id")
          .range(from, to),
      ),
      buscarTodasPaginas<Registro>(
        (from, to) =>
          supabaseAdmin
            .from("registros_horas")
            .select("funcionario_id,data,horas_normais,horas_extras,tipo_registro,falta_tipo")
            .eq("obra_id", data.obraId)
            .gte("data", data.dataInicial)
            .lte("data", data.dataFinal)
            .order("id")
            .range(from, to) as never,
      ),
      buscarTodasPaginas<CustoVigenciaRow>(
        (from, to) =>
          supabaseAdmin
            .from("funcionario_custos_vigencias" as never)
            .select(
              "funcionario_id,vigencia_inicio,vigencia_fim,categoria_mo,custo_mensal_total,status_historico" as never,
            )
            .lte("vigencia_inicio" as never, data.dataFinal as never)
            .or(`vigencia_fim.is.null,vigencia_fim.gte.${data.dataInicial}` as never)
            .order("funcionario_id" as never)
            .order("vigencia_inicio" as never)
            .range(from, to) as never,
      ),
      buscarTodasPaginas<{ nome: string; tipo: TipoMO }>(
        (from, to) =>
          supabaseAdmin
            .from("categorias")
            .select("nome,tipo")
            .order("nome")
            .range(from, to) as never,
      ),
    ]);
    const vigencias: CustoVigencia[] = vigenciasRows.map((v) => ({
      funcionarioId: v.funcionario_id,
      vigenciaInicio: v.vigencia_inicio,
      vigenciaFim: v.vigencia_fim,
      categoriaMo: v.categoria_mo,
      custoMensalTotal: Number(v.custo_mensal_total),
      statusHistorico: v.status_historico,
    }));
    const tipoMap = new Map(categorias.map((c) => [c.nome, c.tipo]));
    const funcMap = new Map(
      funcionarios
        .filter((f) => !f.deleted_at && f.visivel_obras_control !== false)
        .map((f) => [f.id, f]),
    );
    const diasUteis = diasUteisNoIntervalo(inicio, fim);
    type Acum = {
      funcao: string;
      tipo: TipoMO;
      hhPrevisto: number;
      hhRealizado: number;
      horasAusencia: number;
      custoPrevisto: number;
      custoRealizado: number;
      custos: Record<string, number>;
      ausencias: Record<string, number>;
      semMapeamento: boolean;
    };
    const linhas = new Map<string, Acum>();
    for (const item of itens) {
      const chave = item.categoria_mo_mapeada ?? `orcamento:${item.id}`;
      const l = linhas.get(chave) ?? {
        funcao: item.categoria_mo_mapeada ?? item.funcao_orcamento,
        tipo: item.tipo_mo,
        hhPrevisto: 0,
        hhRealizado: 0,
        horasAusencia: 0,
        custoPrevisto: 0,
        custoRealizado: 0,
        custos: {},
        ausencias: {},
        semMapeamento: !item.categoria_mo_mapeada,
      };
      l.hhPrevisto += Number(item.hh_previsto);
      l.custoPrevisto += Number(item.custo_previsto);
      linhas.set(chave, l);
    }
    for (const registro of registros) {
      const f = funcMap.get(registro.funcionario_id);
      if (!f) continue;
      const vigencia = vigenciaNaData(vigencias, f.id, registro.data);
      const categoria = vigencia?.categoriaMo ?? "Nao mapeado";
      const tipo = tipoMap.get(categoria) ?? "MOD";
      const l = linhas.get(categoria) ?? {
        funcao: categoria,
        tipo,
        hhPrevisto: 0,
        hhRealizado: 0,
        horasAusencia: 0,
        custoPrevisto: 0,
        custoRealizado: 0,
        custos: {},
        ausencias: {},
        semMapeamento: true,
      };
      const classif = classificarRegistroGerencial(registro);
      l.hhRealizado += classif.hhRealizado;
      l.horasAusencia += classif.horasAusencia;
      if (classif.tipoAusencia)
        l.ausencias[classif.tipoAusencia] =
          (l.ausencias[classif.tipoAusencia] ?? 0) + classif.horasAusencia;
      if (acesso.financeiro && vigencia) {
        const custo = custoRegistroNaVigencia({ vigencia, diasUteis, registro });
        const chaveCusto =
          registro.tipo_registro === "horas"
            ? "horas_trabalhadas"
            : (classif.tipoAusencia as TipoAusencia);
        l.custoRealizado += custo;
        l.custos[chaveCusto] = (l.custos[chaveCusto] ?? 0) + custo;
      }
      linhas.set(categoria, l);
    }
    const dtoLinhas = [...linhas.values()].map((l) => ({
      funcao: l.funcao,
      tipo: l.tipo,
      hhPrevisto: l.hhPrevisto,
      hhRealizado: l.hhRealizado,
      horasAusencia: l.horasAusencia,
      ...indicadores(l.hhPrevisto, l.hhRealizado),
      semMapeamento: l.semMapeamento,
      ausencias: l.ausencias,
      ...(acesso.financeiro
        ? {
            custoPrevisto: l.custoPrevisto,
            custoRealizado: l.custoRealizado,
            saldoCusto: l.custoPrevisto - l.custoRealizado,
            percentualCusto: indicadores(l.custoPrevisto, l.custoRealizado).percentual,
            composicaoCusto: l.custos,
          }
        : {}),
    }));
    const soma = (
      campo: "hhPrevisto" | "hhRealizado" | "horasAusencia" | "custoPrevisto" | "custoRealizado",
    ) => [...linhas.values()].reduce((s, l) => s + l[campo], 0);
    const hp = soma("hhPrevisto"),
      hr = soma("hhRealizado"),
      cp = soma("custoPrevisto"),
      cr = soma("custoRealizado");
    return {
      acessoFinanceiro: acesso.financeiro,
      baseline,
      linhas: dtoLinhas,
      totais: {
        hhPrevisto: hp,
        hhRealizado: hr,
        horasAusencia: soma("horasAusencia"),
        saldoHH: hp - hr,
        percentualHH: indicadores(hp, hr).percentual,
        ...(acesso.financeiro
          ? {
              custoPrevisto: cp,
              custoRealizado: cr,
              saldoCusto: cp - cr,
              percentualCusto: indicadores(cp, cr).percentual,
            }
          : {}),
      },
      alertas: [
        ...dtoLinhas
          .filter((l) => l.semMapeamento)
          .map((l) => `Funcao sem mapeamento: ${l.funcao}`),
        ...(acesso.financeiro &&
        registros.some(
          (r) =>
            vigenciaNaData(vigencias, r.funcionario_id, r.data)?.statusHistorico ===
            "estimado_inicial",
        )
          ? ["Parte do custo historico utiliza a base financeira disponivel na implantacao."]
          : []),
        ...(acesso.financeiro &&
        registros.some((r) => !vigenciaNaData(vigencias, r.funcionario_id, r.data))
          ? ["Existem apontamentos sem vigencia financeira reconciliada."]
          : []),
      ],
      periodo: { inicio: isoLocal(inicio), fim: isoLocal(fim) },
    };
  });

export const previewPlanejamentoHH = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        arquivoBase64: z.string().min(1),
        nomeArquivo: z.string().regex(/\.(xlsx|xlsm)$/i),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    if (!(await permissoes(context.userId)).financeiro) throw new Error("Forbidden");
    const { parseOrcamentoBuffer } = await import("@/lib/planejamento-hh-parser");
    return parseOrcamentoBuffer(Buffer.from(data.arquivoBase64, "base64"));
  });

export const salvarPlanejamentoHH = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) =>
    z
      .object({
        obraId: z.string().uuid(),
        nome: z.string().min(1),
        versao: z.number().int().positive(),
        nomeArquivo: z.string().min(1),
        itens: z.array(itemImportadoSchema).min(1),
        mapeamentos: z.array(
          z.object({
            funcaoOrcamento: z.string(),
            categoriaMo: z.string().nullable(),
            tipoMo: z.enum(["MOI", "MOD"]),
          }),
        ),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    if (!(await permissoes(context.userId)).financeiro) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const confirmados = data.mapeamentos
      .filter((m) => m.categoriaMo)
      .map((m) => ({
        funcao_orcamento_normalizada: normalizarFuncaoOrcamento(m.funcaoOrcamento),
        funcao_orcamento_original: m.funcaoOrcamento,
        categoria_mo: m.categoriaMo!,
        tipo_mo: m.tipoMo,
        confirmado_por: context.userId,
        confirmado_em: new Date().toISOString(),
      }));
    if (confirmados.length) {
      const mappingRes = await supabaseAdmin
        .from("planejamento_hh_mapeamentos" as never)
        .upsert(
          confirmados as never,
          { onConflict: "funcao_orcamento_normalizada,categoria_mo,tipo_mo" } as never,
        );
      if (mappingRes.error) throw new Error(mappingRes.error.message);
    }
    const baselineRes = await supabaseAdmin
      .from("planejamento_hh_baselines" as never)
      .insert({
        obra_id: data.obraId,
        nome: data.nome,
        versao: data.versao,
        arquivo_origem: data.nomeArquivo,
        criado_por: context.userId,
      } as never)
      .select("id" as never)
      .single();
    if (baselineRes.error) throw new Error(baselineRes.error.message);
    const baselineId = (baselineRes.data as unknown as { id: string }).id;
    const mapa = new Map(
      data.mapeamentos.map((m) => [
        `${normalizarFuncaoOrcamento(m.funcaoOrcamento)}|${m.tipoMo}`,
        m.categoriaMo,
      ]),
    );
    const rows = data.itens.map((i) => ({
      baseline_id: baselineId,
      funcao_orcamento: i.funcaoOrcamento,
      funcao_orcamento_normalizada: normalizarFuncaoOrcamento(i.funcaoOrcamento),
      categoria_mo_mapeada:
        mapa.get(`${normalizarFuncaoOrcamento(i.funcaoOrcamento)}|${i.tipoMo}`) ?? null,
      tipo_mo: i.tipoMo,
      hh_previsto: i.hhPrevisto,
      custo_previsto: i.custoPrevisto,
      origem: i.origem,
      metadata_calculo: i.metadataCalculo,
    }));
    const itemsRes = await supabaseAdmin
      .from("planejamento_hh_baseline_itens" as never)
      .insert(rows as never);
    if (itemsRes.error) {
      await supabaseAdmin
        .from("planejamento_hh_baselines" as never)
        .delete()
        .eq("id" as never, baselineId as never);
      throw new Error(itemsRes.error.message);
    }
    return { baselineId };
  });
