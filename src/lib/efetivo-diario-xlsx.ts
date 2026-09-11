import CFB from "cfb";
import * as XLSX from "xlsx";

import type { FaltaTipo, TipoRegistro } from "./registro-falta.ts";
import { sanitizeXlsxFilename } from "./relatorio-centro-custo-xlsx.ts";

export type LinhaEfetivoDiario = {
  funcionario: string;
  funcao: string;
  tipoRegistro: TipoRegistro;
  faltaTipo?: FaltaTipo | null;
  trabalhoEfetivo: number;
  observacoes?: string | null;
};

export type EfetivoDiarioWorkbookInput = {
  data: string;
  obra: string;
  linhas: LinhaEfetivoDiario[];
};

type WorkSheetComFreeze = XLSX.WorkSheet & {
  "!freeze"?: { xSplit: number; ySplit: number };
};

const FORMATO_DATA = "dd/mm/yyyy";
const LINHA_CABECALHO = 5;
const CABECALHO = ["Funcionário", "Função", "Observações"];

const tituloStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 16 },
  fill: { fgColor: { rgb: "1F4E78" } },
  alignment: { horizontal: "left", vertical: "center" },
};

const cabecalhoStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: "2F75B5" } },
  alignment: { horizontal: "center", vertical: "center" },
};

const metadadoStyle = {
  font: { bold: true, color: { rgb: "1F4E78" } },
  alignment: { horizontal: "left", vertical: "center" },
};

type CfbContainer = ReturnType<typeof CFB.read>;

function substituirConteudoXml(
  cfb: CfbContainer,
  caminho: string,
  transformar: (xml: string) => string,
) {
  const arquivo = CFB.find(cfb, caminho);
  if (!arquivo?.content) throw new Error(`Parte XLSX não encontrada: ${caminho}`);
  const xml = new TextDecoder().decode(Uint8Array.from(arquivo.content));
  arquivo.content = new TextEncoder().encode(transformar(xml));
  arquivo.size = arquivo.content.length;
}

function adicionarItemXml(xml: string, colecao: string, item: string) {
  const abertura = new RegExp(`<${colecao} count="(\\d+)"`);
  const match = xml.match(abertura);
  if (!match) throw new Error(`Coleção XLSX não encontrada: ${colecao}`);
  return xml
    .replace(abertura, `<${colecao} count="${Number(match[1]) + 1}"`)
    .replace(`</${colecao}>`, `${item}</${colecao}>`);
}

export function writeEfetivoDiarioWorkbook(workbook: XLSX.WorkBook) {
  const original = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const cfb = CFB.read(original, { type: "buffer" });
  let tituloStyleId = 0;
  let cabecalhoStyleId = 0;
  let observacoesStyleId = 0;
  let metadadoStyleId = 0;

  substituirConteudoXml(cfb, "/xl/styles.xml", (originalStyles) => {
    const fontsCount = Number(originalStyles.match(/<fonts count="(\d+)"/)?.[1]);
    const fillsCount = Number(originalStyles.match(/<fills count="(\d+)"/)?.[1]);
    const cellXfsCount = Number(originalStyles.match(/<cellXfs count="(\d+)"/)?.[1]);
    if (![fontsCount, fillsCount, cellXfsCount].every(Number.isFinite)) {
      throw new Error("Estrutura de estilos XLSX inválida");
    }

    tituloStyleId = cellXfsCount;
    cabecalhoStyleId = cellXfsCount + 1;
    observacoesStyleId = cellXfsCount + 2;
    metadadoStyleId = cellXfsCount + 3;
    let styles = adicionarItemXml(
      originalStyles,
      "fonts",
      '<font><sz val="16"/><color rgb="FFFFFFFF"/><name val="Arial"/><b/></font>',
    );
    styles = adicionarItemXml(
      styles,
      "fonts",
      '<font><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><b/></font>',
    );
    styles = adicionarItemXml(
      styles,
      "fonts",
      '<font><sz val="11"/><color rgb="FF1F4E78"/><name val="Arial"/><b/></font>',
    );
    styles = adicionarItemXml(
      styles,
      "fills",
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>',
    );
    styles = adicionarItemXml(
      styles,
      "fills",
      '<fill><patternFill patternType="solid"><fgColor rgb="FF2F75B5"/><bgColor indexed="64"/></patternFill></fill>',
    );
    styles = adicionarItemXml(
      styles,
      "cellXfs",
      `<xf numFmtId="0" fontId="${fontsCount}" fillId="${fillsCount}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>`,
    );
    styles = adicionarItemXml(
      styles,
      "cellXfs",
      `<xf numFmtId="0" fontId="${fontsCount + 1}" fillId="${fillsCount + 1}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`,
    );
    styles = adicionarItemXml(
      styles,
      "cellXfs",
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>',
    );
    return adicionarItemXml(
      styles,
      "cellXfs",
      `<xf numFmtId="0" fontId="${fontsCount + 2}" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>`,
    );
  });

  substituirConteudoXml(cfb, "/xl/worksheets/sheet1.xml", (originalSheet) => {
    let sheetXml = originalSheet
      .replace(
        /<sheetView([^>]*)\/>/,
        (_match, atributos: string) =>
          `<sheetView${atributos}><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A6" sqref="A6"/></sheetView>`,
      )
      .replace(/<c r="A1"/, `<c r="A1" s="${tituloStyleId}"`)
      .replace(/<c r="A2"/, `<c r="A2" s="${metadadoStyleId}"`)
      .replace(/<c r="A3"/, `<c r="A3" s="${metadadoStyleId}"`);
    for (const coluna of ["A", "B", "C"]) {
      sheetXml = sheetXml.replace(
        new RegExp(`<c r="${coluna}5"`),
        `<c r="${coluna}5" s="${cabecalhoStyleId}"`,
      );
    }
    return sheetXml.replace(/<c r="C(\d+)"/g, (_match, linha: string) =>
      Number(linha) >= 6 ? `<c r="C${linha}" s="${observacoesStyleId}"` : `<c r="C${linha}"`,
    );
  });

  return CFB.write(cfb, { type: "buffer", fileType: "zip" });
}

