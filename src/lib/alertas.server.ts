import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Severidade = "info" | "warning" | "critical";

interface AlertaInput {
  tipo: string;
  titulo: string;
  mensagem: string;
  severidade: Severidade;
  metadata?: Record<string, unknown>;
  dedupe_key: string;
}

function getAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const DEFAULTS = {
  horas_extras_semanal: 15,
  pct_acima_media: 120,
  dias_ausencia: 5,
  dias_sem_lancamento: 3,
  dias_sem_alocacao: 30,
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Folha mensal: dia 25 do mês anterior até dia 24 do mês de competência.
// Retorna "YYYY-MM" da competência para uma data ISO.
function payrollMonthKey(isoDay: string): string {
  const [yStr, mStr, dStr] = isoDay.split("-");
  const y = Number(yStr), m = Number(mStr), day = Number(dStr);
  const dt = new Date(y, m - 1 + (day >= 25 ? 1 : 0), 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

export async function runAlertChecks(): Promise<{ created: number; alerts: number }> {
  const admin = getAdmin();
  const hoje = new Date();
  const hojeStr = isoDate(hoje);

  // Recipients: assistente, supervisor, coordenador, gerente, diretor
  const { data: roleRows } = await admin
    .from("user_roles")
    .select("user_id, role");
  const recipients = Array.from(
    new Set((roleRows ?? []).filter((r) => r.role !== null).map((r) => r.user_id as string))
  );
  if (recipients.length === 0) return { created: 0, alerts: 0 };

  const alerts: AlertaInput[] = [];

  // === 1. Funcionarios sem alocacao no ultimo mes ===
  const desdeAlocacao = new Date(hoje);
  desdeAlocacao.setDate(desdeAlocacao.getDate() - DEFAULTS.dias_sem_alocacao);
  const { data: funcAtivos } = await admin
    .from("funcionarios")
    .select("id, nome")
    .eq("ativo", true);

  if (funcAtivos?.length) {
    const ids = funcAtivos.map((f) => f.id);
    const { data: alocs } = await admin
      .from("alocacoes")
      .select("funcionario_id")
      .gte("data", isoDate(desdeAlocacao))
      .in("funcionario_id", ids);
    const { data: regs } = await admin
      .from("registros_horas")
      .select("funcionario_id")
      .gte("data", isoDate(desdeAlocacao))
      .in("funcionario_id", ids);
    const comAtividade = new Set<string>([
      ...((alocs ?? []).map((a) => a.funcionario_id as string)),
      ...((regs ?? []).map((r) => r.funcionario_id as string)),
    ]);

    // Histórico completo para identificar quem nunca foi alocado
    const { data: alocsAll } = await admin
      .from("alocacoes")
      .select("funcionario_id")
      .in("funcionario_id", ids);
    const { data: regsAll } = await admin
      .from("registros_horas")
      .select("funcionario_id")
      .in("funcionario_id", ids);
    const jaAlocado = new Set<string>([
      ...((alocsAll ?? []).map((a) => a.funcionario_id as string)),
      ...((regsAll ?? []).map((r) => r.funcionario_id as string)),
    ]);

    for (const f of funcAtivos) {
      if (!jaAlocado.has(f.id)) {
        alerts.push({
          tipo: "nunca_alocado",
          titulo: `Funcionário nunca alocado: ${f.nome}`,
          mensagem: `${f.nome} está cadastrado como ativo mas nunca foi alocado a nenhuma obra. Faça a primeira alocação ou desative o cadastro.`,
          severidade: "warning",
          metadata: { funcionario_id: f.id, funcionario_nome: f.nome },
          dedupe_key: `nunca_alocado:${f.id}:${hojeStr}`,
        });
      } else if (!comAtividade.has(f.id)) {
        alerts.push({
          tipo: "sem_alocacao",
          titulo: `Funcionário sem alocação: ${f.nome}`,
          mensagem: `${f.nome} está ativo mas não possui alocação nem registro de horas nos últimos ${DEFAULTS.dias_sem_alocacao} dias. Verifique se está de folga de campo, férias, afastado, desligado ou se a alocação foi esquecida.`,
          severidade: "warning",
          metadata: { funcionario_id: f.id, funcionario_nome: f.nome },
          dedupe_key: `sem_alocacao:${f.id}:${hojeStr}`,
        });
      }
    }
  }


  // === 2. Horas extras > 15h/semana ===
  const semanaIni = new Date(hoje);
  semanaIni.setDate(semanaIni.getDate() - 7);
  const { data: regSemana } = await admin
    .from("registros_horas")
    .select("funcionario_id, horas_extras, funcionarios(nome)")
    .gte("data", isoDate(semanaIni));
  if (regSemana) {
    const acc = new Map<string, { total: number; nome: string }>();
    for (const r of regSemana as Array<{ funcionario_id: string; horas_extras: number; funcionarios: Array<{ nome: string }> | null }>) {
      const cur = acc.get(r.funcionario_id) ?? { total: 0, nome: r.funcionarios?.[0]?.nome ?? "?" };
      cur.total += Number(r.horas_extras || 0);
      acc.set(r.funcionario_id, cur);
    }
    for (const [fid, info] of acc) {
      if (info.total > DEFAULTS.horas_extras_semanal) {
        alerts.push({
          tipo: "horas_extras",
          titulo: `Horas extras elevadas: ${info.nome}`,
          mensagem: `${info.nome} acumulou ${info.total.toFixed(1)}h extras nos últimos 7 dias (limite: ${DEFAULTS.horas_extras_semanal}h).`,
          severidade: info.total > DEFAULTS.horas_extras_semanal * 1.5 ? "critical" : "warning",
          metadata: { funcionario_id: fid, funcionario_nome: info.nome, horas: info.total },
          dedupe_key: `horas_extras:${fid}:${hojeStr}`,
        });
      }
    }
  }

  // === 3. Custo mensal > 120% da media ===
  const { data: custos } = await admin
    .from("custos_indiretos")
    .select("obra_id, valor, data, obras(nome)");
  if (custos?.length) {
    const porObraMes = new Map<string, Map<string, number>>();
    const obraNome = new Map<string, string>();
    for (const c of custos as Array<{ obra_id: string; valor: number; data: string; obras: Array<{ nome: string }> | null }>) {
      const mes = payrollMonthKey(c.data);
      if (!porObraMes.has(c.obra_id)) porObraMes.set(c.obra_id, new Map());
      const m = porObraMes.get(c.obra_id)!;
      m.set(mes, (m.get(mes) ?? 0) + Number(c.valor || 0));
      if (c.obras?.[0]?.nome) obraNome.set(c.obra_id, c.obras[0].nome);
    }
    const mesAtual = payrollMonthKey(hojeStr);
    for (const [oid, meses] of porObraMes) {
      const atual = meses.get(mesAtual) ?? 0;
      const historicos = [...meses.entries()].filter(([m]) => m !== mesAtual).map(([, v]) => v);
      if (historicos.length === 0 || atual === 0) continue;
      const media = historicos.reduce((s, v) => s + v, 0) / historicos.length;
      const pct = (atual / media) * 100;
      if (pct > DEFAULTS.pct_acima_media) {
        alerts.push({
          tipo: "custo_acima_media",
          titulo: `Custo elevado: ${obraNome.get(oid) ?? "obra"}`,
          mensagem: `Custos indiretos do mês em ${obraNome.get(oid) ?? "obra"} atingiram R$ ${atual.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} (${pct.toFixed(0)}% da média histórica de R$ ${media.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}).`,
          severidade: pct > 150 ? "critical" : "warning",
          metadata: { obra_id: oid, obra_nome: obraNome.get(oid), valor_atual: atual, media },
          dedupe_key: `custo_acima_media:${oid}:${mesAtual}`,
        });
      }
    }
  }

  // === 4. Funcionarios com > 5 dias consecutivos de ausencia ===
  const desdeAus = new Date(hoje);
  desdeAus.setDate(desdeAus.getDate() - 30);
  const { data: ausencias } = await admin
    .from("registros_horas")
    .select("funcionario_id, data, ausencia, funcionarios(nome)")
    .eq("ausencia", true)
    .gte("data", isoDate(desdeAus))
    .order("data", { ascending: true });
  if (ausencias) {
    const porFunc = new Map<string, { datas: string[]; nome: string }>();
    for (const a of ausencias as Array<{ funcionario_id: string; data: string; funcionarios: Array<{ nome: string }> | null }>) {
      const cur = porFunc.get(a.funcionario_id) ?? { datas: [], nome: a.funcionarios?.[0]?.nome ?? "?" };
      cur.datas.push(a.data);
      porFunc.set(a.funcionario_id, cur);
    }
    for (const [fid, info] of porFunc) {
      // contar maior sequência consecutiva
      let max = 1, cur = 1;
      for (let i = 1; i < info.datas.length; i++) {
        const prev = new Date(info.datas[i - 1]);
        const next = new Date(info.datas[i]);
        const diff = (next.getTime() - prev.getTime()) / 86400000;
        if (diff === 1) { cur++; max = Math.max(max, cur); } else { cur = 1; }
      }
      if (max > DEFAULTS.dias_ausencia) {
        alerts.push({
          tipo: "ausencia_consecutiva",
          titulo: `Ausência prolongada: ${info.nome}`,
          mensagem: `${info.nome} possui ${max} dias consecutivos de ausência registrados.`,
          severidade: "warning",
          metadata: { funcionario_id: fid, funcionario_nome: info.nome, dias: max },
          dedupe_key: `ausencia_consecutiva:${fid}:${hojeStr}`,
        });
      }
    }
  }

  // === 5. Obras sem lancamentos ha > 3 dias ===
  const { data: obras } = await admin.from("obras").select("id, nome");
  if (obras?.length) {
    const { data: ultimos } = await admin
      .from("registros_horas")
      .select("obra_id, data")
      .order("data", { ascending: false });
    const ultimoPorObra = new Map<string, string>();
    for (const r of ultimos ?? []) {
      if (!ultimoPorObra.has(r.obra_id as string)) {
        ultimoPorObra.set(r.obra_id as string, r.data as string);
      }
    }
    for (const o of obras) {
      const ult = ultimoPorObra.get(o.id);
      const diff = ult
        ? Math.floor((hoje.getTime() - new Date(ult).getTime()) / 86400000)
        : 999;
      if (diff > DEFAULTS.dias_sem_lancamento) {
        alerts.push({
          tipo: "obra_sem_lancamento",
          titulo: `Obra sem lançamentos: ${o.nome}`,
          mensagem: ult
            ? `A obra ${o.nome} não recebe registros de horas há ${diff} dias (último: ${new Date(ult).toLocaleDateString("pt-BR")}).`
            : `A obra ${o.nome} nunca recebeu registros de horas.`,
          severidade: diff > 7 ? "critical" : "warning",
          metadata: { obra_id: o.id, obra_nome: o.nome, dias: diff },
          dedupe_key: `obra_sem_lancamento:${o.id}:${hojeStr}`,
        });
      }
    }
  }

  // === Insert (broadcast por usuário) ===
  if (alerts.length === 0) return { created: 0, alerts: 0 };

  const rows = recipients.flatMap((uid) =>
    alerts.map((a) => ({
      user_id: uid,
      tipo: a.tipo,
      titulo: a.titulo,
      mensagem: a.mensagem,
      severidade: a.severidade,
      metadata: a.metadata ?? {},
      dedupe_key: `${uid}:${a.dedupe_key}`,
    }))
  );

  // upsert by dedupe_key
  const { error, count } = await admin
    .from("notificacoes")
    .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true, count: "exact" });
  if (error) throw error;

  return { created: count ?? 0, alerts: alerts.length };
}
