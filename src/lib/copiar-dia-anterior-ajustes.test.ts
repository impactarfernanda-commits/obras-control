import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  itensSelecionadosCopia,
  totalNaoCopiar,
  totalSelecionadosCopia,
  type ItemCopiaDia,
  type JornadaCopiaRascunho,
} from "./copiar-dia-anterior.ts";

const componente = readFileSync(
  new URL("../components/CopiarDiaAnteriorDialog.tsx", import.meta.url),
  "utf8",
);

const itens: ItemCopiaDia[] = [
  { funcionario_id: "a", nome: "A", status: "adicionar", motivo: null },
  { funcionario_id: "b", nome: "B", status: "adicionar", motivo: null },
  { funcionario_id: "c", nome: "C", status: "ja_existente", motivo: null },
  { funcionario_id: "d", nome: "D", status: "inelegivel", motivo: "Inelegível" },
  { funcionario_id: "e", nome: "E", status: "excluido_destino", motivo: "Excluído" },
];

function rascunho(funcionarioId: string, incluirNaCopia: boolean) {
  return {
    funcionarioId,
    incluirNaCopia,
    horaEntrada: "07:00",
    horaSaida: "17:00",
    intervaloMinutos: 60,
    horasNormais: 9,
    horasExtras: 0,
    justificativa: null,
    observacoes: null,
    detalhe: {} as JornadaCopiaRascunho["detalhe"],
    ajustada: false,
  } satisfies JornadaCopiaRascunho;
}

test("todos os elegíveis começam selecionados e o contador inicial é correto", () => {
  const rascunhos = { a: rascunho("a", true), b: rascunho("b", true) };
  assert.equal(totalSelecionadosCopia(itens, rascunhos), 2);
  assert.equal(totalNaoCopiar(itens, rascunhos), 0);
});

test("Não copiar diminui o contador e remove somente o item do lote", () => {
  const rascunhos = { a: rascunho("a", false), b: rascunho("b", true) };
  assert.equal(totalSelecionadosCopia(itens, rascunhos), 1);
  assert.equal(totalNaoCopiar(itens, rascunhos), 1);
  assert.deepEqual(
    itensSelecionadosCopia(itens, rascunhos).map((item) => item.funcionario_id),
    ["b"],
  );
});

test("Restaurar aumenta o contador novamente", () => {
  const rascunhos = { a: rascunho("a", true), b: rascunho("b", true) };
  assert.equal(totalSelecionadosCopia(itens, rascunhos), 2);
});

test("existente, inelegível e excluido_destino nunca entram no lote", () => {
  const rascunhos = Object.fromEntries(
    itens.map((item) => [item.funcionario_id, rascunho(item.funcionario_id, true)]),
  );
  assert.deepEqual(
    itensSelecionadosCopia(itens, rascunhos).map((item) => item.funcionario_id),
    ["a", "b"],
  );
});

test("prévia inicializa a edição com a jornada e observações da origem", () => {
  assert.match(componente, /hora_entrada, hora_saida, intervalo_padrao_minutos/);
  assert.match(componente, /justificativa_extras,observacoes/);
  assert.match(componente, /horaEntrada = alocacaoOrigem\?\.hora_entrada/);
  assert.match(componente, /horaSaida =\s*alocacaoOrigem\?\.hora_saida/);
  assert.match(componente, /intervaloMinutos = alocacaoOrigem\?\.intervalo_padrao_minutos/);
});

test("editar jornada recalcula HE e detalhe pela engine canônica", () => {
  assert.match(componente, /function atualizarJornadaRascunho/);
  assert.match(componente, /const detalhe = calcularJornadaDetalhada/);
  assert.match(componente, /minutosHe50/);
  assert.match(componente, /minutosHe100/);
  assert.match(componente, /minutosNoturnosRemuneraveis/);
  assert.match(componente, /Jornada ajustada/);
});

test("justificativa usa a regra canônica de HE e jornada excepcional", () => {
  assert.match(componente, /exigeJustificativaExtras/);
  assert.match(componente, /justificativaExtrasValida/);
  assert.match(componente, /Justificativa de hora extra/);
});

test("payload usa somente selecionados e grava a jornada ajustada no destino", () => {
  assert.match(componente, /const candidatos = itensSelecionadosCopia\(previa\.itens, rascunhos\)/);
  assert.match(componente, /data: previa\.destino_data/);
  assert.match(componente, /horaEntrada: rascunho\.horaEntrada/);
  assert.match(componente, /horaSaida: rascunho\.horaSaida/);
  assert.match(componente, /intervaloMinutos: rascunho\.intervaloMinutos/);
  assert.match(componente, /p_itens: itens/);
  assert.doesNotMatch(componente, /data: previa\.origem_data/);
});

test("Não copiar é estado local, restaurável e não cria exclusão ou supressão", () => {
  assert.match(componente, /definirInclusao\(item\.funcionario_id, false\)/);
  assert.match(componente, /definirInclusao\(item\.funcionario_id, true\)/);
  assert.match(componente, />\s*Restaurar\s*</);
  assert.doesNotMatch(componente, /obras_excluir_lancamento_dia/);
  assert.doesNotMatch(componente, /alocacoes_dia_exclusoes/);
});

test("cancelar ou fechar preserva o rascunho e descarte é explícito", () => {
  assert.match(componente, /usePersistentDraft<CopiarDiaDraft>/);
  assert.match(componente, /Descartar rascunho/);
  assert.match(componente, /clearDraft\(\);[\s\S]*resetForm\(\)/);
  assert.match(componente, /<Button variant="ghost" onClick=\{\(\) => setOpen\(false\)\}>/);
  assert.equal((componente.match(/obras_copiar_jornadas_v2/g) ?? []).length, 1);
});

test("contadores e botão usam a seleção dinâmica", () => {
  assert.match(componente, /<strong>\{naoCopiar\}<\/strong>/);
  assert.match(componente, /<strong>\{selecionados\}<\/strong>/);
  assert.match(componente, /`Copiar \$\{selecionados\} funcionários`/);
});

test("AJUDANTE mantém a resolução Civil ou Montagem no payload final", () => {
  assert.match(componente, /especialidadeAjudante: especialidadeNovaAlocacao/);
  assert.match(componente, /funcionariosAjudantesSemEspecialidade\(candidatos, escolhas\)/);
});
