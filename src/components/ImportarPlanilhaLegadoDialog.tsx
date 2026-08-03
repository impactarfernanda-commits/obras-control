import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  buscarCompetenciasFechadasPorDatas,
  MENSAGEM_COMPETENCIA_FECHADA,
} from "@/lib/competencias";
import { detalhesErroBancoAlocacao } from "@/lib/alocacoes-conflitos";
import { canImportarPlanilhaLegado } from "@/lib/permissoes-especiais";
import { buscarTodasPaginas } from "@/lib/paginacao";
import {
  conciliarCentroCusto,
  criarIndiceCentrosExistentes,
  interpretarCentroCusto,
  type TipoMaoObraLegado,
} from "@/lib/importacao-legado-centros";
import {
  conciliarCelulasComAlocacoesExistentes,
  criarSourceCellKey,
} from "@/lib/importacao-legado-auditoria";
import {
  alocacoesAposDesligamento,
  dataLocalISO,
  desligamentosParaAtualizar,
  planejarDesligamento,
  validarDesligamentosAplicados,
  type DesligamentoIdentificado,
} from "@/lib/importacao-legado-desligamentos";

type TipoMaoObra = TipoMaoObraLegado;
type LegacyCell = { codigoBase: string; tipoMaoObra: TipoMaoObra; raw: string };
type DateColumn = { index: number; date: string; label: string };
type FuncionarioExistente = {
  id: string;
  nome: string;
  categoria_mo: string | null;
  ativo: boolean;
  deleted_at: string | null;
  data_admissao: string | null;
  data_desligamento: string | null;
};
type AdmissaoAlterar = {
  funcionarioId: string;
  nome: string;
  data: string;
  tipo: "preencher" | "atualizar";
};
type ObraExistente = { id: string; nome: string; codigo?: string | number | null };
type CategoriaSalarioConfig = {
  categoria: string;
  salario: number;
  encargos: number;
  seguro_vida: number | null;
};
type AlocacaoExistente = {
  id: string;
  funcionario_id: string;
  obra_id: string;
  data: string;
  obras?: { nome: string } | null;
};
type AlocacaoAnterior = {
  funcionario_id: string;
  obra_id: string;
  data: string;
  tipo_mao_obra: TipoMaoObra | null;
};
type FuncionarioNovo = {
  key: string;
  nome: string;
  funcao: string;
  categoria: string;
  salario: number;
  encargos: number;
  data_admissao: string | null;
  rowNumber: number;
};
type AlocacaoImportacao = {
  sourceCellKey: string;
  funcionarioKey: string;
  funcionarioNome: string;
  funcionarioId?: string;
  obraId: string;
  centroCusto: string;
  codigoBase: string;
  valorOriginal: string;
  data: string;
  tipoMaoObra: TipoMaoObra;
};
type Preview = {
  modo: "completo" | "admissoes";
  totalFuncionariosEncontrados: number;
  funcionariosCriar: FuncionarioNovo[];
  funcoesEncontradas: string[];
  funcoesReconhecidas: string[];
  funcoesSemSalario: string[];
  funcionariosSemSalario: string[];
  duplicadosIgnorados: string[];
  obrasEncontradas: string[];
  obrasNaoEncontradas: string[];
  celulasAlocacaoIdentificadas: number;
  alocacoesJaExistentes: string[];
  matchesAdicionaisBanco: number;
  duplicidadesHistoricasBanco: string[];
  duplicidadesInternasPlanilha: string[];
  totalCelulasPeriodo: number;
  totalCelulasConciliadas: number;
  outrosBloqueios: number;
  alocacoesValidas: AlocacaoImportacao[];
  celulasVazias: number;
  celulasDesligado: number;
  sedesEncontradas: number;
  sedesResolvidas: string[];
  sedesSemCentroAnterior: string[];
  desligamentos: DesligamentoIdentificado[];
  alocacoesAposDesligamento: string[];
  funcionariosAtivosAusentes: string[];
  erros: string[];
  ignorados: string[];
  inconsistencias: string[];
  admissoesLidas: number;
  admissoesAlterar: AdmissaoAlterar[];
  admissoesIguais: string[];
  admissoesIgnoradas: string[];
  conflitosNomes: string[];
  funcionariosNaoEncontrados: string[];
  funcionariosEncontrados: string[];
  funcionariosDesligados: string[];
  funcionariosExcluidosConflitantes: string[];
  funcoesNaoReconhecidas: string[];
  datas: string[];
  bloqueado: boolean;
};
type ErrorLike = { message?: string };
const MENSAGEM_SEM_PERMISSAO_IMPORTAR =
  "Importação legado disponível apenas para a conta autorizada.";
