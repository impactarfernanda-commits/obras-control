import * as XLSX from "xlsx";
import { normalizarFuncaoOrcamento, type TipoMO } from "./planejamento-hh-core.ts";

export type ItemImportado = {
  funcaoOrcamento: string;
  tipoMo: TipoMO;
  hhPrevisto: number;
  custoPrevisto: number;
  origem: "MO" | "EAP/CPUs";
  metadataCalculo: Record<string, string | number | boolean | null>;
};
export type PreviaImportacao = {
  abas: string[];
  itens: ItemImportado[];
  avisos: string[];
  erros: string[];
};

const norm = (v: unknown) => normalizarFuncaoOrcamento(String(v ?? ""));
const numero = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const limpo = v
    .replace(/R\$|\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
};
const aliases = {
  funcao: ["funcao", "função", "cargo", "recurso", "descricao", "descrição"],
  hh: ["hh", "hh previsto", "horas", "total horas"],
  custo: ["custo", "custo previsto", "valor total", "total"],
  quantidade: ["quantidade", "qtd", "permanencia", "permanência"],
  base: ["base horas", "base de horas", "horas mes", "horas mês"],
  cpu: ["cpu", "codigo cpu", "código cpu", "composicao", "composição"],
  coeficiente: ["coeficiente", "indice", "índice", "consumo"],
  produtividade: ["produtividade", "producao", "produção"],
  custoHora: ["custo hora", "custo unitario", "custo unitário", "preco unitario", "preço unitário"],
};
function coluna(cabecalho: unknown[], nomes: string[]) {
  const buscados = nomes.map(norm);
  return cabecalho.findIndex((v) => buscados.includes(norm(v)));
}
function linhasDaAba(workbook: XLSX.WorkBook, nome: string) {
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[nome]!, {
    header: 1,
    defval: null,
    raw: true,
  });
}
function localizarCabecalho(linhas: unknown[][]) {
  for (let i = 0; i < Math.min(linhas.length, 80); i++) {
    const row = linhas[i] ?? [];
    if (
      coluna(row, aliases.funcao) >= 0 &&
      (coluna(row, aliases.hh) >= 0 || coluna(row, aliases.custo) >= 0)
    )
      return i;
  }
  return -1;
}
function localizarCabecalhoCom(linhas: unknown[][], campos: string[][]) {
  for (let i = 0; i < Math.min(linhas.length, 80); i++) {
    const row = linhas[i] ?? [];
    if (campos.every((nomes) => coluna(row, nomes) >= 0)) return i;
  }
  return -1;
}
function parseTabela(
  linhas: unknown[][],
  tipoMo: TipoMO,
  origem: ItemImportado["origem"],
  avisos: string[],
) {
  const headerIndex = localizarCabecalho(linhas);
  if (headerIndex < 0) return [];
  const h = linhas[headerIndex] ?? [];
  const fCol = coluna(h, aliases.funcao),
    hhCol = coluna(h, aliases.hh),
    custoCol = coluna(h, aliases.custo);
  const qtdCol = coluna(h, aliases.quantidade),
    baseCol = coluna(h, aliases.base);
  const itens: ItemImportado[] = [];
  for (let i = headerIndex + 1; i < linhas.length; i++) {
    const row = linhas[i] ?? [];
    const funcao = String(row[fCol] ?? "").trim();
    if (!funcao) continue;
    const quantidade = qtdCol >= 0 ? numero(row[qtdCol]) : null;
    const base = baseCol >= 0 ? numero(row[baseCol]) : null;
    const hhInformado = hhCol >= 0 ? numero(row[hhCol]) : null;
    const hh = hhInformado ?? (quantidade != null && base != null ? quantidade * base : null);
    const custo = custoCol >= 0 ? numero(row[custoCol]) : null;
    if (hh == null || custo == null) {
      avisos.push(`${origem}: linha ${i + 1} de ${funcao} sem HH ou custo calculado/cacheado.`);
      continue;
    }
    itens.push({
      funcaoOrcamento: funcao,
      tipoMo,
      hhPrevisto: hh,
      custoPrevisto: custo,
      origem,
      metadataCalculo: {
        linha: i + 1,
        hhInformado: hhInformado != null,
        quantidade,
        baseHoras: base,
      },
    });
  }
  return itens;
}

