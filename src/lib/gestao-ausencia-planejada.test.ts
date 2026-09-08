import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  editarAusencia,
  excluirAusencia,
  permissoesAusencia,
  obterPeriodoAusencia,
  QUERIES_AUSENCIAS,
  type AusenciaSelecionada,
} from "./gestao-ausencia-planejada.ts";

const registro: AusenciaSelecionada = {
  id: "uuid-registro",
  funcionario_id: "func",
  obra_id: "obra",
  data: "2026-09-08",
  tipo_registro: "ferias",
  observacoes: null,
  created_by: "autor",
};
const periodo = {
  registro_id: registro.id,
  ausencia_periodo_id: "periodo-id",
  funcionario_id: registro.funcionario_id,
  obra_id: registro.obra_id,
  tipo_registro: registro.tipo_registro,
  data_inicio: "2026-09-07",
  data_fim: "2026-09-11",
  quantidade_dias: 5,
  observacoes: "Período real",
};
function fake(error: { code?: string; message: string } | null = null, data: unknown = periodo) {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { error, data };
    },
  };
  return { calls, client: client as unknown as Parameters<typeof editarAusencia>[0] };
}

for (const tipo_registro of ["ferias", "folga_campo"]) {
  const r = { ...registro, tipo_registro };
  test(`${tipo_registro}: registroOnly permite editar/excluir ao criador`, () => {
    assert.deepEqual(permissoesAusencia(true, r, "autor", "assistente"), {
      editar: true,
      excluir: true,
    });
    assert.deepEqual(permissoesAusencia(true, r, "outro", "assistente"), {
      editar: false,
      excluir: false,
    });
    assert.deepEqual(permissoesAusencia(true, r, "outro", "coordenador"), {
      editar: true,
      excluir: false,
    });
    for (const role of ["gerente", "diretor"] as const)
      assert.deepEqual(permissoesAusencia(true, r, "outro", role), { editar: true, excluir: true });
  });
  test(`${tipo_registro}: consulta o bloco real antes de editar por período`, async () => {
    const real = { ...periodo, tipo_registro };
    const { client, calls } = fake(null, real);
    assert.deepEqual(await obterPeriodoAusencia(client, r), real);
    assert.deepEqual(calls, [
      { name: "obras_obter_ausencia_planejada_periodo", args: { p_registro_id: r.id } },
    ]);
  });
  test(`${tipo_registro}: edição envia apenas UUID e limites para a RPC transacional`, async () => {
    const { client, calls } = fake();
    await editarAusencia(client, r, "2026-09-10", "2026-09-15", " ajuste ");
    assert.deepEqual(calls, [
      {
        name: "obras_editar_ausencia_planejada_periodo",
        args: {
          p_registro_id: r.id,
          p_data_inicio: "2026-09-10",
          p_data_fim: "2026-09-15",
          p_observacoes: "ajuste",
        },
      },
    ]);
  });
  test(`${tipo_registro}: confirmação precede RPC exclusiva com UUID real`, async () => {
    const { client, calls } = fake();
    assert.equal(await excluirAusencia(client, r, () => false), false);
    assert.equal(calls.length, 0);
    assert.equal(
      await excluirAusencia(client, r, () => {
        assert.equal(calls.length, 0);
        return true;
      }),
      true,
    );
    assert.deepEqual(calls, [
      { name: "obras_excluir_ausencia_planejada", args: { p_registro_id: r.id } },
    ]);
  });
}

test("outros registroOnly e registros com alocação não ganham ações", async () => {
  for (const tipo_registro of ["horas", "falta", "atestado", "afastamento", "outro"]) {
    const r = { ...registro, tipo_registro };
    assert.deepEqual(permissoesAusencia(true, r, "autor", "diretor"), {
      editar: false,
      excluir: false,
    });
    const { client, calls } = fake();
    await assert.rejects(() => excluirAusencia(client, r, () => true));
    await assert.rejects(() => editarAusencia(client, r, r.data, r.data, ""));
    await assert.rejects(() => obterPeriodoAusencia(client, r));
    assert.equal(calls.length, 0);
  }
  assert.deepEqual(permissoesAusencia(false, registro, "autor", "diretor"), {
    editar: false,
    excluir: false,
  });
  assert.deepEqual(permissoesAusencia(true, registro, undefined, "diretor"), {
    editar: false,
    excluir: false,
  });
});

for (const [error, mensagem] of [
  [{ code: "42501", message: "denied" }, /permissão/],
  [{ message: "Competencia fechada." }, /Competência fechada/],
  [{ message: "REGISTRO_HORAS_JA_EXISTE" }, /horas trabalhadas/],
  [{ message: "Registro nao encontrado ou ja excluido." }, /nao encontrado/],
] as const) {
  test(`backend: ${error.message} impede sucesso nas duas operações`, async () => {
    const { client } = fake(error);
    await assert.rejects(
      () => editarAusencia(client, registro, registro.data, registro.data, ""),
      mensagem,
    );
    await assert.rejects(() => obterPeriodoAusencia(client, registro), mensagem);
    await assert.rejects(() => excluirAusencia(client, registro, () => true), mensagem);
  });
}

