# Jornadas com virada e adicional noturno

## Cálculo

A data do lançamento é o início da jornada. Uma saída menor que a entrada pertence ao dia seguinte; horários iguais são inválidos. A permanência máxima é inferior a 24 horas.

O intervalo é rateado antes de qualquer classificação. Para cada segmento, usa-se `produto = minutos brutos × intervalo total`, parte inteira `floor(produto / permanência)` e resto inteiro `produto % permanência`. Os minutos restantes seguem a regra **maior resto, com desempate pelo segmento cronologicamente anterior**. Assim, intervalo e minutos líquidos sempre conciliam exatamente.

Os cortes cronológicos são meia-noite, 22h e 5h. Sábado é HE 50%; domingo e feriado ativo são HE 100%. Em dias úteis, o limite normal vigente é consumido cronologicamente e não reinicia à meia-noite. Para supervisores, a parcela normal é preservada e somente o excedente é registrado como horas sem adicional de HE.

## Fórmula financeira

A convenção histórica de HE foi preservada:

- HE 50%: `hora-base × horas HE 50% × 1,5`;
- HE 100%: `hora-base × horas HE 100% × 2`;
- normal noturna: o custo-base mensal já cobre a hora normal; soma-se `hora-base × horas noturnas remuneráveis × 20%`;
- HE 50% noturna: `hora-base × horas noturnas remuneráveis × 1,20 × 1,50`;
- HE 100% noturna: `hora-base × horas noturnas remuneráveis × 1,20 × 2,00`;
- horas noturnas remuneráveis: `minutos noturnos reais líquidos ÷ 52,5`.

Para apresentação, a parcela-base da HE e sua diferença noturna são separadas, mas o total combinado é calculado uma única vez. Supervisores não recebem HE; como o salário mensal já contém o custo-base, recebem somente o adicional noturno estimado de 20%. Encargos e provisões seguem a mesma proporção já usada pelo cálculo de HE. A hora reduzida não altera a duração real utilizada pelos alertas de 10 e 12 horas.

## Compatibilidade

`registros_horas_detalhes` existe somente para lançamentos novos, editados ou copiados pelo fluxo v2. Registros históricos sem detalhe continuam usando `horas_normais`, `horas_extras` e `classificarHorasPorData`.

A migration não contém backfill. Aplicação segura:

1. publicar a migration;
2. cadastrar somente feriados confirmados em `feriados_obras_control`;
3. publicar a aplicação;
4. verificar a conciliação entre agregado e detalhe em lançamentos novos.

O calendário de feriados começa vazio e representa somente feriados globais aplicáveis ao Obras Control. Gerentes ou diretores devem cadastrar data e descrição confirmadas antes de ativar seu uso. Feriados estaduais ou municipais não devem ser cadastrados globalmente sem uma futura associação por obra. Não há consulta a API externa nem datas pré-carregadas.

## Histórico de aplicação

A migration `20260819120000_jornadas_virada_adicional_noturno.sql` foi aplicada manualmente em produção e pode não constar no histórico gerenciado do Supabase. O alinhamento futuro deve ser feito conscientemente com `supabase migration repair --status applied 20260819120000`, somente após conferir o schema instalado. Este comando não faz parte desta entrega e não deve ser executado automaticamente.