function parseModComposto(eap: unknown[][], cpus: unknown[][], avisos: string[]) {
  const eh = localizarCabecalhoCom(eap, [aliases.cpu, aliases.quantidade]);
  const ch = localizarCabecalhoCom(cpus, [
    aliases.cpu,
    aliases.funcao,
    aliases.coeficiente,
    aliases.custoHora,
  ]);
  if (eh < 0 || ch < 0) return [];
  const eHead = eap[eh]!,
    cHead = cpus[ch]!;
  const eCpu = coluna(eHead, aliases.cpu),
    eQtd = coluna(eHead, aliases.quantidade);
  const cCpu = coluna(cHead, aliases.cpu),
    cFunc = coluna(cHead, aliases.funcao),
    cCoef = coluna(cHead, aliases.coeficiente),
    cProd = coluna(cHead, aliases.produtividade),
    cCusto = coluna(cHead, aliases.custoHora);
  const usos = new Map<string, number>();
  for (let i = eh + 1; i < eap.length; i++) {
    const codigo = norm(eap[i]?.[eCpu]),
      qtd = numero(eap[i]?.[eQtd]);
    if (codigo && qtd != null) usos.set(codigo, (usos.get(codigo) ?? 0) + qtd);
  }
  const itens: ItemImportado[] = [];
  for (let i = ch + 1; i < cpus.length; i++) {
    const codigo = norm(cpus[i]?.[cCpu]),
      quantidadeServico = usos.get(codigo);
    if (!codigo || quantidadeServico == null) continue; // CPU nao usada nunca entra.
    const funcao = String(cpus[i]?.[cFunc] ?? "").trim(),
      coeficiente = numero(cpus[i]?.[cCoef]);
    const produtividade = cProd >= 0 ? numero(cpus[i]?.[cProd]) : null,
      custoHora = numero(cpus[i]?.[cCusto]);
    if (!funcao || coeficiente == null || custoHora == null || produtividade === 0) {
      avisos.push(`EAP/CPUs: composicao ${codigo} linha ${i + 1} incompleta.`);
      continue;
    }
    const hh = (quantidadeServico * coeficiente) / (produtividade ?? 1);
    itens.push({
      funcaoOrcamento: funcao,
      tipoMo: "MOD",
      hhPrevisto: hh,
      custoPrevisto: hh * custoHora,
      origem: "EAP/CPUs",
      metadataCalculo: {
        linhaCPU: i + 1,
        cpu: codigo,
        quantidadeServico,
        coeficiente,
        produtividade,
        custoHora,
      },
    });
  }
  return itens;
}

function parsePlanilhaSanepar(
  calcula: unknown[][],
  cpus: unknown[][],
  mo: unknown[][],
  avisos: string[],
  erros: string[],
) {
  const cabCalcula = calcula.findIndex(
    (row) =>
      norm(row?.[0]) === "codigo" &&
      norm(row?.[1]) === "referencia" &&
      norm(row?.[4]) === "quantidade",
  );
  const cabCpus = cpus.findIndex(
    (row) =>
      ["codigo", "cod. composicao"].includes(norm(row?.[0])) &&
      ["descricao da composicao", "descricao completa"].includes(norm(row?.[1])) &&
      ["codigo insumo", "cod. insumo"].includes(norm(row?.[5])),
  );
  const cabMo = mo.findIndex(
    (row) =>
      ["descricao", "cargo"].includes(norm(row?.[0])) &&
      ["permanencia", "tempo"].includes(norm(row?.[1])),
  );
  if (cabCalcula < 0 || cabCpus < 0 || cabMo < 0) return [];

  const recursosPorCpu = new Map<string, unknown[][]>();
  for (let i = cabCpus + 1; i < cpus.length; i++) {
    const codigo = norm(cpus[i]?.[0]);
    if (!codigo) continue;
    const recursos = recursosPorCpu.get(codigo) ?? [];
    recursos.push(cpus[i]!);
    recursosPorCpu.set(codigo, recursos);
  }

  const itens: ItemImportado[] = [];
  const avisados = new Set<string>();
  for (let i = cabCalcula + 1; i < calcula.length; i++) {
    if (norm(calcula[i]?.[1]) !== "cpu") continue;
    const codigo = norm(calcula[i]?.[0]);
    if (!codigo || codigo === "adlc01") continue;
    const quantidade = numero(calcula[i]?.[4]);
    const sequencia = numero(calcula[i]?.[8]);
    if (quantidade == null || sequencia == null || sequencia < 1) continue;
    const recurso = recursosPorCpu.get(codigo)?.[sequencia - 1];
    if (!recurso) {
      if (!avisados.has(codigo)) {
        erros.push(
          `Existem composicoes utilizadas no orcamento que nao puderam ser reconciliadas: ${String(calcula[i]?.[0] ?? codigo)}.`,
        );
        avisados.add(codigo);
      }
      continue;
    }
    if (norm(recurso[8]) !== "h") continue;
    const funcao = String(recurso[6] ?? "").trim();
    const produtividade = numero(recurso[3]);
    const indice = numero(recurso[11]);
    const custoComposicao = numero(recurso[15]);
    if (quantidade <= 0 || indice == null || indice <= 0) continue;
    if (!funcao || produtividade == null || produtividade <= 0 || custoComposicao == null) {
      avisos.push(`EAP/CPUs: composicao ${codigo} linha ${i + 1} sem dados cacheados suficientes.`);
      continue;
    }
    itens.push({
      funcaoOrcamento: funcao,
      tipoMo: "MOD",
      hhPrevisto: (quantidade * indice) / produtividade,
      custoPrevisto: quantidade * custoComposicao,
      origem: "EAP/CPUs",
      metadataCalculo: {
        segmento: "civil",
        linhaCalculaCPUs: i + 1,
        cpu: codigo,
        quantidadeServico: quantidade,
        indice,
        produtividade,
        custoComposicao,
      },
    });
  }

  const baseHoras = recursosPorCpu
    .get("adlc01")
    ?.filter((row) => norm(row[8]) === "h")
    .map((row) => numero(row[11]))
    .find((valor) => valor != null && valor > 0);
  if (baseHoras == null) {
    avisos.push("MO: base mensal de horas da composicao ADLC01 nao foi encontrada.");
    return itens;
  }

  let bloco = 0;
  let emBloco = false;
  for (let i = cabMo + 1; i < mo.length; i++) {
    const funcao = String(mo[i]?.[0] ?? "").trim();
    if (!funcao) {
      emBloco = false;
      continue;
    }
    if (!emBloco) {
      bloco++;
      emBloco = true;
    }
    const permanencia = numero(mo[i]?.[1]);
    const componentes = [9, 10, 11, 12].map((col) => numero(mo[i]?.[col]) ?? 0);
    if (permanencia == null) {
      avisos.push(`MO: linha ${i + 1} de ${funcao} sem permanencia.`);
      continue;
    }
    itens.push({
      funcaoOrcamento: funcao,
      tipoMo: bloco === 1 ? "MOI" : "MOD",
      hhPrevisto: permanencia * baseHoras,
      custoPrevisto: componentes.reduce((total, valor) => total + valor, 0),
      origem: "MO",
      metadataCalculo: {
        segmento: bloco === 1 ? "indireta" : "montagem",
        linha: i + 1,
        permanencia,
        baseHoras,
      },
    });
  }
  return itens;
}

