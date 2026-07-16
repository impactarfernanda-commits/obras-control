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

type TipoMaoObra = "montagem" | "civil" | "indireta";
type LegacyCell = { centroCusto: string; tipoMaoObra: TipoMaoObra; raw: string };
type DateColumn = { index: number; date: string; label: string };
type FuncionarioExistente = {
  id: string;
  nome: string;
  categoria_mo: string | null;
  ativo: boolean;
  deleted_at: string | null;
  data_admissao: string | null;
};
type AdmissaoAlterar = {
  funcionarioId: string;
  nome: string;
  data: string;
  tipo: "preencher" | "atualizar";
};
type ObraExistente = { id: string; nome: string };
type CategoriaSalarioConfig = {
  categoria: string;
  salario: number;
  encargos: number;
  seguro_vida: number | null;
};
type AlocacaoExistente = {
  funcionario_id: string;
  obra_id: string;
  data: string;
  obras?: { nome: string } | null;
};
type FuncionarioNovo = {
  key: string;
  nome: string;
  funcao: string;
  categoria: string;
  salario: number;
  encargos: number;
  data_admissao: string | null;
};
type ObraNova = { centroCusto: string; nome: string };
type AlocacaoImportacao = {
  funcionarioKey: string;
  funcionarioNome: string;
  obraKey: string;
  centroCusto: string;
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
  obrasCriar: ObraNova[];
  alocacoesValidas: AlocacaoImportacao[];
  celulasVazias: number;
  celulasDesligado: number;
  desligamentos: Array<{ funcionario: string; data: string }>;
  erros: string[];
  ignorados: string[];
  inconsistencias: string[];
  admissoesLidas: number;
  admissoesAlterar: AdmissaoAlterar[];
  admissoesIguais: string[];
  admissoesIgnoradas: string[];
  conflitosNomes: string[];
  funcionariosNaoEncontrados: string[];
  datas: string[];
  bloqueado: boolean;
};
type ErrorLike = { message?: string };
const MENSAGEM_SEM_PERMISSAO_IMPORTAR =
  "Você não tem permissão para importar planilhas. Esta ação é restrita a gerentes e diretores.";
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
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
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
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
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
function parseCell(value: unknown): "empty" | "desligado" | LegacyCell | { error: string } {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!raw) return "empty";
  if (raw === "D") return "desligado";
  const m = raw.match(/^(\d+)(?:-([MC]))?$/);
  if (!m) return { error: "Formato desconhecido: " + raw };
  const suffix = m[2];
  return {
    centroCusto: m[1],
    tipoMaoObra: suffix === "M" ? "montagem" : suffix === "C" ? "civil" : "indireta",
    raw,
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
    obrasCriar: [],
    alocacoesValidas: [],
    celulasVazias: 0,
    celulasDesligado: 0,
    desligamentos: [],
    erros: [error],
    ignorados: [],
    inconsistencias: [],
    admissoesLidas: 0,
    admissoesAlterar: [],
    admissoesIguais: [],
    admissoesIgnoradas: [],
    conflitosNomes: [],
    funcionariosNaoEncontrados: [],
    datas: [],
    bloqueado: true,
  };
}