const MONTHS: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};
const CARGOS_SEMPRE_INDIRETOS = new Set([
  "supervisor i",
  "supervisor ii",
  "supervisor iii",
  "supervisor obra",
  "assistente administrativo obras",
  "assistente de engenharia",
  "tecnico de seguranca do trabalho",
]);
function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function parseExcelDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dataLocalISO(value);
  if (typeof value === "number") {
    const p = XLSX.SSF.parse_date_code(value);
    return p ? p.y + "-" + pad(p.m) + "-" + pad(p.d) : null;
  }
  const text = String(value).trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const yearRaw = Number(m[3]);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const month = Number(m[2]);
  const day = Number(m[1]);
  const candidate = year + "-" + pad(month) + "-" + pad(day);
  const parsed = new Date(candidate + "T00:00:00");
  return !Number.isNaN(parsed.getTime()) &&
    parsed.getFullYear() === year &&
    parsed.getMonth() + 1 === month &&
    parsed.getDate() === day
    ? candidate
    : null;
}
function parseHeaderDate(value: unknown, fallbackYear: number) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dataLocalISO(value);
  if (typeof value === "number") {
    const p = XLSX.SSF.parse_date_code(value);
    return p ? p.y + "-" + pad(p.m) + "-" + pad(p.d) : null;
  }
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  const m = text.match(/^(\d{1,2})\s*\/\s*([a-zç]{3})$/i);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
  if (!month) return null;
  let year = fallbackYear;
  if (month === 12 && day >= 25) year -= 1;
  return year + "-" + pad(month) + "-" + pad(day);
}
function normalizarCelulaLegado(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
function parseCell(
  value: unknown,
): "empty" | "desligado" | "sede" | LegacyCell | { error: string } {
  const normalizado = normalizarCelulaLegado(value);
  const raw = normalizado.toUpperCase();
  if (!raw) return "empty";
  if (normalizado === "d" || normalizado === "desligado") return "desligado";
  if (normalizado === "sede") return "sede";
  const centro = interpretarCentroCusto(value);
  if (!centro) return { error: "Formato desconhecido: " + raw };
  return {
    codigoBase: centro.codigoBase,
    tipoMaoObra: centro.tipoMaoObra,
    raw: centro.valorOriginal,
  };
}
function horasNormais(dateISO: string) {
  const dow = new Date(dateISO + "T00:00:00").getDay();
  if (dow === 5) return 8;
  if (dow === 0 || dow === 6) return 0;
  return 9;
}
function formatDate(dateISO: string) {
  return new Date(dateISO + "T00:00:00").toLocaleDateString("pt-BR");
}
function table(name: string) {
  return supabase.from(name as never);
}
function findCategoriaConfig(funcao: string, categorias: Map<string, CategoriaSalarioConfig>) {
  return categorias.get(normalizeName(funcao));
}
function tipoMaoObraFinal(funcao: string, tipoDaCelula: TipoMaoObra): TipoMaoObra {
  return CARGOS_SEMPRE_INDIRETOS.has(normalizeName(funcao)) ? "indireta" : tipoDaCelula;
}
function emptyPreview(error: string): Preview {
  return {
    modo: "completo",
    totalFuncionariosEncontrados: 0,
    funcionariosCriar: [],
    funcoesEncontradas: [],
    funcoesReconhecidas: [],
    funcoesSemSalario: [],
    funcionariosSemSalario: [],
    duplicadosIgnorados: [],
    obrasEncontradas: [],
    obrasNaoEncontradas: [],
    celulasAlocacaoIdentificadas: 0,
    alocacoesJaExistentes: [],
    matchesAdicionaisBanco: 0,
    duplicidadesHistoricasBanco: [],
    duplicidadesInternasPlanilha: [],
    totalCelulasPeriodo: 0,
    totalCelulasConciliadas: 0,
    outrosBloqueios: 0,
    alocacoesValidas: [],
    celulasVazias: 0,
    celulasDesligado: 0,
    sedesEncontradas: 0,
    sedesResolvidas: [],
    sedesSemCentroAnterior: [],
    desligamentos: [],
    alocacoesAposDesligamento: [],
    funcionariosAtivosAusentes: [],
    erros: [error],
    ignorados: [],
    inconsistencias: [],
    admissoesLidas: 0,
    admissoesAlterar: [],
    admissoesIguais: [],
    admissoesIgnoradas: [],
    conflitosNomes: [],
    funcionariosNaoEncontrados: [],
    funcionariosEncontrados: [],
    funcionariosDesligados: [],
    funcionariosExcluidosConflitantes: [],
    funcoesNaoReconhecidas: [],
    datas: [],
    bloqueado: true,
  };
}

export function ImportarPlanilhaLegadoDialog() {
  const { user } = useAuth();
  // Restrição nominal de frontend; uma proteção futura deve confirmar a importação em RPC.
  const canImportar = canImportarPlanilhaLegado(user?.email);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const podeImportar = useMemo(
    () =>
      canImportar &&
      preview &&
      !preview.bloqueado &&
      (preview.alocacoesValidas.length > 0 ||
        preview.admissoesAlterar.length > 0 ||
        desligamentosParaAtualizar(preview.desligamentos).length > 0 ||
        preview.funcionariosCriar.length > 0 ||
        (preview.modo === "admissoes" && preview.admissoesIguais.length > 0)),
    [canImportar, preview],
  );
  function bloquearSemPermissao() {
    setPreview(emptyPreview(MENSAGEM_SEM_PERMISSAO_IMPORTAR));
    toast.error(MENSAGEM_SEM_PERMISSAO_IMPORTAR);
  }
  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !canImportar) {
      bloquearSemPermissao();
      return;
    }
    setOpen(nextOpen);
  }
  async function carregarArquivo(file: File) {
    if (!canImportar) {
      bloquearSemPermissao();
      return;
    }
    setLoading(true);
    setPreview(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets.Planilha1 ?? workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("A planilha não possui abas para importar.");
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const result = await montarPreview(rows);
      setPreview(result);
      toast.success("Planilha lida para conferência.");
    } catch (e) {
      const message = (e as ErrorLike).message ?? "Erro ao ler planilha";
      setPreview(emptyPreview(message));
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }
  async function montarPreview(rows: unknown[][]): Promise<Preview> {
    const erros: string[] = [];
    const ignorados: string[] = [];
    const inconsistencias: string[] = [];
    const admissoesIgnoradas: string[] = [];
    const desligamentos = new Map<string, DesligamentoIdentificado>();
    let celulasVazias = 0;
    let celulasDesligado = 0;
    let celulasInvalidas = 0;
    let celulasCentroNaoEncontrado = 0;
    let outrosBloqueios = 0;
    let totalCelulasPeriodo = 0;
    let sedesEncontradas = 0;
    const sedesResolvidas: string[] = [];
    const sedesSemCentroAnterior: string[] = [];
    const header = rows[0] ?? [];
    const dateColumns: DateColumn[] = [];
    const fallbackYear = new Date().getFullYear();
    for (let c = 4; c < header.length; c += 1) {
      const date = parseHeaderDate(header[c], fallbackYear);
      if (!date) {
        if (String(header[c] ?? "").trim())
          erros.push("Cabeçalho de data inválido na coluna " + (c + 1) + ": " + String(header[c]));
        continue;
      }
      dateColumns.push({ index: c, date, label: String(header[c]) });
    }
    dateColumns.sort((a, b) => a.date.localeCompare(b.date));
    const funcionariosPorNome = new Map<
      string,
      { row: unknown[]; nome: string; funcao: string; admissao: string | null; rowNumber: number }
    >();
    const duplicadosIgnorados: string[] = [];
    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r] ?? [];
      const nome = String(row[1] ?? "").trim();
      if (!nome) continue;
      const funcao = String(row[2] ?? "").trim() || "Sem categoria";
      const admissao = parseExcelDate(row[3]);
      const key = normalizeName(nome);
      const atual = funcionariosPorNome.get(key);
      if (!atual) {
        funcionariosPorNome.set(key, { row, nome, funcao, admissao, rowNumber: r + 1 });
        continue;
      }
      const atualDate = atual.admissao ?? "9999-12-31";
      const novaDate = admissao ?? "9999-12-31";
      if (novaDate < atualDate) {
        duplicadosIgnorados.push(
          atual.nome +
            " (linha " +
            atual.rowNumber +
            ") ignorado; mantida admissão mais antiga da linha " +
            (r + 1) +
            ".",
        );
        funcionariosPorNome.set(key, { row, nome, funcao, admissao, rowNumber: r + 1 });
      } else {
        duplicadosIgnorados.push(
          nome + " (linha " + (r + 1) + ") ignorado; já existe linha com admissão mais antiga.",
        );
      }
    }
    const modo: Preview["modo"] = dateColumns.length > 0 ? "completo" : "admissoes";
    const possuiAdmissaoValida = Array.from(funcionariosPorNome.values()).some((f) =>
      Boolean(f.admissao),
    );
    const { data: funcsData, error: funcsError } = await supabase.rpc(
      "obras_control_funcionarios_safe",
    );
    if (funcsError) throw funcsError;
    const funcionariosExistentes = (funcsData ?? []) as unknown as FuncionarioExistente[];
    const funcionariosAtivosAusentes = funcionariosExistentes
      .filter((f) => f.ativo && !f.deleted_at && !funcionariosPorNome.has(normalizeName(f.nome)))
      .map((f) => `${f.nome}: ativo no banco e não localizado na planilha importada.`)
      .sort();
    const funcionariosPorNomeExistentes = new Map<string, FuncionarioExistente[]>();
    for (const f of funcionariosExistentes) {
      const key = normalizeName(f.nome);
      const grupo = funcionariosPorNomeExistentes.get(key) ?? [];
      grupo.push(f);
      funcionariosPorNomeExistentes.set(key, grupo);
    }
    const conflitosNomes: string[] = [];
    const conflitoKeys = new Set<string>();
    const funcMap = new Map<string, FuncionarioExistente>();
    for (const [key, grupo] of funcionariosPorNomeExistentes) {
      const naoExcluidos = grupo.filter((f) => !f.deleted_at);
      if (naoExcluidos.length > 1) {
        conflitoKeys.add(key);
        conflitosNomes.push(
          `${naoExcluidos[0].nome}: mais de um cadastro não excluído com o mesmo nome normalizado.`,
        );
      } else if (naoExcluidos.length === 1) funcMap.set(key, naoExcluidos[0]);
      else if (grupo.length === 1) funcMap.set(key, grupo[0]);
    }
    const admissoesAlterar: AdmissaoAlterar[] = [];
    const admissoesIguais: string[] = [];
    const funcionariosNaoEncontrados: string[] = [];
    const funcionariosEncontrados: string[] = [];
    const funcionariosDesligados: string[] = [];
    const funcionariosExcluidosConflitantes: string[] = [];
    let admissoesLidas = 0;
    for (const [key, item] of funcionariosPorNome) {
      const rawAdmissao = item.row[3];
      const vazia = rawAdmissao == null || String(rawAdmissao).trim() === "";
      if (vazia) admissoesIgnoradas.push(`${item.nome}: sem data de admissão.`);
      else if (!item.admissao)
        admissoesIgnoradas.push(
          `${item.nome}: data de admissão inválida (${String(rawAdmissao)}).`,
        );
      else admissoesLidas += 1;
      if (conflitoKeys.has(key)) continue;
      const existente = funcMap.get(key);
      if (modo === "admissoes" && !existente) {
        funcionariosNaoEncontrados.push(`${item.nome}: funcionário não encontrado.`);
      }
      if (existente?.deleted_at) {
        const aviso =
          "Existe um funcionário excluído com este nome. Verifique se deve criar novo cadastro ou revisar o cadastro excluído: " +
          item.nome;
        funcionariosExcluidosConflitantes.push(aviso);
        erros.push(aviso);
      }
      if (existente && !existente.deleted_at) {
        funcionariosEncontrados.push(`${item.nome}: cadastro existente localizado.`);
        if (!existente.ativo)
          funcionariosDesligados.push(`${item.nome}: desligado/inativo, sem reativação.`);
      }
      if (existente && !existente.deleted_at && item.admissao) {
        if (existente.data_admissao === item.admissao)
          admissoesIguais.push(`${item.nome}: ${formatDate(item.admissao)} mantida.`);
        else
          admissoesAlterar.push({
            funcionarioId: existente.id,
            nome: item.nome,
            data: item.admissao,
            tipo: existente.data_admissao ? "atualizar" : "preencher",
          });
      }
    }
    const { data: obrasData, error: obrasError } = await supabase.from("obras").select("*");
    if (obrasError) throw obrasError;
    const obrasExistentes = (obrasData ?? []) as ObraExistente[];
    const centrosPorCodigo = criarIndiceCentrosExistentes(obrasExistentes);
    const obraPorId = new Map(obrasExistentes.map((obra) => [obra.id, obra]));
    const { data: salData, error: salError } = await supabase
      .from("categoria_salarios")
      .select("categoria,salario,encargos,seguro_vida");
    if (salError) throw salError;
    const categoriaMap = new Map<string, CategoriaSalarioConfig>();
    for (const c of (salData ?? []) as CategoriaSalarioConfig[]) {
      if (Number(c.salario) > 0) categoriaMap.set(normalizeName(c.categoria), c);
    }
    const funcoesEncontradas = Array.from(
      new Set(
        Array.from(funcionariosPorNome.values())
          .map((f) => f.funcao)
          .filter(Boolean),
      ),
    ).sort();
    const funcoesReconhecidas = funcoesEncontradas.filter((f) =>
      Boolean(findCategoriaConfig(f, categoriaMap)),
    );
    const funcoesSemSalario = funcoesEncontradas.filter(
      (f) => !findCategoriaConfig(f, categoriaMap),
    );
    const funcoesNaoReconhecidas: string[] = [];
    const funcionariosSemSalario: string[] = [];
    const rowHasError = new Set<string>();
    for (const key of conflitoKeys) rowHasError.add(key);
    for (const [funcKey, item] of funcionariosPorNome) {
      if (!funcMap.has(funcKey) && !findCategoriaConfig(item.funcao, categoriaMap)) {
        rowHasError.add(funcKey);
        funcionariosSemSalario.push(item.nome + " - " + item.funcao);
        funcoesNaoReconhecidas.push(
          `${item.nome}: função “${item.funcao}” não reconhecida (linha ${item.rowNumber}).`,
        );
        erros.push(
          "Cargo/função sem salário configurado: " +
            item.funcao +
            ". Cadastre o salário desse cargo em Configurações antes de importar.",
        );
      }
    }
    const alocacoes: AlocacaoImportacao[] = [];
    const obrasEncontradas = new Set<string>();
    const obrasNaoEncontradas = new Map<string, string>();
    const duplicidadesInternasPlanilha: string[] = [];
    const planilhaFuncionarioData = new Map<string, AlocacaoImportacao>();
    const ultimaAlocacaoPorFuncionario = new Map<string, AlocacaoAnterior>();
    const idsExistentes = Array.from(
      new Set(Array.from(funcMap.values(), (funcionario) => funcionario.id)),
    );
    const primeiraData = dateColumns[0]?.date;
    if (idsExistentes.length > 0 && primeiraData) {
      const anteriores = await buscarTodasPaginas<AlocacaoAnterior>((from, to) =>
        supabase
          .from("alocacoes")
          .select("funcionario_id,obra_id,data,tipo_mao_obra")
          .in("funcionario_id", idsExistentes)
          .lt("data", primeiraData)
          .order("data", { ascending: false })
          .order("funcionario_id")
          .range(from, to),
      );
      for (const alocacao of anteriores) {
        if (
          !ultimaAlocacaoPorFuncionario.has(alocacao.funcionario_id) &&
          obraPorId.has(alocacao.obra_id)
        ) {
          ultimaAlocacaoPorFuncionario.set(alocacao.funcionario_id, alocacao);
        }
      }
    }
    for (const [funcKey, item] of funcionariosPorNome) {
      let desligadoDesde: string | null = null;
      const funcionarioExistente = funcMap.get(funcKey);
      const alocacaoAnterior = funcionarioExistente
        ? ultimaAlocacaoPorFuncionario.get(funcionarioExistente.id)
        : undefined;
      const obraAnterior = alocacaoAnterior ? obraPorId.get(alocacaoAnterior.obra_id) : undefined;
      let ultimoCentroResolvido: LegacyCell | null = obraAnterior
        ? {
            codigoBase:
              Array.from(centrosPorCodigo.entries()).find(
                ([, obra]) => obra.id === obraAnterior.id,
              )?.[0] ?? obraAnterior.nome,
            tipoMaoObra: alocacaoAnterior?.tipo_mao_obra ?? "indireta",
            raw: obraAnterior.nome,
          }
        : null;
      const alocacoesLinha: AlocacaoImportacao[] = [];
      for (const col of dateColumns) {
        totalCelulasPeriodo += 1;
        let parsed = parseCell(item.row[col.index]);
        if (parsed === "empty") {
          celulasVazias += 1;
          continue;
        }
        if (parsed === "desligado") {
          celulasDesligado += 1;
          if (!desligadoDesde) {
            desligadoDesde = col.date;
            desligamentos.set(
              funcKey,
              planejarDesligamento(
                funcKey,
                item.nome,
                col.date,
                funcionarioExistente && !funcionarioExistente.deleted_at
                  ? funcionarioExistente
                  : undefined,
                !funcionarioExistente,
              ),
            );
          }
          continue;
        }
        if (parsed === "sede") {
          sedesEncontradas += 1;
          if (!ultimoCentroResolvido) {
            const mensagem = `${item.nome} em ${formatDate(col.date)}: SEDE sem centro de custo anterior encontrado para o funcionário.`;
            sedesSemCentroAnterior.push(mensagem);
            erros.push(mensagem);
            rowHasError.add(funcKey);
            continue;
          }
          parsed = { ...ultimoCentroResolvido, raw: "SEDE" };
          sedesResolvidas.push(
            `${item.nome} em ${formatDate(col.date)}: SEDE resolvido pelo último centro de custo anterior: ${parsed.codigoBase}.`,
          );
        }
        if ("error" in parsed) {
          celulasInvalidas += 1;
          rowHasError.add(funcKey);
          erros.push(item.nome + " em " + formatDate(col.date) + ": " + parsed.error);
          continue;
        }
        if (desligadoDesde) {
          outrosBloqueios += 1;
          rowHasError.add(funcKey);
          inconsistencias.push(
            item.nome +
              ": centro de custo " +
              parsed.raw +
              " em " +
              formatDate(col.date) +
              " após D em " +
              formatDate(desligadoDesde) +
              ".",
          );
          continue;
        }
        const obra = conciliarCentroCusto(
          {
            codigoBase: parsed.codigoBase,
            tipoMaoObra: parsed.tipoMaoObra,
            valorOriginal: parsed.raw,
          },
          centrosPorCodigo,
        );
        if (!obra) {
          celulasCentroNaoEncontrado += 1;
          rowHasError.add(funcKey);
          const chave = parsed.raw + "|" + parsed.codigoBase;
          const mensagem = `Centro de custo não encontrado: ${parsed.raw}. Código-base procurado: ${parsed.codigoBase}.`;
          if (!obrasNaoEncontradas.has(chave)) {
            obrasNaoEncontradas.set(chave, mensagem);
            erros.push(mensagem);
          }
          continue;
        }
        obrasEncontradas.add(parsed.codigoBase);
        const keyData = funcKey + "|" + col.date;
        if (planilhaFuncionarioData.has(keyData)) {
          duplicidadesInternasPlanilha.push(
            `${criarSourceCellKey(item.rowNumber - 1, col.index, col.date)} duplica uma alocação anterior de ${item.nome} em ${formatDate(col.date)}.`,
          );
          rowHasError.add(funcKey);
          erros.push(
            item.nome +
              " possui mais de uma alocação na própria planilha em " +
              formatDate(col.date) +
              ".",
          );
          continue;
        }
        const aloc = {
          sourceCellKey: criarSourceCellKey(item.rowNumber - 1, col.index, col.date),
          funcionarioKey: funcKey,
          funcionarioNome: item.nome,
          funcionarioId: funcionarioExistente?.id,
          obraId: obra.id,
          centroCusto: parsed.codigoBase,
          codigoBase: parsed.codigoBase,
          valorOriginal: parsed.raw,
          data: col.date,
          tipoMaoObra: tipoMaoObraFinal(item.funcao, parsed.tipoMaoObra),
        };
        ultimoCentroResolvido = {
          codigoBase: parsed.codigoBase,
          tipoMaoObra: parsed.tipoMaoObra,
          raw: parsed.raw,
        };
        planilhaFuncionarioData.set(keyData, aloc);
        alocacoesLinha.push(aloc);
      }
      if (rowHasError.has(funcKey)) {
        outrosBloqueios += alocacoesLinha.length;
        ignorados.push(item.nome + ": linha ignorada por erro/inconsistência.");
      } else alocacoes.push(...alocacoesLinha);
    }
    const funcionariosCriar: FuncionarioNovo[] = [];
    for (const [key, item] of funcionariosPorNome)
      if (!funcMap.has(key) && !rowHasError.has(key))
        funcionariosCriar.push({
          key,
          nome: item.nome,
          funcao: item.funcao,
          categoria: findCategoriaConfig(item.funcao, categoriaMap)!.categoria,
          salario: Number(findCategoriaConfig(item.funcao, categoriaMap)!.salario),
          encargos: Number(findCategoriaConfig(item.funcao, categoriaMap)!.encargos),
          data_admissao: item.admissao,
          rowNumber: item.rowNumber,
        });
    if (modo === "admissoes" && !possuiAdmissaoValida && funcionariosCriar.length === 0) {
      erros.push(
        "Nenhuma coluna de data válida foi encontrada a partir da coluna E, nenhuma admissão válida e nenhum funcionário novo válido foi encontrado.",
      );
    }
    const datas = Array.from(new Set(alocacoes.map((a) => a.data))).sort();
    const competenciasFechadas = await buscarCompetenciasFechadasPorDatas(supabase, datas);
    for (const f of competenciasFechadas)
      erros.push(MENSAGEM_COMPETENCIA_FECHADA + " Competência " + f.competencia + ".");
    let registrosBanco: AlocacaoExistente[] = [];
    if (alocacoes.length > 0) {
      const datasAloc = Array.from(new Set(alocacoes.map((a) => a.data)));
      const existingIds = Array.from(
        new Set(
          alocacoes
            .map((a) => funcMap.get(a.funcionarioKey)?.id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      if (existingIds.length > 0) {
        registrosBanco = await buscarTodasPaginas<AlocacaoExistente>((from, to) =>
          supabase
            .from("alocacoes")
            .select("id,funcionario_id,obra_id,data,obras(nome)")
            .in("funcionario_id", existingIds)
            .in("data", datasAloc)
            .range(from, to),
        );
      }
    }
    const conciliacao = conciliarCelulasComAlocacoesExistentes(alocacoes, registrosBanco);
    const desligamentosIdentificados = Array.from(desligamentos.values());
    const idsComDesligamento = desligamentosIdentificados
      .map((item) => item.funcionarioId)
      .filter((id): id is string => Boolean(id));
    let alocacoesHistoricasAposD: AlocacaoExistente[] = [];
    if (idsComDesligamento.length > 0) {
      const primeiraDataD = desligamentosIdentificados
        .map((item) => item.primeiraCelulaD)
        .sort()[0];
      const candidatas = await buscarTodasPaginas<AlocacaoExistente>((from, to) =>
        supabase
          .from("alocacoes")
          .select("id,funcionario_id,obra_id,data,obras(nome)")
          .in("funcionario_id", idsComDesligamento)
          .gte("data", primeiraDataD)
          .range(from, to),
      );
      alocacoesHistoricasAposD = alocacoesAposDesligamento(desligamentosIdentificados, candidatas);
    }
    const desligamentoPorId = new Map(
      desligamentosIdentificados.map((item) => [item.funcionarioId, item]),
    );
    const alocacoesAposDesligamentoAvisos = alocacoesHistoricasAposD.map((item) => {
      const desligamento = desligamentoPorId.get(item.funcionario_id)!;
      return `${desligamento.funcionario}: alocação ${item.id} em ${formatDate(item.data)} será preservada; ocorre na data ou após o desligamento de ${formatDate(desligamento.primeiraCelulaD)}.`;
    });
    const nomesObras = new Map(obrasExistentes.map((obra) => [obra.id, obra.nome]));
    const alocacoesJaExistentes = conciliacao.existentes.map((item) => {
      const centrosExistentes = item.obraIdsExistentes
        .map((obraId) => nomesObras.get(obraId) ?? obraId)
        .join(", ");
      const mensagem =
        `${item.funcionarioNome} já possui alocação em ${formatDate(item.data)}` +
        ` — existente: ${centrosExistentes}; planilha: ${nomesObras.get(item.obraId) ?? item.codigoBase}; ` +
        `resultado: alocação existente mantida e célula ignorada` +
        `${item.centroDiferenteNaPlanilha ? ". A planilha indicava outro centro de custo" : ""}. ` +
        `IDs: ${item.idsExistentes.join(", ")} — célula: ${item.valorOriginal} — tipo: ${item.tipoMaoObra} — ` +
        `${item.quantidadeMatches} match${item.quantidadeMatches === 1 ? "" : "es"} no banco.`;
      return `${item.sourceCellKey} — ${mensagem}`;
    });
    const duplicidadesHistoricasBanco = conciliacao.duplicidadesHistoricas.map(
      (item) =>
        `${item.sourceCellKey} — ${item.funcionarioNome} — funcionario_id ${item.funcionarioId} — ` +
        `${item.data} — célula ${item.valorOriginal} — código-base ${item.codigoBase} — ` +
        `obra_id ${item.obraId} — tipo ${item.tipoMaoObra} — ${item.quantidadeMatches} matches — ` +
        `IDs: ${item.idsExistentes.join(", ")}. ${item.motivo}`,
    );
    const alocacoesNovas = conciliacao.novas;
    const celulasAlocacaoIdentificadas =
      alocacoes.length +
      celulasCentroNaoEncontrado +
      duplicidadesInternasPlanilha.length +
      outrosBloqueios;
    const totalCelulasConciliadas =
      celulasVazias +
      celulasDesligado +
      sedesSemCentroAnterior.length +
      celulasInvalidas +
      celulasCentroNaoEncontrado +
      alocacoesNovas.length +
      conciliacao.celulasUnicasExistentes +
      duplicidadesInternasPlanilha.length +
      outrosBloqueios;
    if (totalCelulasConciliadas !== totalCelulasPeriodo) {
      erros.push(
        `Conciliação das células não fecha: ${totalCelulasConciliadas} classificadas de ${totalCelulasPeriodo}.`,
      );
    }
    return {
      modo,
      totalFuncionariosEncontrados: funcionariosPorNome.size,
      funcionariosCriar,
      funcoesEncontradas,
      funcoesReconhecidas,
      funcoesSemSalario,
      funcionariosSemSalario,
      duplicadosIgnorados,
      obrasEncontradas: Array.from(obrasEncontradas).sort(),
      obrasNaoEncontradas: Array.from(obrasNaoEncontradas.values()),
      celulasAlocacaoIdentificadas,
      alocacoesJaExistentes,
      matchesAdicionaisBanco: conciliacao.matchesAdicionaisBanco,
      duplicidadesHistoricasBanco,
      duplicidadesInternasPlanilha,
      totalCelulasPeriodo,
      totalCelulasConciliadas,
      outrosBloqueios,
      alocacoesValidas: alocacoesNovas,
      celulasVazias,
      celulasDesligado,
      sedesEncontradas,
      sedesResolvidas,
      sedesSemCentroAnterior,
      desligamentos: desligamentosIdentificados,
      alocacoesAposDesligamento: alocacoesAposDesligamentoAvisos,
      funcionariosAtivosAusentes,
      erros,
      ignorados,
      inconsistencias,
      admissoesLidas,
      admissoesAlterar,
      admissoesIguais,
      admissoesIgnoradas,
      conflitosNomes,
      funcionariosNaoEncontrados,
      funcionariosEncontrados,
      funcionariosDesligados,
      funcionariosExcluidosConflitantes,
      funcoesNaoReconhecidas,
      datas,
      bloqueado: erros.length > 0 || inconsistencias.length > 0 || conflitosNomes.length > 0,
    };
  }
  async function confirmarImportacao() {
    if (!canImportar) {
      bloquearSemPermissao();
      return;
    }
    if (!preview || preview.bloqueado || !user?.id) return;
    setImporting(true);
    try {
      const { data: obrasAtuaisData, error: obrasAtuaisError } = await supabase
        .from("obras")
        .select("*");
      if (obrasAtuaisError) throw obrasAtuaisError;
      const centrosAtuaisPorCodigo = criarIndiceCentrosExistentes(
        (obrasAtuaisData ?? []) as ObraExistente[],
      );
      const centroDesconciliado = preview.alocacoesValidas.find((alocacao) => {
        const interpretado = interpretarCentroCusto(alocacao.centroCusto);
        const obra = interpretado
          ? conciliarCentroCusto(interpretado, centrosAtuaisPorCodigo)
          : null;
        return !obra || obra.id !== alocacao.obraId;
      });
      if (centroDesconciliado) {
        throw new Error(
          `Centro de custo não conciliado antes da confirmação: ${centroDesconciliado.centroCusto}. Gere uma nova prévia.`,
        );
      }
      const funcionariosExistentesIds = Array.from(
        new Set(
          preview.alocacoesValidas
            .map((alocacao) => alocacao.funcionarioId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      let alocacoesAtuais: AlocacaoExistente[] = [];
      if (funcionariosExistentesIds.length > 0) {
        const datas = Array.from(new Set(preview.alocacoesValidas.map((item) => item.data)));
        alocacoesAtuais = await buscarTodasPaginas<AlocacaoExistente>((from, to) =>
          supabase
            .from("alocacoes")
            .select("id,funcionario_id,obra_id,data,obras(nome)")
            .in("funcionario_id", funcionariosExistentesIds)
            .in("data", datas)
            .range(from, to),
        );
      }
      const revalidacao = conciliarCelulasComAlocacoesExistentes(
        preview.alocacoesValidas,
        alocacoesAtuais,
      );
      const alocacoesParaInserir = revalidacao.novas;
      const desligamentosAtualizar = desligamentosParaAtualizar(preview.desligamentos);
      const resultadosDesligamentos = await Promise.all(
        desligamentosAtualizar.map((desligamento) =>
          supabase
            .from("funcionarios")
            .update({
              ativo: false,
              data_desligamento: desligamento.primeiraCelulaD,
            })
            .eq("id", desligamento.funcionarioId),
        ),
      );
      const erroDesligamento = resultadosDesligamentos.find((resultado) => resultado.error)?.error;
      if (erroDesligamento) throw erroDesligamento;
      if (desligamentosAtualizar.length > 0) {
        const { data: funcionariosRevalidados, error: erroRevalidacao } = await supabase
          .from("funcionarios")
          .select("id,ativo,data_desligamento")
          .in(
            "id",
            desligamentosAtualizar.map((item) => item.funcionarioId),
          );
        if (erroRevalidacao) throw erroRevalidacao;
        const divergentes = validarDesligamentosAplicados(
          desligamentosAtualizar,
          funcionariosRevalidados ?? [],
        );
        if (divergentes.length > 0)
          throw new Error(
            `Desligamentos não confirmados após a gravação: ${divergentes
              .map((item) => item.funcionario)
              .join(", ")}. Alocações não foram gravadas.`,
          );
      }
      for (const admissao of preview.admissoesAlterar) {
        const { error } = await supabase
          .from("funcionarios")
          .update({ data_admissao: admissao.data })
          .eq("id", admissao.funcionarioId);
        if (error) throw error;
      }
      for (const f of preview.funcionariosCriar) {
        const { error } = await supabase.from("funcionarios").insert({
          nome: f.nome,
          categoria_mo: f.categoria,
          salario: f.salario,
          encargos: f.encargos,
          data_admissao: f.data_admissao,
          ativo: true,
          data_desligamento: null,
          deleted_at: null,
          deleted_by: null,
        });
        if (error) throw error;
      }
      const { data: funcsData, error: funcsError } = await supabase.rpc(
        "obras_control_funcionarios_safe",
      );
      if (funcsError) throw funcsError;
      const funcMap = new Map(
        ((funcsData ?? []) as unknown as FuncionarioExistente[]).map((f) => [
          normalizeName(f.nome),
          f,
        ]),
      );
      const alocRows = alocacoesParaInserir.map((a) => ({
        funcionario_id: funcMap.get(a.funcionarioKey)?.id,
        obra_id: a.obraId,
        data: a.data,
        tipo_mao_obra: a.tipoMaoObra,
        created_by: user.id,
      }));
      if (alocRows.find((r) => !r.funcionario_id || !r.obra_id))
        throw new Error(
          "Não foi possível resolver funcionário ou centro de custo para todas as alocações.",
        );
      if (alocRows.length > 0) {
        const { error: alocErr } = await table("alocacoes").insert(alocRows as never);
        if (alocErr) {
          const amigavel = detalhesErroBancoAlocacao(alocErr);
          throw new Error(amigavel?.description ?? alocErr.message);
        }
      }
      const regRows = alocacoesParaInserir.map((a) => ({
        funcionario_id: funcMap.get(a.funcionarioKey)?.id,
        obra_id: a.obraId,
        data: a.data,
        horas_normais: horasNormais(a.data),
        horas_extras: 0,
        ausencia: false,
        justificativa_extras: null,
        motivo_ausencia: null,
        observacoes: "Importado da planilha legado",
        created_by: user.id,
        updated_by: user.id,
      }));
      if (regRows.length > 0) {
        const { error: regErr } = await supabase.from("registros_horas").insert(regRows as never);
        if (regErr) throw regErr;
      }
      toast.success("Planilha legado importada com sucesso.");
      qc.invalidateQueries({ queryKey: ["alocacoes-mes"] });
      qc.invalidateQueries({ queryKey: ["registros-mes"] });
      qc.invalidateQueries({ queryKey: ["aloc-week"] });
      qc.invalidateQueries({ queryKey: ["funcionarios-cadastro"] });
      setOpen(false);
      setPreview(null);
      setFileName("");
    } catch (e) {
      toast.error((e as ErrorLike).message ?? "Erro ao importar planilha");
    } finally {
      setImporting(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Importar planilha legado
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar planilha legado</DialogTitle>
          <DialogDescription>
            Upload XLSX da aba Planilha1 no formato matriz. A importação só grava após a
            pré-validação e confirmação.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Arquivo XLSX</Label>
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void carregarArquivo(file);
              }}
            />
            {fileName && <div className="text-xs text-muted-foreground">Arquivo: {fileName}</div>}
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lendo planilha...
            </div>
          )}
          {preview && (
            <div className="space-y-4">
              {preview.modo === "admissoes" && (
                <Alert>
                  <AlertTitle>Modo detectado: atualização de admissões</AlertTitle>
                  <AlertDescription>
                    Nenhuma coluna de data de alocação foi encontrada, portanto somente as datas de
                    admissão e os funcionários novos válidos serão processados.
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                <Resumo label="Funcionários" value={preview.totalFuncionariosEncontrados} />
                <Resumo
                  label="Funcionários encontrados"
                  value={preview.funcionariosEncontrados.length}
                />
                <Resumo label="Funcionários a criar" value={preview.funcionariosCriar.length} />
                <Resumo
                  label="Desligados encontrados"
                  value={preview.funcionariosDesligados.length}
                />
                <Resumo
                  label="Excluídos conflitantes"
                  value={preview.funcionariosExcluidosConflitantes.length}
                  tone={preview.funcionariosExcluidosConflitantes.length ? "danger" : "default"}
                />
                <Resumo label="Admissões lidas" value={preview.admissoesLidas} />
                <Resumo
                  label="Admissões a preencher"
                  value={
                    preview.admissoesAlterar.filter((a) => a.tipo === "preencher").length +
                    preview.funcionariosCriar.filter((f) => Boolean(f.data_admissao)).length
                  }
                />
                <Resumo
                  label="Admissões a atualizar"
                  value={preview.admissoesAlterar.filter((a) => a.tipo === "atualizar").length}
                />
                <Resumo label="Admissões iguais" value={preview.admissoesIguais.length} />
                <Resumo label="Admissões ignoradas" value={preview.admissoesIgnoradas.length} />
                <Resumo label="Funções encontradas" value={preview.funcoesEncontradas.length} />
                <Resumo label="Funções reconhecidas" value={preview.funcoesReconhecidas.length} />
                <Resumo
                  label="Funções sem salário"
                  value={preview.funcoesSemSalario.length}
                  tone={preview.funcoesSemSalario.length > 0 ? "danger" : "default"}
                />
                <Resumo
                  label="Linhas duplicadas de funcionários"
                  value={preview.duplicadosIgnorados.length}
                />
                <Resumo label="Centros de custo" value={preview.obrasEncontradas.length} />
                <Resumo
                  label="Centros de custo não encontrados"
                  value={preview.obrasNaoEncontradas.length}
                  tone={preview.obrasNaoEncontradas.length > 0 ? "danger" : "default"}
                />
                <Resumo label="Alocações válidas" value={preview.alocacoesValidas.length} />
                <Resumo label="Células vazias" value={preview.celulasVazias} />
                <Resumo label="Células D/desligado" value={preview.celulasDesligado} />
                <Resumo label="Desligamentos identificados" value={preview.desligamentos.length} />
                <Resumo
                  label="Desligamentos novos"
                  value={preview.desligamentos.filter((d) => d.acao === "aplicar").length}
                />
                <Resumo
                  label="Desligamentos a corrigir"
                  value={preview.desligamentos.filter((d) => d.acao === "corrigir").length}
                />
                <Resumo
                  label="Desligamentos já iguais"
                  value={preview.desligamentos.filter((d) => d.acao === "manter").length}
                />
                <Resumo label="Sedes encontradas" value={preview.sedesEncontradas} />
                <Resumo label="Sedes resolvidas" value={preview.sedesResolvidas.length} />
                <Resumo
                  label="Sedes sem centro anterior"
                  value={preview.sedesSemCentroAnterior.length}
                  tone={preview.sedesSemCentroAnterior.length > 0 ? "danger" : "default"}
                />
                <Resumo
                  label="Erros"
                  value={preview.erros.length}
                  tone={preview.erros.length > 0 ? "danger" : "default"}
                />
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-semibold">Auditoria das células do período</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Resumo
                    label="Células de alocação identificadas"
                    value={preview.celulasAlocacaoIdentificadas}
                  />
                  <Resumo label="Alocações novas" value={preview.alocacoesValidas.length} />
                  <Resumo
                    label="Alocações já existentes — ignoradas"
                    value={preview.alocacoesJaExistentes.length}
                  />
                  <Resumo
                    label="Matches adicionais no banco"
                    value={preview.matchesAdicionaisBanco}
                    tone={preview.matchesAdicionaisBanco > 0 ? "danger" : "default"}
                  />
                  <Resumo
                    label="Duplicidades internas da planilha"
                    value={preview.duplicidadesInternasPlanilha.length}
                    tone={preview.duplicidadesInternasPlanilha.length > 0 ? "danger" : "default"}
                  />
                  <Resumo label="Outros bloqueios" value={preview.outrosBloqueios} />
                  <Resumo label="Total de células do período" value={preview.totalCelulasPeriodo} />
                  <Resumo label="Total conciliado" value={preview.totalCelulasConciliadas} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Quando o funcionário já possui alocação na data, o registro existente é preservado
                  e a célula da planilha não é importada, mesmo que indique outro centro de custo.{" "}
                  <br />
                  SEDE resolvida é uma origem de célula e permanece classificada operacionalmente
                  como alocação nova ou já existente, sem contagem dupla na equação.
                </div>
              </div>
              {preview.bloqueado && (
                <Alert variant="destructive">
                  <AlertTitle>Importação bloqueada</AlertTitle>
                  <AlertDescription>
                    Corrija os erros ou inconsistências antes de gravar.
                  </AlertDescription>
                </Alert>
              )}
              <PreviewList
                title="Desligamentos identificados"
                items={preview.desligamentos.map((d) => {
                  const atual = d.ativoAtual
                    ? `ativo, data ${d.dataAtual ? formatDate(d.dataAtual) : "não informada"}`
                    : d.ativoAtual === false
                      ? `inativo, data ${d.dataAtual ? formatDate(d.dataAtual) : "não informada"}`
                      : "sem cadastro existente";
                  const acao =
                    d.acao === "manter"
                      ? "manter desligamento já igual"
                      : d.acao === "corrigir"
                        ? `corrigir desligamento para ${formatDate(d.primeiraCelulaD)}`
                        : d.acao === "aplicar"
                          ? `aplicar desligamento em ${formatDate(d.primeiraCelulaD)}`
                          : "não atualizar automaticamente";
                  return `${d.funcionario} — Atual: ${atual}. Planilha: D em ${formatDate(d.primeiraCelulaD)}. Ação: ${acao}.`;
                })}
              />
              <PreviewList
                title="Alocações existentes na data ou após o desligamento — preservadas"
                items={preview.alocacoesAposDesligamento}
              />
              <PreviewList
                title="Funcionários ativos no banco não localizados na planilha"
                items={preview.funcionariosAtivosAusentes}
              />
              <PreviewList title="Sedes resolvidas" items={preview.sedesResolvidas} />
              <PreviewList
                title="Sedes sem centro de custo anterior"
                items={preview.sedesSemCentroAnterior}
                danger
              />
              <div className="rounded-md border p-3">
                <div className="mb-2 text-sm font-semibold">Conferência de funcionários</div>
                <PreviewList
                  title="Funcionários encontrados"
                  items={preview.funcionariosEncontrados}
                />
                <PreviewList
                  title="Funcionários novos que serão criados"
                  items={preview.funcionariosCriar.map(
                    (f) =>
                      `${f.nome} — ${f.funcao} — admissão: ${f.data_admissao ? formatDate(f.data_admissao) : "não informada"} — linha ${f.rowNumber}.`,
                  )}
                />
                <PreviewList
                  title="Funcionários desligados encontrados"
                  items={preview.funcionariosDesligados}
                />
                <PreviewList
                  title="Funcionários excluídos conflitantes"
                  items={preview.funcionariosExcluidosConflitantes}
                  danger
                />
                <PreviewList title="Funcionários ambíguos" items={preview.conflitosNomes} danger />
                <PreviewList
                  title="Funções não reconhecidas"
                  items={preview.funcoesNaoReconhecidas}
                  danger
                />
              </div>
              <PreviewList title="Funções encontradas" items={preview.funcoesEncontradas} />
              <PreviewList
                title="Funções reconhecidas no sistema"
                items={preview.funcoesReconhecidas}
              />
              <PreviewList
                title="Funções sem salário configurado"
                items={preview.funcoesSemSalario}
                danger
              />
              <PreviewList
                title="Funcionários não criados por falta de salário"
                items={preview.funcionariosSemSalario}
                danger
              />
              <PreviewList
                title="Linhas duplicadas de funcionários na planilha"
                items={preview.duplicadosIgnorados}
              />
              <PreviewList
                title="Alocações já existentes — ignoradas"
                items={preview.alocacoesJaExistentes}
              />
              <PreviewList
                title="Duplicidades históricas encontradas no banco"
                items={preview.duplicidadesHistoricasBanco}
                danger
              />
              <PreviewList
                title="Duplicidades internas da planilha"
                items={preview.duplicidadesInternasPlanilha}
                danger
              />
              <PreviewList
                title="Centros de custo não encontrados"
                items={preview.obrasNaoEncontradas}
                danger
              />
              <PreviewList
                title="Admissões que serão preenchidas/atualizadas"
                items={preview.admissoesAlterar.map(
                  (a) =>
                    `${a.nome}: ${formatDate(a.data)} (${a.tipo === "preencher" ? "preencher" : "atualizar"}).`,
                )}
              />
              <PreviewList title="Admissões já iguais" items={preview.admissoesIguais} />
              <PreviewList title="Admissões ignoradas" items={preview.admissoesIgnoradas} />
              <PreviewList title="Conflitos de nomes" items={preview.conflitosNomes} danger />
              <PreviewList
                title="Funcionários não encontrados"
                items={preview.funcionariosNaoEncontrados}
              />
              <PreviewList title="Outros registros ignorados" items={preview.ignorados} />
              <PreviewList title="Inconsistências" items={preview.inconsistencias} danger />
              <PreviewList title="Erros" items={preview.erros} danger />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={confirmarImportacao} disabled={!podeImportar || importing}>
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Confirmar importação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function Resumo({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === "danger" ? "text-xl font-semibold text-destructive" : "text-xl font-semibold"
        }
      >
        {value}
      </div>
    </div>
  );
}
function PreviewList({
  title,
  items,
  danger = false,
}: {
  title: string;
  items: string[];
  danger?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        {title}
        <Badge variant={danger ? "destructive" : "outline"}>{items.length}</Badge>
      </div>
      <ScrollArea className="max-h-32 rounded-md border p-2 text-xs">
        <ul className="space-y-1">
          {items.map((item, idx) => (
            <li key={title + idx}>{item}</li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