export function parseOrcamentoBuffer(buffer: Buffer | Uint8Array): PreviaImportacao {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: true,
    cellNF: true,
    cellDates: true,
  });
  const abas = workbook.SheetNames.slice();
  const avisos: string[] = [],
    erros: string[] = [];
  const porNome = new Map(abas.map((nome) => [norm(nome), nome]));
  for (const obrigatoria of ["eap", "cpus", "mo"])
    if (!porNome.has(obrigatoria))
      erros.push(`Aba obrigatoria ausente: ${obrigatoria.toUpperCase()}.`);
  const itens: ItemImportado[] = [];
  const mo = porNome.get("mo");
  const cpus = porNome.get("cpus"),
    calcula = porNome.get("calculacpus");
  const itensSanepar =
    mo && cpus && calcula
      ? parsePlanilhaSanepar(
          linhasDaAba(workbook, calcula),
          linhasDaAba(workbook, cpus),
          linhasDaAba(workbook, mo),
          avisos,
          erros,
        )
      : [];
  itens.push(...itensSanepar);
  if (!itensSanepar.length && mo)
    itens.push(...parseTabela(linhasDaAba(workbook, mo), "MOI", "MO", avisos));
  // O padrao aceito exige que a aba EAP/CPUs exponha uma tabela consolidada de recursos usados.
  // Bibliotecas inteiras de CPUs nunca sao somadas sem referencia explicita da EAP.
  const eap = porNome.get("eap");
  if (!itensSanepar.length && eap) {
    const eapLinhas = linhasDaAba(workbook, eap);
    const direto = parseTabela(eapLinhas, "MOD", "EAP/CPUs", avisos);
    itens.push(
      ...(direto.length
        ? direto
        : cpus
          ? parseModComposto(eapLinhas, linhasDaAba(workbook, cpus), avisos)
          : []),
    );
  }
  const consolidados = new Map<string, ItemImportado>();
  for (const item of itens) {
    const key = `${normalizarFuncaoOrcamento(item.funcaoOrcamento)}|${item.tipoMo}`;
    const atual = consolidados.get(key);
    if (atual) {
      atual.hhPrevisto += item.hhPrevisto;
      atual.custoPrevisto += item.custoPrevisto;
    } else consolidados.set(key, { ...item });
  }
  if (!itens.length && !erros.length)
    erros.push("Nenhuma tabela compativel de funcao, HH e custo foi encontrada.");
  return { abas, itens: [...consolidados.values()], avisos, erros };
}
