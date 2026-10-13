import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { calcularCompetencia, formatarPeriodoCompetencia } from "@/lib/competencias";
import { formatarHorasDecimais } from "@/lib/horas-extras";
import { rotuloFalta, rotuloTipoRegistro } from "@/lib/registro-falta";
import { getRelatorioAlocacaoCentroCusto } from "@/lib/relatorio-alocacao-centro-custo.functions";
import {
  montarRelatorioAlocacaoCentroCusto,
  separarCentroCustoObra,
} from "@/lib/relatorio-alocacao-centro-custo";
import { exportarAlocacaoCentroCustoXlsx } from "@/lib/relatorio-alocacao-centro-custo-xlsx";

const percentual = (valor: number) =>
  `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

export function RelatorioAlocacaoCentroCusto({ year, month }: { year: number; month: number }) {
  const competencia = `${year}-${String(month + 1).padStart(2, "0")}`;
  const periodo = calcularCompetencia(`${competencia}-01`);
  const [busca, setBusca] = useState("");
  const [funcionarioId, setFuncionarioId] = useState("all");
  const [obraId, setObraId] = useState("all");
  const [categoria, setCategoria] = useState("all");
  const [somentePendencias, setSomentePendencias] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["relatorio-alocacao-centro-custo", competencia],
    queryFn: () => getRelatorioAlocacaoCentroCusto({ data: { competencia } }),
  });
  const relatorio = useMemo(
    () => montarRelatorioAlocacaoCentroCusto(query.data ?? []),
    [query.data],
  );
  const funcionarios = relatorio.funcionarios;
  const obras = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const linha of relatorio.resumo) mapa.set(linha.obraId, linha.obraNome);
    return [...mapa].sort((a, b) => a[1].localeCompare(b[1], "pt-BR", { numeric: true }));
  }, [relatorio.resumo]);
  const categorias = useMemo(
    () =>
      [...new Set(funcionarios.map((item) => item.categoria))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [funcionarios],
  );
  const filtradas = relatorio.resumo.filter((linha) => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return (
      (!termo || linha.funcionarioNome.toLocaleLowerCase("pt-BR").includes(termo)) &&
      (funcionarioId === "all" || linha.funcionarioId === funcionarioId) &&
      (obraId === "all" || linha.obraId === obraId) &&
      (categoria === "all" || linha.categoria === categoria) &&
      (!somentePendencias || linha.possuiPendencia)
    );
  });
  const idsVisiveis = new Set(filtradas.map((linha) => linha.funcionarioId));
  const relatorioFiltrado = {
    ...relatorio,
    resumo: filtradas,
    detalhes: relatorio.detalhes.filter((linha) => idsVisiveis.has(linha.funcionario_id)),
  };
  const detalhe = funcionarios.find((item) => item.funcionarioId === detalheId) ?? null;

  return (
    <>
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Alocação por Centro de Custo</CardTitle>
              <p className="mt-1 text-sm capitalize text-muted-foreground">
                {new Date(year, month, 1).toLocaleDateString("pt-BR", {
                  month: "long",
                  year: "numeric",
                })}{" "}
                <span className="normal-case">({formatarPeriodoCompetencia(periodo)})</span>
              </p>
            </div>
            <Button
              variant="outline"
              disabled={!filtradas.length}
              onClick={() => exportarAlocacaoCentroCustoXlsx(relatorioFiltrado, competencia)}
            >
              <Download className="mr-2 h-4 w-4" /> Exportar Excel
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-[250px]"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar funcionário"
            />
            <Select value={funcionarioId} onValueChange={setFuncionarioId}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Funcionário" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os funcionários</SelectItem>
                {funcionarios.map((f) => (
                  <SelectItem key={f.funcionarioId} value={f.funcionarioId}>
                    {f.funcionarioNome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={obraId} onValueChange={setObraId}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Centro de custo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os centros</SelectItem>
                {obras.map(([id, nome]) => (
                  <SelectItem key={id} value={id}>
                    {nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Categoria/Função" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {categorias.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 rounded-md border px-3 text-sm">
              <Checkbox
                checked={somentePendencias}
                onCheckedChange={(v) => setSomentePendencias(v === true)}
              />
              Somente com pendência de alocação
            </label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {query.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : query.isError ? (
            <Alert variant="destructive" className="m-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Não foi possível carregar o relatório</AlertTitle>
              <AlertDescription>
                {query.error instanceof Error ? query.error.message : "Tente novamente."}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {relatorio.inconsistencias > 0 && (
                <Alert className="m-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Há pendências para auditoria</AlertTitle>
                  <AlertDescription>
                    {relatorio.inconsistencias} dia(s) apresentam inconsistência. Os dados válidos
                    continuam visíveis.
                  </AlertDescription>
                </Alert>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        "Funcionário",
                        "Categoria/Função",
                        "Centro de custo",
                        "Obra",
                        "Dias alocados",
                        "Horas normais",
                        "HE 50%",
                        "HE 100%",
                        "Horas sem adicional",
                        "Total de horas",
                        "% dos dias alocados",
                        "Dias esperados",
                        "Dias de ausência",
                        "Dias sem alocação",
                        "% cobertura",
                        "Pendência",
                      ].map((titulo) => (
                        <TableHead
                          key={titulo}
                          className={titulo.match(/Dias|Horas|HE|%/) ? "text-right" : ""}
                        >
                          {titulo}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!filtradas.length ? (
                      <TableRow>
                        <TableCell colSpan={16} className="py-10 text-center text-muted-foreground">
                          Não há alocações ou registros para esta competência.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtradas.map((linha) => (
                        <TableRow key={`${linha.funcionarioId}|${linha.obraId}`}>
                          <TableCell>
                            <button
                              type="button"
                              className="font-medium hover:underline"
                              onClick={() => setDetalheId(linha.funcionarioId)}
                            >
                              {linha.funcionarioNome}
                            </button>
                          </TableCell>
                          <TableCell>{linha.categoria}</TableCell>
                          <TableCell>{linha.centroCusto}</TableCell>
                          <TableCell>{linha.obra}</TableCell>
                          <TableCell className="text-right">{linha.diasAlocados}</TableCell>
                          <TableCell className="text-right">
                            {formatarHorasDecimais(linha.horasNormais)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatarHorasDecimais(linha.horas50)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatarHorasDecimais(linha.horas100)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatarHorasDecimais(linha.horasSemAdicional)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatarHorasDecimais(linha.totalHoras)}
                          </TableCell>
                          <TableCell className="text-right">
                            {percentual(linha.percentualDiasAlocados)}
                          </TableCell>
                          <TableCell className="text-right">{linha.diasEsperados}</TableCell>
                          <TableCell className="text-right">{linha.diasAusencia}</TableCell>
                          <TableCell className="text-right">{linha.diasSemAlocacao}</TableCell>
                          <TableCell className="text-right">
                            {percentual(linha.percentualCobertura)}
                          </TableCell>
                          <TableCell className="max-w-[260px]">
                            {linha.possuiPendencia ? (
                              <Badge variant="outline" title={linha.observacaoPendencia}>
                                Revisar
                              </Badge>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={Boolean(detalhe)}
        onOpenChange={(open) => {
          if (!open) setDetalheId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-7xl">
          <DialogHeader>
            <DialogTitle>Detalhamento diário da alocação</DialogTitle>
            <DialogDescription>
              {detalhe?.funcionarioNome} · {detalhe?.categoria} ·{" "}
              {formatarPeriodoCompetencia(periodo)}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Data",
                    "Centro de custo",
                    "Obra",
                    "Situação",
                    "Tipo",
                    "Classificação",
                    "Entrada",
                    "Saída",
                    "Normais",
                    "HE 50%",
                    "HE 100%",
                    "Sem adicional",
                    "Total",
                    "Observação",
                    "Pendência",
                  ].map((t) => (
                    <TableHead key={t}>{t}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detalhe?.detalhes.map((linha) => {
                  const partes = separarCentroCustoObra(linha.obra_nome);
                  const total =
                    (linha.minutos_normais +
                      linha.minutos_he_50 +
                      linha.minutos_he_100 +
                      linha.minutos_sem_adicional_he) /
                    60;
                  return (
                    <TableRow key={`${linha.funcionario_id}|${linha.data}`}>
                      <TableCell>
                        {new Date(`${linha.data}T00:00:00`).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>{linha.obra_id ? partes.centroCusto : "—"}</TableCell>
                      <TableCell>{linha.obra_id ? partes.obra : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={linha.possui_inconsistencia ? "destructive" : "secondary"}>
                          {linha.situacao.replaceAll("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {linha.tipo_registro ? rotuloTipoRegistro(linha.tipo_registro) : "—"}
                      </TableCell>
                      <TableCell>
                        {linha.tipo_registro === "falta" ? rotuloFalta(linha.falta_tipo) : "—"}
                      </TableCell>
                      <TableCell>{linha.hora_entrada ?? "—"}</TableCell>
                      <TableCell>{linha.hora_saida ?? "—"}</TableCell>
                      <TableCell>{formatarHorasDecimais(linha.minutos_normais / 60)}</TableCell>
                      <TableCell>{formatarHorasDecimais(linha.minutos_he_50 / 60)}</TableCell>
                      <TableCell>{formatarHorasDecimais(linha.minutos_he_100 / 60)}</TableCell>
                      <TableCell>
                        {formatarHorasDecimais(linha.minutos_sem_adicional_he / 60)}
                      </TableCell>
                      <TableCell>{formatarHorasDecimais(total)}</TableCell>
                      <TableCell>{linha.observacoes ?? "—"}</TableCell>
                      <TableCell>{linha.tipo_inconsistencia ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
