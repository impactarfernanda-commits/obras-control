import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260828190537_supervisor_cc_vigencias.sql", import.meta.url),
  "utf8",
);
const diagnostico = readFileSync(
  new URL("../../supabase/manual/diagnostico_previa_supervisores_cc_20260825.sql", import.meta.url),
  "utf8",
);

test("migration cria vigencia sem sobreposicao, RLS e grants explicitos", () => {
  assert.match(migration, /^--[^\n]+\n--[^\n]+\nBEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /CREATE TABLE public\.funcionario_cc_vigencias/);
  assert.match(migration, /EXCLUDE USING gist[\s\S]+daterange/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.funcionario_cc_vigencias FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT SELECT ON TABLE public\.funcionario_cc_vigencias TO authenticated/,
  );
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE)[^;]+authenticated/);
});

test("RPC autentica, autoriza, serializa, valida categoria e usa competencia fechada canonica", () => {
  assert.match(migration, /transferir_supervisor_centro_custo/);
  for (const trecho of [
    "auth.uid() IS NULL",
    "has_role(auth.uid(), 'coordenador')",
    "has_role(auth.uid(), 'gerente')",
    "has_role(auth.uid(), 'diretor')",
    "FOR UPDATE",
    "obras_control_categoria_supervisor",
    "competencia_fechada(p_data_transferencia)",
    "p_data_transferencia - 1",
  ])
    assert.match(migration, new RegExp(trecho.replace(/[().]/g, "\\$&")));
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.transferir_supervisor_centro_custo[\s\S]+FROM PUBLIC, anon/,
  );
  assert.doesNotMatch(migration, /fc\.fechada\s+AND\s+fc\.data_fim/);
});

test("RPC exige obra existente sem restringir o status do centro de custo", () => {
  const rpc =
    migration.match(
      /CREATE OR REPLACE FUNCTION public\.transferir_supervisor_centro_custo[\s\S]+?\$function\$;/,
    )?.[0] ?? "";
  assert.match(
    rpc,
    /IF NOT EXISTS \(SELECT 1 FROM public\.obras o WHERE o\.id = p_novo_obra_id\) THEN/,
  );
  assert.match(rpc, /RAISE EXCEPTION 'Centro de custo inexistente\.'/);
  assert.doesNotMatch(rpc, /o\.status|status\s*=|status\s+IN/i);
  assert.doesNotMatch(rpc, /Centro de custo inexistente ou inativo/);
});

test("guard isola tipo_registro no ramo de registros_horas", () => {
  assert.match(migration, /NEW\.data < DATE '2026-08-25' THEN\s+RETURN NEW/);
  assert.match(
    migration,
    /IF TG_TABLE_NAME = 'registros_horas' THEN\s+IF NEW\.tipo_registro IN \('ferias', 'folga_campo'\) THEN\s+RETURN NEW;\s+END IF;\s+ELSIF TG_TABLE_NAME = 'alocacoes' THEN\s+NULL;\s+ELSE/,
  );
  const ramoAlocacoes =
    migration.match(/ELSIF TG_TABLE_NAME = 'alocacoes' THEN[\s\S]+?ELSE/)?.[0] ?? "";
  assert.doesNotMatch(ramoAlocacoes, /NEW\.tipo_registro/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.alocacoes/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.registros_horas/);
});

type CasoGuard = {
  nome: string;
  tabela: "alocacoes" | "registros_horas";
  data: string;
  supervisor: boolean;
  tipoRegistro?: "horas" | "falta" | "ferias" | "folga_campo";
  permitido: boolean;
};

