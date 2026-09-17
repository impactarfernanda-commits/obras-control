# Aplicação futura: cópia somente de jornadas

Este é um checklist para uma janela futura de aplicação controlada. Nenhuma etapa foi executada na preparação local. A comparação anterior de Production com as bases de 24/08 e 28/08 não substitui a conferência no momento da aplicação.

## Antes da aplicação

- [ ] Obter autorização específica para o ambiente e a janela de aplicação.
- [ ] Confirmar novamente que nenhuma migration posterior alterou `public.obras_copiar_dia_anterior(uuid,date,date,boolean)` ou `public.obras_copiar_jornadas_v2(jsonb)`.
- [ ] Registrar as definições, assinaturas, `RETURNS jsonb`, segurança, `search_path` e permissões das duas RPCs antes da alteração.
- [ ] Manter disponível `supabase/manual/ROLLBACK_20260917120000_copia_somente_jornadas.sql` e conferir que ele ainda corresponde às definições anteriores.

## Aplicação e validação

- [ ] Aplicar `supabase/migrations/20260917120000_copia_somente_jornadas.sql` no ambiente autorizado.
- [ ] Conferir que as duas assinaturas, `RETURNS jsonb`, `SECURITY DEFINER`, `search_path` e grants permanecem corretos.
- [ ] Executar smoke test controlado com dados conhecidos e verificar que uma jornada normal válida é copiada.
- [ ] Verificar que jornada com horas normais zero e horas extras positivas continua elegível, respeitadas as demais regras de gravação.
- [ ] Verificar que Folga de campo, Férias, Falta, Atestado, Afastamento, alocação sem registro de horas e origem ambígua não geram jornada no destino.
- [ ] Validar `Alocar período` com `origemCalculo = "aplicacao"`, inclusive sem `origemData`.
- [ ] Validar que um destino já ocupado é preservado e não recebe sobrescrita.
- [ ] Validar que os contadores de processados, preservados e não copiáveis retornados pela RPC correspondem exatamente aos registros observados.
- [ ] Validar uma prévia que se torna inelegível antes da execução; o resultado da execução deve refletir a revalidação da RPC.
- [ ] Se houver infraestrutura adequada, testar duas transações concorrentes para o mesmo funcionário e data, sem duplicidade, sobrescrita ou deadlock.
- [ ] Validar no frontend a grade semanal, o formulário de período de Folga de campo e Férias e as mensagens de prévia e execução da cópia.
- [ ] Somente após a validação do backend, publicar o frontend no ambiente autorizado.

## Critérios de rollback

Interromper a aplicação e avaliar o rollback se ocorrer qualquer um destes casos:

- `Alocar período` apresentar regressão;
- uma ausência gerar jornada ou ser propagada automaticamente;
- uma jornada válida deixar de copiar;
- um destino ocupado ser sobrescrito;
- os contadores da RPC divergirem dos registros efetivos;
- chamadas existentes da RPC apresentarem erro inesperado.

Se o rollback for necessário, executar somente sob autorização e na janela controlada o arquivo `supabase/manual/ROLLBACK_20260917120000_copia_somente_jornadas.sql`, então conferir novamente definição, assinatura, segurança, grants e o fluxo `origemCalculo = "aplicacao"`. Registrar os resultados antes de qualquer nova tentativa de aplicação.