function dataExcel(dataISO: string) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia) / 86_400_000 + 25_569;
}

export function efetivoDiarioXlsxFilename(input: EfetivoDiarioWorkbookInput) {
  return `Efetivo_${sanitizeXlsxFilename(input.obra)}_${input.data}.xlsx`;
}

export function buildEfetivoDiarioWorkbook(input: EfetivoDiarioWorkbookInput) {
  const workbook = XLSX.utils.book_new();
  const linhas = input.linhas
    .filter(
      (linha) =>
        linha.tipoRegistro === "horas" &&
        Number.isFinite(linha.trabalhoEfetivo) &&
        linha.trabalhoEfetivo > 0,
    )
    .map((linha) => [linha.funcionario, linha.funcao, linha.observacoes?.trim() ?? ""]);
  const sheet = XLSX.utils.aoa_to_sheet([
    ["EFETIVO", "", ""],
    ["Data:", dataExcel(input.data)],
    ["Centro de custo:", input.obra, ""],
    [],
    CABECALHO,
    ...linhas,
  ]) as WorkSheetComFreeze;

  sheet["!merges"] = [XLSX.utils.decode_range("A1:C1"), XLSX.utils.decode_range("B3:C3")];
  sheet["!rows"] = [{ hpt: 25 }, { hpt: 20 }, { hpt: 20 }, { hpt: 8 }, { hpt: 22 }];
  sheet["!cols"] = [{ wch: 42 }, { wch: 30 }, { wch: 60 }];
  sheet["!autofilter"] = {
    ref: `A${LINHA_CABECALHO}:C${Math.max(LINHA_CABECALHO, linhas.length + LINHA_CABECALHO)}`,
  };
  sheet["!freeze"] = { xSplit: 0, ySplit: LINHA_CABECALHO };

  for (let coluna = 0; coluna < CABECALHO.length; coluna += 1) {
    const titulo = sheet[XLSX.utils.encode_cell({ r: 0, c: coluna })];
    if (titulo) titulo.s = tituloStyle;
    const cabecalho = sheet[XLSX.utils.encode_cell({ r: LINHA_CABECALHO - 1, c: coluna })];
    if (cabecalho) cabecalho.s = cabecalhoStyle;
  }

  if (sheet.B2) {
    sheet.B2.z = FORMATO_DATA;
    sheet.B2.s = { alignment: { horizontal: "left", vertical: "center" } };
  }
  if (sheet.A2) sheet.A2.s = metadadoStyle;
  if (sheet.A3) sheet.A3.s = metadadoStyle;
  if (sheet.B3) sheet.B3.s = { alignment: { horizontal: "left", vertical: "center" } };

  for (let indice = 0; indice < linhas.length; indice += 1) {
    const linha = LINHA_CABECALHO + indice;
    for (let coluna = 0; coluna <= 1; coluna += 1) {
      const celula = sheet[XLSX.utils.encode_cell({ r: linha, c: coluna })];
      if (celula) celula.s = { alignment: { horizontal: "left", vertical: "center" } };
    }
    const observacoes = sheet[XLSX.utils.encode_cell({ r: linha, c: 2 })];
    if (observacoes) {
      observacoes.s = {
        alignment: { horizontal: "left", vertical: "top", wrapText: true },
      };
    }
  }

  XLSX.utils.book_append_sheet(workbook, sheet, "Efetivo");
  return workbook;
}

export function exportEfetivoDiarioXlsx(input: EfetivoDiarioWorkbookInput) {
  const conteudo = writeEfetivoDiarioWorkbook(buildEfetivoDiarioWorkbook(input));
  const url = URL.createObjectURL(
    new Blob([conteudo], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = efetivoDiarioXlsxFilename(input);
  link.click();
  URL.revokeObjectURL(url);
}
