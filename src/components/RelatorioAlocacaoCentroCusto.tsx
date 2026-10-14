import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { getRelatorioAlocacaoCentroCusto } from "@/lib/relatorio-alocacao-centro-custo.functions";
import {
  filtrarFuncionariosAlocacaoCc,
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
  const filtradas = filtrarFuncionariosAlocacaoCc(funcionarios, {
    busca,
    funcionarioId,
    obraId,
    categoria,
  });
  const idsVisiveis = new Set(filtradas.map((funcionario) => funcionario.funcionarioId));
  const resumoVisivel = relatorio.resumo.filter(
    (linha) =>
      idsVisiveis.has(linha.funcionarioId) && (obraId === "all" || linha.obraId === obraId),
  );
  const centrosVisiveis = [
    ...new Map(resumoVisivel.map((linha) => [linha.obraId, linha])).values(),
  ].sort((a, b) => a.centroCusto.localeCompare(b.centroCusto, "pt-BR", { numeric: true }));
  const relatorioFiltrado = {
    ...relatorio,
    resumo: resumoVisivel,
    funcionarios: filtradas,
    detalhes: relatorio.detalhes.filter(
      (linha) =>
        idsVisiveis.has(linha.funcionario_id) && (obraId === "all" || linha.obra_id === obraId),
    ),
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
              <div className="overflow-x-auto">
                <Table className="min-w-max">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-20 min-w-[240px] bg-background">
                        Funcionário
                      </TableHead>
                      <TableHead className="sticky left-[240px] z-20 min-w-[200px] bg-background">
                        Categoria/Função
                      </TableHead>
                      <TableHead className="min-w-[120px] text-right">Dias disponíveis</TableHead>
                      <TableHead className="min-w-[110px] text-right">Dias alocados</TableHead>
                      <TableHead className="min-w-[190px]">Observação</TableHead>
                      {centrosVisiveis.map((centro) => (
                        <TableHead key={centro.obraId} className="min-w-[180px] text-center">
                          {centro.centroCusto} - {centro.obra}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!filtradas.length ? (
                      <TableRow>
                        <TableCell
                          colSpan={5 + centrosVisiveis.length}
                          className="py-10 text-center text-muted-foreground"
                        >
                          Não há alocações para esta competência.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtradas.map((funcionario) => (
                        <TableRow key={funcionario.funcionarioId}>
                          <TableCell className="sticky left-0 z-10 bg-background">
                            <button
                              type="button"
                              className="font-medium hover:underline"
                              onClick={() => setDetalheId(funcionario.funcionarioId)}
                            >
                              {funcionario.funcionarioNome}
                            </button>
                          </TableCell>
                          <TableCell className="sticky left-[240px] z-10 bg-background">
                            {funcionario.categoria}
                          </TableCell>
                          <TableCell className="text-right">
                            {funcionario.totalDiasDisponiveis}
                          </TableCell>
                          <TableCell className="text-right">
                            {funcionario.totalDiasAlocados}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {funcionario.observacao}
                          </TableCell>
                          {centrosVisiveis.map((coluna) => {
                            const centro = funcionario.centros.find(
                              (item) => item.obraId === coluna.obraId,
                            );
                            return (
                              <TableCell key={coluna.obraId} className="text-center">
                                {centro ? (
                                  <>
                                    <div className="font-medium">
                                      {percentual(centro.percentualDiasAlocados)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {centro.diasAlocados} dia(s)
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            );
                          })}
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
                  {["Data", "Centro de custo", "Obra"].map((t) => (
                    <TableHead key={t}>{t}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {detalhe?.detalhes.map((linha) => {
                  const partes = separarCentroCustoObra(linha.obra_nome);
                  return (
                    <TableRow key={`${linha.funcionario_id}|${linha.obra_id}|${linha.data}`}>
                      <TableCell>
                        {new Date(`${linha.data}T00:00:00`).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>{linha.obra_id ? partes.centroCusto : "—"}</TableCell>
                      <TableCell>{linha.obra_id ? partes.obra : "—"}</TableCell>
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
