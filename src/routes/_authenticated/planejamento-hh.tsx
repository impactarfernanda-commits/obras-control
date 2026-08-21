import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, FileUp } from "lucide-react";
import { RequireRole } from "@/components/RouteAccess";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fmtBRL } from "@/lib/custos";
import {
  composicoesNaoReconciliadas,
  conflitosCategoriaEntreTipos,
  ordenarCategoriasPlanejamento,
  pendenciasAtivacaoBaseline,
  type ResolucaoComposicao,
  type TipoMO,
} from "@/lib/planejamento-hh-core";
import {
  ativarPlanejamentoHH,
  getRascunhoPlanejamentoHH,
  getPlanejamentoHH,
  previewPlanejamentoHH,
  salvarPlanejamentoHH,
} from "@/lib/planejamento-hh.functions";
import type { PreviaImportacao } from "@/lib/planejamento-hh-parser";

export const Route = createFileRoute("/_authenticated/planejamento-hh")({
  component: () => (
    <RequireRole allowed={["gerente", "diretor"]}>
      <PlanejamentoPage />
    </RequireRole>
  ),
});

const hoje = () => new Date().toISOString().slice(0, 10);
const inicioAno = () => `${new Date().getFullYear()}-01-01`;
const n = (v: number | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const pct = (v: number | null | undefined) => (v == null ? "—" : `${n(v)}%`);
type Previa = PreviaImportacao & { resolucoesComposicoes?: ResolucaoComposicao[] };

function PlanejamentoPage() {
  const { role } = useAuth();
  const financeiro = role === "gerente" || role === "diretor";
  const [obraId, setObraId] = useState("");
  const [dataInicial, setDataInicial] = useState(inicioAno());
  const [dataFinal, setDataFinal] = useState(hoje());
  const { data: obras = [] } = useQuery({
    queryKey: ["obras-planejamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("obras")
        .select("id,nome")
        .eq("visivel_obras_control", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
  });
  const consulta = useQuery({
    queryKey: ["planejamento-hh", obraId, dataInicial, dataFinal],
    enabled: !!obraId,
    queryFn: () => getPlanejamentoHH({ data: { obraId, dataInicial, dataFinal } }),
  });
  const linhas = useMemo(
    () => ordenarCategoriasPlanejamento(consulta.data?.linhas ?? []),
    [consulta.data?.linhas],
  );
  const consolidado = useMemo(
    () =>
      ["MOI", "MOD"].map((tipo) => {
        const filtradas = linhas.filter((l) => l.tipo === tipo);
        const previsto = filtradas.reduce((s, l) => s + l.hhPrevisto, 0);
        const realizado = filtradas.reduce((s, l) => s + l.hhRealizado, 0);
        return { tipo, previsto, realizado };
      }),
    [linhas],
  );
  const ausenciasResumo = useMemo(
    () =>
      Object.entries(
        linhas.reduce<Record<string, number>>((acc, l) => {
          for (const [tipo, horas] of Object.entries(l.ausencias))
            acc[tipo] = (acc[tipo] ?? 0) + horas;
          return acc;
        }, {}),
      ),
    [linhas],
  );
  const custosResumo = useMemo(
    () =>
      Object.entries(
        linhas.reduce<Record<string, number>>((acc, l) => {
          for (const [tipo, valor] of Object.entries(l.composicaoCusto ?? {}))
            acc[tipo] = (acc[tipo] ?? 0) + valor;
          return acc;
        }, {}),
      ),
    [linhas],
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Planejamento HH e Custos"
        description="Linha de base orçamentária versus realizado por centro de custo e função."
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-72">
          <Select value={obraId} onValueChange={setObraId}>
            <SelectTrigger>
              <SelectValue placeholder="Centro de custo" />
            </SelectTrigger>
            <SelectContent>
              {obras.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          className="w-40"
          type="date"
          value={dataInicial}
          onChange={(e) => setDataInicial(e.target.value)}
        />
        <Input
          className="w-40"
          type="date"
          value={dataFinal}
          onChange={(e) => setDataFinal(e.target.value)}
        />
        {financeiro && obraId && <ImportarBaseline obraId={obraId} />}
      </div>
      {!obraId && (
        <Alert>
          <AlertTitle>Selecione um centro de custo</AlertTitle>
          <AlertDescription>
            O filtro é obrigatório para carregar a baseline e o realizado.
          </AlertDescription>
        </Alert>
      )}
      {consulta.isError && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{consulta.error.message}</AlertDescription>
        </Alert>
      )}
      {consulta.data?.alertas.map((a) => (
        <Alert key={a}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>{a}</AlertDescription>
        </Alert>
      ))}
      {consulta.data?.baseline && (
        <>
          <div className="text-sm text-muted-foreground">
            Baseline ativa: <strong>{consulta.data.baseline.nome}</strong> · versão{" "}
            {consulta.data.baseline.versao}
          </div>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Kpi titulo="HH previsto" valor={n(consulta.data.totais?.hhPrevisto)} />
            <Kpi titulo="HH realizado" valor={n(consulta.data.totais?.hhRealizado)} />
            <Kpi titulo="Saldo HH" valor={n(consulta.data.totais?.saldoHH)} />
            <Kpi
              titulo="HH consumido"
              valor={pct(consulta.data.totais?.percentualHH)}
              alerta={(consulta.data.totais?.percentualHH ?? 0) > 100}
            />
            <Kpi titulo="Horas de ausência" valor={n(consulta.data.totais?.horasAusencia)} />
            {consulta.data.acessoFinanceiro && (
              <>
                <Kpi
                  titulo="Custo previsto"
                  valor={fmtBRL(consulta.data.totais?.custoPrevisto ?? 0)}
                />
                <Kpi
                  titulo="Custo realizado"
                  valor={fmtBRL(consulta.data.totais?.custoRealizado ?? 0)}
                />
                <Kpi
                  titulo="Saldo financeiro"
                  valor={fmtBRL(consulta.data.totais?.saldoCusto ?? 0)}
                />
                <Kpi
                  titulo="Custo consumido"
                  valor={pct(consulta.data.totais?.percentualCusto)}
                  alerta={(consulta.data.totais?.percentualCusto ?? 0) > 100}
                />
              </>
            )}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Grafico
              titulo="Previsto x realizado por função — HH"
              dados={linhas.map((l) => ({
                nome: l.funcao,
                previsto: l.hhPrevisto,
                realizado: l.hhRealizado,
              }))}
            />
            <Grafico
              titulo="MOI x MOD — HH"
              dados={consolidado.map((l) => ({
                nome: l.tipo,
                previsto: l.previsto,
                realizado: l.realizado,
              }))}
            />
            {consulta.data.acessoFinanceiro && (
              <Grafico
                titulo="Previsto x realizado por função — R$"
                dados={linhas.map((l) => ({
                  nome: l.funcao,
                  previsto: l.custoPrevisto ?? 0,
                  realizado: l.custoRealizado ?? 0,
                }))}
              />
            )}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Resumo titulo="Ausências por tipo" itens={ausenciasResumo} moeda={false} />
            {consulta.data.acessoFinanceiro && (
              <Resumo
                titulo="Composição do custo realizado"
                itens={custosResumo.filter(
                  ([tipo]) => !["falta_nao_justificada", "suspensao", "outro"].includes(tipo),
                )}
                moeda
              />
            )}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Comparativo por função</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Função</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>HH previsto</TableHead>
                    <TableHead>HH realizado</TableHead>
                    <TableHead>Ausência</TableHead>
                    <TableHead>Saldo HH</TableHead>
                    <TableHead>% HH</TableHead>
                    {consulta.data.acessoFinanceiro && (
                      <>
                        <TableHead>Custo previsto</TableHead>
                        <TableHead>Custo realizado</TableHead>
                        <TableHead>Saldo R$</TableHead>
                        <TableHead>% custo</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l) => (
                    <TableRow
                      key={`${l.funcao}-${l.tipo}`}
                      className={l.semMapeamento ? "bg-amber-50" : ""}
                    >
                      <TableCell>
                        {l.funcao}
                        {l.semMapeamento && (
                          <Badge className="ml-2" variant="outline">
                            Não mapeado
                          </Badge>
                        )}
                        {l.funcoesOrcamento.length > 1 && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Orçamento: {l.funcoesOrcamento.join(", ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{l.tipo}</TableCell>
                      <TableCell>{n(l.hhPrevisto)}</TableCell>
                      <TableCell>{n(l.hhRealizado)}</TableCell>
                      <TableCell>{n(l.horasAusencia)}</TableCell>
                      <TableCell>{n(l.saldo)}</TableCell>
                      <TableCell>{pct(l.percentual)}</TableCell>
                      {consulta.data.acessoFinanceiro && (
                        <>
                          <TableCell>{fmtBRL(l.custoPrevisto ?? 0)}</TableCell>
                          <TableCell>{fmtBRL(l.custoRealizado ?? 0)}</TableCell>
                          <TableCell>{fmtBRL(l.saldoCusto ?? 0)}</TableCell>
                          <TableCell>{pct(l.percentualCusto)}</TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ titulo, valor, alerta }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <Card className={alerta ? "border-destructive" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-bold">{valor}</CardContent>
    </Card>
  );
}
function Grafico({
  titulo,
  dados,
}: {
  titulo: string;
  dados: Array<{ nome: string; previsto: number; realizado: number }>;
}) {
  const altura = Math.max(350, dados.length * 48);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
      </CardHeader>
      <CardContent style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical" margin={{ left: 16, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis
              dataKey="nome"
              type="category"
              interval={0}
              width={240}
              tick={{ fontSize: 12 }}
            />
            <Tooltip />
            <Legend />
            <Bar dataKey="previsto" name="Previsto" fill="#64748b" />
            <Bar dataKey="realizado" name="Realizado" fill="#2563eb" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
function Resumo({
  titulo,
  itens,
  moeda,
}: {
  titulo: string;
  itens: Array<[string, number]>;
  moeda: boolean;
}) {
  const labels: Record<string, string> = {
    horas_trabalhadas: "Horas trabalhadas",
    regime_local: "Refeição Local — dias trabalhados",
    regime_alojado: "Refeição Alojado — dias corridos",
    ferias: "Férias",
    folga_campo: "Folga de campo",
    atestado: "Atestado",
    falta_justificada: "Falta justificada",
    falta_nao_justificada: "Falta não justificada",
    suspensao: "Suspensão",
    afastamento: "Afastamento",
    outro: "Outro",
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            {itens.map(([tipo, valor]) => (
              <TableRow key={tipo}>
                <TableCell>{labels[tipo] ?? tipo}</TableCell>
                <TableCell className="text-right">
                  {moeda ? fmtBRL(valor) : `${n(valor)} h`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ImportarBaseline({ obraId }: { obraId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [arquivo, setArquivo] = useState("");
  const [nome, setNome] = useState("Baseline contratual");
  const [versao, setVersao] = useState(1);
  const [mapas, setMapas] = useState<Record<string, string>>({});
  const [resolucoesComposicoes, setResolucoesComposicoes] = useState<ResolucaoComposicao[]>([]);
  const [baselineIdSalvo, setBaselineIdSalvo] = useState<string | null>(null);
  const [alteracoesPendentes, setAlteracoesPendentes] = useState(false);
  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias-mapeamento-hh"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categorias").select("nome,tipo").order("nome");
      if (error) throw error;
      return data;
    },
  });
  const rascunho = useQuery({
    queryKey: ["rascunho-planejamento-hh", obraId],
    queryFn: () => getRascunhoPlanejamentoHH({ data: { obraId } }),
    enabled: open,
  });
  const tiposCategorias = useMemo(
    () =>
      new Map(categorias.map((categoria) => [categoria.nome, categoria.tipo as TipoMO] as const)),
    [categorias],
  );
  const conflitosTipos = useMemo(
    () =>
      previa
        ? conflitosCategoriaEntreTipos(
            previa.itens.map((i) => ({
              funcaoOrcamento: i.funcaoOrcamento,
              tipoMo: tiposCategorias.get(mapas[`${i.funcaoOrcamento}|${i.tipoMo}`]) ?? i.tipoMo,
              categoriaMo: mapas[`${i.funcaoOrcamento}|${i.tipoMo}`] ?? null,
            })),
          )
        : [],
    [mapas, previa, tiposCategorias],
  );
  const pendenciasAtivacao = useMemo(
    () =>
      pendenciasAtivacaoBaseline(
        previa?.erros ?? [],
        previa?.itens.map((i) => ({
          funcaoOrcamento: i.funcaoOrcamento,
          tipoMo: tiposCategorias.get(mapas[`${i.funcaoOrcamento}|${i.tipoMo}`]) ?? i.tipoMo,
          categoriaMo: mapas[`${i.funcaoOrcamento}|${i.tipoMo}`] ?? null,
        })) ?? [],
        resolucoesComposicoes,
      ),
    [mapas, previa, resolucoesComposicoes, tiposCategorias],
  );
  const composicoesPendentes = useMemo(
    () => composicoesNaoReconciliadas(previa?.erros ?? []),
    [previa],
  );
  const preview = useMutation({
    mutationFn: async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 32768)
        bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
      setArquivo(file.name);
      return previewPlanejamentoHH({
        data: { nomeArquivo: file.name, arquivoBase64: btoa(bin) },
      }) as Promise<PreviaImportacao>;
    },
    onSuccess: (resultado) => {
      setPrevia(resultado);
      setMapas({});
      setResolucoesComposicoes([]);
      setBaselineIdSalvo(null);
      setAlteracoesPendentes(true);
    },
  });
  const salvar = useMutation({
    mutationFn: async () => {
      if (!previa) throw new Error("Gere a prévia primeiro");
      const result = await salvarPlanejamentoHH({
        data: {
          baselineId: baselineIdSalvo,
          obraId,
          nome,
          versao,
          nomeArquivo: arquivo,
          abas: previa.abas,
          pendencias: previa.erros,
          avisos: previa.avisos,
          resolucoesComposicoes,
          itens: previa.itens,
          mapeamentos: previa.itens.map((i) => ({
            funcaoOrcamento: i.funcaoOrcamento,
            tipoMo: i.tipoMo,
            categoriaMo: mapas[`${i.funcaoOrcamento}|${i.tipoMo}`] ?? null,
          })),
        },
      });
      return result;
    },
    onSuccess: async (result) => {
      setBaselineIdSalvo(result.baselineId);
      setAlteracoesPendentes(false);
      await qc.invalidateQueries({ queryKey: ["rascunho-planejamento-hh", obraId] });
    },
  });
  const ativar = useMutation({
    mutationFn: async () => {
      if (!baselineIdSalvo || alteracoesPendentes)
        throw new Error("Salve o rascunho atualizado antes de ativar.");
      return ativarPlanejamentoHH({ data: { baselineId: baselineIdSalvo } });
    },
    onSuccess: async () => {
      setOpen(false);
      setPrevia(null);
      setMapas({});
      setResolucoesComposicoes([]);
      setBaselineIdSalvo(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["planejamento-hh"] }),
        qc.invalidateQueries({ queryKey: ["rascunho-planejamento-hh", obraId] }),
      ]);
    },
  });
  const reabrirRascunho = () => {
    const salvo = rascunho.data;
    if (!salvo) return;
    setNome(salvo.nome);
    setVersao(salvo.versao);
    setArquivo(salvo.nomeArquivo);
    setPrevia(salvo.previa as Previa);
    setResolucoesComposicoes(salvo.previa.resolucoesComposicoes ?? []);
    setMapas(
      Object.fromEntries(
        salvo.previa.itens
          .filter((item) => item.categoriaMo)
          .map((item) => [`${item.funcaoOrcamento}|${item.tipoMo}`, item.categoriaMo as string]),
      ),
    );
    setBaselineIdSalvo(salvo.baselineId);
    setAlteracoesPendentes(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FileUp className="mr-2 h-4 w-4" />
          Importar baseline
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar orçamento XLSM/XLSX</DialogTitle>
        </DialogHeader>
        {rascunho.data && !previa && (
          <Alert>
            <AlertTitle>Rascunho disponível</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {rascunho.data.nome} · versão {rascunho.data.versao} · {rascunho.data.nomeArquivo}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={reabrirRascunho}>
                Reabrir rascunho
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
              setAlteracoesPendentes(true);
            }}
            placeholder="Nome da baseline"
          />
          <Input
            type="number"
            min={1}
            value={versao}
            onChange={(e) => {
              setVersao(Number(e.target.value));
              setAlteracoesPendentes(true);
            }}
          />
          <Input
            type="file"
            accept=".xlsm,.xlsx"
            onChange={(e) => e.target.files?.[0] && preview.mutate(e.target.files[0])}
          />
        </div>
        {preview.isPending && <p>Analisando workbook sem executar macros…</p>}
        {previa && (
          <>
            <div className="text-sm">Abas: {previa.abas.join(", ")}</div>
            {[
              ...previa.erros.filter((erro) => !composicoesNaoReconciliadas([erro]).length),
              ...previa.avisos,
            ].map((a) => (
              <Alert key={a}>
                <AlertDescription>{a}</AlertDescription>
              </Alert>
            ))}
            {composicoesPendentes.map((codigo) => {
              const resolucao = resolucoesComposicoes.find(
                (item) => item.codigoComposicao === codigo,
              );
              return (
                <Card key={codigo} className="border-muted">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Composição {codigo}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="text-muted-foreground">
                      Composição não disponível para decomposição de mão de obra própria.
                    </p>
                    {resolucao?.descricao && <p>{resolucao.descricao}</p>}
                    {resolucao?.valorGlobalCacheado != null && (
                      <p>Valor global da composição: {fmtBRL(resolucao.valorGlobalCacheado)}</p>
                    )}
                    {resolucao ? (
                      <div className="space-y-1">
                        <Badge variant="outline">✓ Fora do escopo de MO própria</Badge>
                        <p className="text-muted-foreground">
                          Serviço terceirizado / não considerado no HH e custo de MO.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setResolucoesComposicoes((atuais) => [
                              ...atuais,
                              {
                                codigoComposicao: codigo,
                                resolucao: "fora_escopo_mo",
                                motivo: "servico_terceirizado",
                                hhMoConsiderado: 0,
                                custoMoConsiderado: 0,
                              },
                            ]);
                            setAlteracoesPendentes(true);
                          }}
                        >
                          Fora do escopo de MO própria
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Serviço terceirizado ou composição sem mão de obra própria controlada pelo
                          Obras Control.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {conflitosTipos.map((categoria) => (
              <Alert key={categoria} variant="destructive">
                <AlertDescription>
                  A categoria {categoria} está associada simultaneamente a itens MOI e MOD. O Obras
                  Control não possui informação suficiente para dividir o HH realizado.
                </AlertDescription>
              </Alert>
            ))}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Função orçamento</TableHead>
                  <TableHead>Tipo orçamento</TableHead>
                  <TableHead>HH previsto</TableHead>
                  <TableHead>Custo previsto</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Mapeamento confirmado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previa.itens.map((i) => {
                  const key = `${i.funcaoOrcamento}|${i.tipoMo}`;
                  const categoriaSelecionada = categorias.find((c) => c.nome === mapas[key]);
                  return (
                    <TableRow key={key}>
                      <TableCell>{i.funcaoOrcamento}</TableCell>
                      <TableCell>{i.tipoMo}</TableCell>
                      <TableCell>{n(i.hhPrevisto)}</TableCell>
                      <TableCell>{fmtBRL(i.custoPrevisto)}</TableCell>
                      <TableCell>{i.origem}</TableCell>
                      <TableCell>
                        <Select
                          value={mapas[key] ?? ""}
                          onValueChange={(v) => {
                            setMapas((m) => ({ ...m, [key]: v }));
                            setAlteracoesPendentes(true);
                          }}
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue placeholder="Aguardando mapeamento" />
                          </SelectTrigger>
                          <SelectContent>
                            {categorias.map((c) => (
                              <SelectItem key={c.nome} value={c.nome}>
                                <span className="flex w-full items-center justify-between gap-3">
                                  <span>{c.nome}</span>
                                  <span className="text-xs text-muted-foreground">{c.tipo}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {categoriaSelecionada && (
                          <div className="mt-1 flex max-w-56 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge variant="outline" className="font-normal">
                              Mapeado
                            </Badge>
                            <span>Tipo considerado: {categoriaSelecionada.tipo}</span>
                            {categoriaSelecionada.tipo !== i.tipoMo && (
                              <span>· orçamento originalmente classificado como {i.tipoMo}</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!!pendenciasAtivacao.length && (
              <Alert>
                <AlertTitle>
                  {pendenciasAtivacao.length}{" "}
                  {pendenciasAtivacao.length === 1 ? "pendência impede" : "pendências impedem"} a
                  ativação
                </AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {pendenciasAtivacao.map((pendencia) => (
                      <li key={pendencia}>{pendencia}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
                Salvar baseline
              </Button>
              <Button
                variant="secondary"
                disabled={
                  !baselineIdSalvo ||
                  alteracoesPendentes ||
                  !!pendenciasAtivacao.length ||
                  ativar.isPending
                }
                onClick={() => ativar.mutate()}
              >
                Ativar baseline
              </Button>
              {baselineIdSalvo && !alteracoesPendentes && (
                <span className="self-center text-sm text-muted-foreground">Rascunho salvo.</span>
              )}
            </div>
            {salvar.isError && <p className="text-sm text-destructive">{salvar.error.message}</p>}
            {ativar.isError && <p className="text-sm text-destructive">{ativar.error.message}</p>}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