const casosGuardSupervisor: CasoGuard[] = [
  {
    nome: "funcionario comum em alocacoes apos o corte",
    tabela: "alocacoes",
    data: "2026-08-25",
    supervisor: false,
    permitido: true,
  },
  {
    nome: "Supervisor em alocacoes apos o corte",
    tabela: "alocacoes",
    data: "2026-08-25",
    supervisor: true,
    permitido: false,
  },
  {
    nome: "Supervisor com horas",
    tabela: "registros_horas",
    data: "2026-08-25",
    supervisor: true,
    tipoRegistro: "horas",
    permitido: false,
  },
  {
    nome: "Supervisor com falta",
    tabela: "registros_horas",
    data: "2026-08-25",
    supervisor: true,
    tipoRegistro: "falta",
    permitido: false,
  },
  {
    nome: "Supervisor com ferias",
    tabela: "registros_horas",
    data: "2026-08-25",
    supervisor: true,
    tipoRegistro: "ferias",
    permitido: true,
  },
  {
    nome: "Supervisor com folga de campo",
    tabela: "registros_horas",
    data: "2026-08-25",
    supervisor: true,
    tipoRegistro: "folga_campo",
    permitido: true,
  },
  {
    nome: "historico de Supervisor anterior ao corte",
    tabela: "alocacoes",
    data: "2026-08-24",
    supervisor: true,
    permitido: true,
  },
  ...(["alocacoes", "horas", "falta"] as const).map((fluxo): CasoGuard => ({
    nome: `funcionario comum continua usando ${fluxo}`,
    tabela: fluxo === "alocacoes" ? "alocacoes" : "registros_horas",
    data: "2026-08-25",
    supervisor: false,
    tipoRegistro: fluxo === "alocacoes" ? undefined : fluxo,
    permitido: true,
  })),
];

function simularGuard(caso: CasoGuard) {
  if (caso.data < "2026-08-25") return true;
  if (
    caso.tabela === "registros_horas" &&
    (caso.tipoRegistro === "ferias" || caso.tipoRegistro === "folga_campo")
  )
    return true;
  return !caso.supervisor;
}

for (const caso of casosGuardSupervisor) {
  test(`guard: ${caso.nome}`, () => {
    assert.equal(simularGuard(caso), caso.permitido);
  });
}

test("permissao de transferencia exclui assistente e role Supervisor", () => {
  const blocoAutorizacao =
    migration.match(
      /IF NOT \([\s\S]+?\) THEN\s+RAISE EXCEPTION 'Sem permissao para transferir/,
    )?.[0] ?? "";
  assert.match(blocoAutorizacao, /'coordenador'/);
  assert.match(blocoAutorizacao, /'gerente'/);
  assert.match(blocoAutorizacao, /'diretor'/);
  assert.doesNotMatch(blocoAutorizacao, /'supervisor'|'assistente'/);
});

test("diagnostico de carga inicial e estritamente somente leitura", () => {
  assert.match(diagnostico, /SELECT[\s\S]+ultimo_cc/i);
  assert.doesNotMatch(diagnostico, /\b(INSERT|UPDATE|DELETE|MERGE|CALL)\b/i);
  assert.match(diagnostico, /DATE '2026-08-25'/);
});

test("interfaces filtram Supervisor por tipo de registro e oferecem transferencia", () => {
  const arquivos = [
    "../components/AlocarPeriodoDialog.tsx",
    "../components/CopiarDiaAnteriorDialog.tsx",
    "../routes/_authenticated/alocacoes.tsx",
  ].map((arquivo) => readFileSync(new URL(arquivo, import.meta.url), "utf8"));
  assert.match(arquivos[0], /supervisorPodeRegistrarTipoNoPeriodo/);
  assert.match(arquivos[1], /categoriaEhSupervisor/);
  assert.match(arquivos[2], /supervisorPodeRegistrarTipoNoPeriodo/);
  const funcionarios = readFileSync(
    new URL("../routes/_authenticated/funcionarios.tsx", import.meta.url),
    "utf8",
  );
  assert.match(funcionarios, /SupervisorCentroCustoDialog/);
  const dialogo = readFileSync(
    new URL("../components/SupervisorCentroCustoDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dialogo, /transferir_supervisor_centro_custo/);
  assert.match(dialogo, /Histórico de centro de custo/);
});

test("transferencia de Supervisor exibe os CCs recebidos sem filtro de status", () => {
  const dialogo = readFileSync(
    new URL("../components/SupervisorCentroCustoDialog.tsx", import.meta.url),
    "utf8",
  );
  const funcionarios = readFileSync(
    new URL("../routes/_authenticated/funcionarios.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dialogo, /\{obras\.map\(\(obra\) => \(/);
  assert.doesNotMatch(dialogo, /\.filter\([^)]*status|\.eq\([^)]*status|status\s*===?/i);
  assert.doesNotMatch(funcionarios, /\.eq\([^)]*["']status["']|status\s*===?/i);
});