export function ImportarPlanilhaLegadoDialog() {
  const { user, isManagerOrAbove } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const podeImportar = useMemo(
    () =>
      isManagerOrAbove &&
      preview &&
      !preview.bloqueado &&
      (preview.alocacoesValidas.length > 0 ||
        preview.admissoesAlterar.length > 0 ||
        preview.funcionariosCriar.length > 0 ||
        (preview.modo === "admissoes" && preview.admissoesIguais.length > 0)),
    [isManagerOrAbove, preview],
  );
  function bloquearSemPermissao() {
    setPreview(emptyPreview(MENSAGEM_SEM_PERMISSAO_IMPORTAR));
    toast.error(MENSAGEM_SEM_PERMISSAO_IMPORTAR);
  }
  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !isManagerOrAbove) {
      bloquearSemPermissao();
      return;
    }
    setOpen(nextOpen);
  }
  async function carregarArquivo(file: File) {
    if (!isManagerOrAbove) {
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
    const desligamentos = new Map<string, { funcionario: string; data: string }>();
    let celulasVazias = 0;
    let celulasDesligado = 0;
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
    if (modo === "admissoes" && !possuiAdmissaoValida) {
      erros.push(
        "Nenhuma coluna de data válida foi encontrada a partir da coluna E e nenhuma data de admissão válida foi encontrada.",
      );
    }
    const { data: funcsData, error: funcsError } = await supabase
      .from("funcionarios_safe" as unknown as "funcionarios")
      .select("id,nome,categoria_mo,ativo,deleted_at,data_admissao");
    if (funcsError) throw funcsError;
    const funcionariosExistentes = (funcsData ?? []) as unknown as FuncionarioExistente[];
    const funcionariosPorNomeExistentes = new Map<string, FuncionarioExistente[]>();
    for (const f of funcionariosExistentes) {
      const key = normalizeName(f.nome);
      const grupo = funcionariosPorNomeExistentes.get(key) ?? [];
      grupo.push(f);
      funcionariosPorNomeExistentes.set(key, grupo);
    }
    const conflitosNomes: string[] = [];
    const funcMap = new Map<string, FuncionarioExistente>();
    for (const [key, grupo] of funcionariosPorNomeExistentes) {
      const naoExcluidos = grupo.filter((f) => !f.deleted_at);
      if (naoExcluidos.length > 1) {
        conflitosNomes.push(
          `${naoExcluidos[0].nome}: mais de um cadastro não excluído com o mesmo nome normalizado.`,
        );
      } else if (naoExcluidos.length === 1) funcMap.set(key, naoExcluidos[0]);
      else if (grupo.length === 1) funcMap.set(key, grupo[0]);
    }
    const admissoesAlterar: AdmissaoAlterar[] = [];
    const admissoesIguais: string[] = [];
    const funcionariosNaoEncontrados: string[] = [];
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
      if (conflitosNomes.some((c) => normalizeName(c.split(":")[0]) === key)) continue;
      const existente = funcMap.get(key);
      if (modo === "admissoes" && !existente) {
        funcionariosNaoEncontrados.push(`${item.nome}: funcionário não encontrado.`);
      }
      if (existente?.deleted_at) {
        if (modo === "admissoes") {
          funcionariosNaoEncontrados.push(
            `${item.nome}: cadastro excluído não foi considerado como correspondência.`,
          );
        } else {
          erros.push(
            "Existe um funcionário excluído com este nome: " +
              item.nome +
              ". Verifique se o cadastro anterior foi excluído por erro antes de importar.",
          );
        }
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
    const { data: obrasData, error: obrasError } = await supabase.from("obras").select("id,nome");
    if (obrasError) throw obrasError;
    const obrasExistentes = (obrasData ?? []) as ObraExistente[];
    const obraMap = new Map<string, ObraExistente>();
    for (const obra of obrasExistentes) obraMap.set(normalizeName(obra.nome), obra);
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
    const funcionariosSemSalario: string[] = [];
    const rowHasError = new Set<string>();
    for (const [funcKey, item] of funcionariosPorNome) {
      if (
        modo === "completo" &&
        !funcMap.has(funcKey) &&
        !findCategoriaConfig(item.funcao, categoriaMap)
      ) {
        rowHasError.add(funcKey);
        funcionariosSemSalario.push(item.nome + " - " + item.funcao);
        erros.push(
          "Cargo/função sem salário configurado: " +
            item.funcao +
            ". Cadastre o salário desse cargo em Configurações antes de importar.",
        );
      }
    }
    const alocacoes: AlocacaoImportacao[] = [];
    const obrasEncontradas = new Set<string>();
    const planilhaFuncionarioData = new Map<string, AlocacaoImportacao>();
    for (const [funcKey, item] of funcionariosPorNome) {
      let desligadoDesde: string | null = null;
      const alocacoesLinha: AlocacaoImportacao[] = [];
      for (const col of dateColumns) {
        const parsed = parseCell(item.row[col.index]);
        if (parsed === "empty") {
          celulasVazias += 1;
          continue;
        }
        if (parsed === "desligado") {
          celulasDesligado += 1;
          if (!desligadoDesde) {
            desligadoDesde = col.date;
            desligamentos.set(funcKey, { funcionario: item.nome, data: col.date });
          }
          continue;
        }
        if ("error" in parsed) {
          rowHasError.add(funcKey);
          erros.push(item.nome + " em " + formatDate(col.date) + ": " + parsed.error);
          continue;
        }
        if (desligadoDesde) {
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
        obrasEncontradas.add(parsed.centroCusto);
        const keyData = funcKey + "|" + col.date;
        if (planilhaFuncionarioData.has(keyData)) {
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
          funcionarioKey: funcKey,
          funcionarioNome: item.nome,
          obraKey: normalizeName(parsed.centroCusto),
          centroCusto: parsed.centroCusto,
          data: col.date,
          tipoMaoObra: tipoMaoObraFinal(item.funcao, parsed.tipoMaoObra),
        };
        planilhaFuncionarioData.set(keyData, aloc);
        alocacoesLinha.push(aloc);
      }
      if (rowHasError.has(funcKey))
        ignorados.push(item.nome + ": linha ignorada por erro/inconsistência.");
      else alocacoes.push(...alocacoesLinha);
    }
    const funcionariosCriar: FuncionarioNovo[] = [];
    for (const [key, item] of funcionariosPorNome)
      if (modo === "completo" && !funcMap.has(key) && !rowHasError.has(key))
        funcionariosCriar.push({
          key,
          nome: item.nome,
          funcao: item.funcao,
          categoria: findCategoriaConfig(item.funcao, categoriaMap)!.categoria,
          salario: Number(findCategoriaConfig(item.funcao, categoriaMap)!.salario),
          encargos: Number(findCategoriaConfig(item.funcao, categoriaMap)!.encargos),
          data_admissao: item.admissao,
        });
    const obrasCriar = Array.from(obrasEncontradas)
      .filter((cc) => !obraMap.has(normalizeName(cc)))
      .map((centroCusto) => ({ centroCusto, nome: centroCusto }));
    const datas = Array.from(new Set(alocacoes.map((a) => a.data))).sort();
    const competenciasFechadas = await buscarCompetenciasFechadasPorDatas(supabase, datas);
    for (const f of competenciasFechadas)
      erros.push(MENSAGEM_COMPETENCIA_FECHADA + " Competência " + f.competencia + ".");
    const alocacoesJaExistentes = new Set<string>();
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
        const { data: alocExistentes, error } = await supabase
          .from("alocacoes")
          .select("funcionario_id,obra_id,data,obras(nome)")
          .in("funcionario_id", existingIds)
          .in("data", datasAloc);
        if (error) throw error;
        const byId = new Map(funcionariosExistentes.map((f) => [f.id, f.nome]));
        for (const a of (alocExistentes ?? []) as unknown as AlocacaoExistente[]) {
          alocacoesJaExistentes.add(`${a.funcionario_id}|${a.obra_id}|${a.data}`);
          ignorados.push(
            (byId.get(a.funcionario_id) ?? "Funcionário") +
              " já possui alocação em " +
              formatDate(a.data) +
              (a.obras?.nome ? " na obra " + a.obras.nome : "") +
              "; alocação mantida sem alteração.",
          );
        }
      }
    }
    const alocacoesNovas = alocacoes.filter((a) => {
      const existente = funcMap.get(a.funcionarioKey);
      const obra = obraMap.get(a.obraKey);
      return (
        !existente || !obra || !alocacoesJaExistentes.has(`${existente.id}|${obra.id}|${a.data}`)
      );
    });
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
      obrasCriar,
      alocacoesValidas: alocacoesNovas,
      celulasVazias,
      celulasDesligado,
      desligamentos: Array.from(desligamentos.values()),
      erros,
      ignorados,
      inconsistencias,
      admissoesLidas,
      admissoesAlterar,
      admissoesIguais,
      admissoesIgnoradas,
      conflitosNomes,
      funcionariosNaoEncontrados,
      datas,
      bloqueado: erros.length > 0 || inconsistencias.length > 0 || conflitosNomes.length > 0,
    };
  }
  async function confirmarImportacao() {
    if (!isManagerOrAbove) {
      bloquearSemPermissao();
      return;
    }
    if (!preview || preview.bloqueado || !user?.id) return;
    setImporting(true);
    try {
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
        });
        if (error) throw error;
      }
      for (const o of preview.obrasCriar) {
        const { error } = await supabase.from("obras").insert({ nome: o.nome, status: "ativa" });
        if (error) throw error;
      }
      const [{ data: funcsData, error: funcsError }, { data: obrasData, error: obrasError }] =
        await Promise.all([
          supabase
            .from("funcionarios_safe" as unknown as "funcionarios")
            .select("id,nome,categoria_mo,ativo,deleted_at"),
          supabase.from("obras").select("id,nome"),
        ]);
      if (funcsError) throw funcsError;
      if (obrasError) throw obrasError;
      const funcMap = new Map(
        ((funcsData ?? []) as unknown as FuncionarioExistente[]).map((f) => [
          normalizeName(f.nome),
          f,
        ]),
      );
      const obraMap = new Map(
        ((obrasData ?? []) as ObraExistente[]).map((o) => [normalizeName(o.nome), o]),
      );
      const alocRows = preview.alocacoesValidas.map((a) => ({
        funcionario_id: funcMap.get(a.funcionarioKey)?.id,
        obra_id: obraMap.get(a.obraKey)?.id,
        data: a.data,
        tipo_mao_obra: a.tipoMaoObra,
        created_by: user.id,
      }));
      if (alocRows.find((r) => !r.funcionario_id || !r.obra_id))
        throw new Error("Não foi possível resolver funcionário ou obra para todas as alocações.");
      if (alocRows.length > 0) {
        const { error: alocErr } = await table("alocacoes").insert(alocRows as never);
        if (alocErr) {
          const amigavel = detalhesErroBancoAlocacao(alocErr);
          throw new Error(amigavel?.description ?? alocErr.message);
        }
      }
      const regRows = preview.alocacoesValidas.map((a) => ({
        funcionario_id: funcMap.get(a.funcionarioKey)?.id,
        obra_id: obraMap.get(a.obraKey)?.id,
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
                    admissão serão atualizadas.
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                <Resumo label="Funcionários" value={preview.totalFuncionariosEncontrados} />
                <Resumo label="Funcionários a criar" value={preview.funcionariosCriar.length} />
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
                <Resumo label="Duplicados ignorados" value={preview.duplicadosIgnorados.length} />
                <Resumo label="Centros de custo" value={preview.obrasEncontradas.length} />
                <Resumo label="Obras a criar" value={preview.obrasCriar.length} />
                <Resumo label="Alocações válidas" value={preview.alocacoesValidas.length} />
                <Resumo label="Células vazias" value={preview.celulasVazias} />
                <Resumo label="Células D/desligado" value={preview.celulasDesligado} />
                <Resumo
                  label="Erros"
                  value={preview.erros.length}
                  tone={preview.erros.length > 0 ? "danger" : "default"}
                />
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
                title="Desligamentos"
                items={preview.desligamentos.map(
                  (d) => d.funcionario + ": desligado a partir de " + formatDate(d.data),
                )}
              />
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
              <PreviewList title="Duplicados ignorados" items={preview.duplicadosIgnorados} />
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
              <PreviewList title="Registros ignorados" items={preview.ignorados} />
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
