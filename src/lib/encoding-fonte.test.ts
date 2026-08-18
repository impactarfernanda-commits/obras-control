import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

function arquivosTypeScript(diretorio: string): string[] {
  if (!existsSync(diretorio)) return [];
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) return arquivosTypeScript(caminho);
    return [".ts", ".tsx"].includes(extname(caminho)) ? [caminho] : [];
  });
}

const fontes = [...arquivosTypeScript("src"), ...arquivosTypeScript("tests")];
const prefixosMojibake = [
  String.fromCodePoint(0x00c3, 0x0192),
  String.fromCodePoint(0x00c3, 0x201a),
  String.fromCodePoint(0x00ef, 0x00bf, 0x00bd),
];
const paresMojibake = [
  new RegExp(String.fromCodePoint(0x00c3) + "[\\u0080-\\u00bf]"),
  new RegExp(String.fromCodePoint(0x00c2) + "[\\u0080-\\u00bf]"),
];

test("fontes TypeScript nao contem sequencias tipicas de mojibake", () => {
  const ocorrencias = fontes.flatMap((arquivo) => {
    const conteudo = readFileSync(arquivo, "utf8");
    const prefixos = prefixosMojibake
      .filter((prefixo) => conteudo.includes(prefixo))
      .map(
        (prefixo) =>
          `${arquivo}: U+${Array.from(prefixo, (c) => c.codePointAt(0)?.toString(16)).join(" U+")}`,
      );
    const pares = paresMojibake
      .filter((padrao) => padrao.test(conteudo))
      .map((padrao) => `${arquivo}: ${padrao.source}`);
    return [...prefixos, ...pares];
  });
  assert.deepEqual(ocorrencias, []);
});

test("textos operacionais permanecem em portugues UTF-8", () => {
  const tela = readFileSync("src/routes/_authenticated/alocacoes.tsx", "utf8");
  const periodo = readFileSync("src/components/AlocarPeriodoDialog.tsx", "utf8");
  for (const texto of ["Atuação do ajudante", "alocações", "Funcionário"]) {
    assert.ok(tela.includes(texto) || periodo.includes(texto), `texto ausente: ${texto}`);
  }

  const iniciosCorrompidos = ["Atua", "classifica", "aloca", "Funcion", "Compet", "Per"].map(
    (inicio) => inicio + String.fromCodePoint(0x00c3, 0x0192),
  );
  for (const prefixo of iniciosCorrompidos) {
    assert.equal(tela.includes(prefixo) || periodo.includes(prefixo), false);
  }
});