test("interface conecta ações isoladas e mantém os fluxos de alocação", () => {
  const page = readFileSync(
    new URL("../routes/_authenticated/alocacoes.tsx", import.meta.url),
    "utf8",
  );
  const component = readFileSync(
    new URL("../components/AusenciaPlanejadaAcoes.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /a\.registroOnly &&\s+h &&\s+registroEhAusenciaPlanejada/);
  assert.match(page, /id: h\.id/);
  assert.match(page, /podeEditar && !a\.registroOnly/);
  assert.match(page, /podeExcluir && !a\.registroOnly/);
  assert.match(component, /permissoes\.editar/);
  assert.match(component, /permissoes\.excluir/);
  assert.match(component, />\s+Editar\s+<\/Button>/);
  assert.match(component, /size="icon"/);
  assert.match(component, /<Trash2 className="h-4 w-4 text-destructive"/);
  assert.match(component, /aria-label="Excluir lançamento"/);
  assert.match(component, /title="Excluir lançamento"/);
  assert.match(component, /onSuccess: \(resultado\) => \{[\s\S]*?setOpen\(true\)/);
  assert.match(component, /onClick=\{\(\) => carregarPeriodo.mutate\(\)\}/);
  assert.match(component, /Data inicial/);
  assert.match(component, /Data final/);
  assert.doesNotMatch(component, /Esta edição afeta somente o dia selecionado/);
  assert.match(component, /r\.id !== registro\.id/);
  assert.doesNotMatch(component, /obras_excluir_lancamento_dia|\.from\("alocacoes"\)/);
});

test("bloco retornado é respeitado sem inferir dias através de lacunas", async () => {
  const bloco = {
    ...periodo,
    data_inicio: "2026-09-10",
    data_fim: "2026-09-11",
    quantidade_dias: 2,
  };
  const { client } = fake(null, bloco);
  assert.deepEqual(await obterPeriodoAusencia(client, registro), bloco);
});

test("registro legado sem periodo_id aceita o bloco de um dia retornado pela RPC", async () => {
  const legado = {
    ...periodo,
    ausencia_periodo_id: null,
    data_inicio: registro.data,
    data_fim: registro.data,
    quantidade_dias: 1,
  };
  const { client } = fake(null, legado);
  assert.deepEqual(await obterPeriodoAusencia(client, registro), legado);
});

test("concorrência e intervalo inválido apresentam a falha da RPC sem operações parciais no frontend", async () => {
  for (const error of [
    {
      code: "40001",
      message: "O periodo foi alterado por outro usuario. Recarregue e tente novamente.",
    },
    { code: "22007", message: "PERIODO_AUSENCIA_INVALIDO" },
  ]) {
    const { client, calls } = fake(error);
    await assert.rejects(() => editarAusencia(client, registro, "2026-09-12", "2026-09-10", ""));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "obras_editar_ausencia_planejada_periodo");
  }
});

test("resposta inválida ou de outro registro não abre uma edição equivocada", async () => {
  for (const data of [
    null,
    {},
    { ...periodo, registro_id: "outro" },
    { ...periodo, funcionario_id: "outro" },
    { ...periodo, tipo_registro: "falta" },
  ]) {
    const { client } = fake(null, data);
    await assert.rejects(
      () => obterPeriodoAusencia(client, registro),
      /Não foi possível obter o período/,
    );
  }
});

test("atualização cobre calendário, detalhes, relatórios e planejamento sem salvar dia a dia", () => {
  for (const key of [
    "registros-mes",
    "registros-week",
    "registros-horas-detalhes",
    "relatorio-sem-alocacao",
    "relatorio-centros-custo",
    "planejamento-hh",
  ]) {
    assert.ok(QUERIES_AUSENCIAS.some((item) => item === key));
  }
  const helper = readFileSync(new URL("./gestao-ausencia-planejada.ts", import.meta.url), "utf8");
  assert.doesNotMatch(helper, /obras_salvar_registro_horas|obras_excluir_lancamento_dia|\.from\(/);
});

test("migration preserva exclusão isolada auditada e ACL fornecidos", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20260908120000_exclusao_ausencia_planejada_auditada.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.registros_horas_exclusoes/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path TO ''/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /competencia_fechada\(v_registro.data\)/);
  assert.match(sql, /coalesce\(v_registro.created_by = v_usuario, false\)/);
  assert.match(sql, /INSERT INTO public.registros_horas_exclusoes/);
  assert.match(sql, /to_jsonb\(v_registro\)/);
  assert.match(sql, /DELETE FROM public.registros_horas WHERE id = v_registro.id/);
  assert.doesNotMatch(sql, /DELETE FROM public.alocacoes|UPDATE public.alocacoes/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated/);
});
