export async function buscarTodasPaginas<T>(
  criarConsulta: (inicio: number, fim: number) => PromiseLike<{ data: unknown; error: unknown }>,
) {
  const tamanhoPagina = 1000;
  const linhas: T[] = [];

  for (let inicio = 0; ; inicio += tamanhoPagina) {
    const { data, error } = await criarConsulta(inicio, inicio + tamanhoPagina - 1);
    if (error) throw error;
    const pagina = (data ?? []) as T[];
    linhas.push(...pagina);
    if (pagina.length < tamanhoPagina) break;
  }

  return linhas;
}
