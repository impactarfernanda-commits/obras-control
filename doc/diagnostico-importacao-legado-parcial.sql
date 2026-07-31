-- SOMENTE LEITURA. Execute manualmente no Supabase SQL Editor.
-- Ajuste inicio_tentativa e fim_tentativa para a janela exata mostrada no navegador/log.
-- Nenhuma instrução abaixo altera dados.

with parametros as (
  select
    'fernanda.souza@tanksbr.com.br'::text as email,
    '2026-07-31 00:00:00-03'::timestamptz as inicio_tentativa,
    '2026-08-01 00:00:00-03'::timestamptz as fim_tentativa
), usuario as (
  select u.id
  from auth.users u, parametros p
  where lower(u.email) = lower(p.email)
), alocacoes_tentativa as (
  select
    a.id,
    a.created_at,
    a.created_by,
    a.funcionario_id,
    f.nome as funcionario,
    a.data,
    a.obra_id,
    o.nome as centro_custo
  from public.alocacoes a
  join public.funcionarios f on f.id = a.funcionario_id
  join public.obras o on o.id = a.obra_id
  join usuario u on u.id = a.created_by
  cross join parametros p
  where a.created_at >= p.inicio_tentativa
    and a.created_at < p.fim_tentativa
)
select
  count(*) as quantidade_potencialmente_inserida,
  min(created_at) as primeiro_horario,
  max(created_at) as ultimo_horario
from alocacoes_tentativa;

-- Detalhamento das alocações potencialmente inseridas na tentativa.
with parametros as (
  select
  'fernanda.souza@tanksbr.com.br'::text as email,
  '2026-07-31 16:00:00-03'::timestamptz as inicio_tentativa,
  '2026-07-31 16:20:00-03'::timestamptz as fim_tentativa
)
select
  a.id,
  a.created_at,
  f.nome as funcionario,
  a.data,
  o.nome as centro_custo,
  a.obra_id
from public.alocacoes a
join auth.users u on u.id = a.created_by
join public.funcionarios f on f.id = a.funcionario_id
join public.obras o on o.id = a.obra_id
cross join parametros p
where lower(u.email) = lower(p.email)
  and a.created_at >= p.inicio_tentativa
  and a.created_at < p.fim_tentativa
order by a.created_at, f.nome, a.data;

-- Verifica alocações sem o registro de horas correspondente, possível sinal de falha parcial
-- entre os dois inserts do fluxo frontend.
with parametros as (
  select
    'fernanda.souza@tanksbr.com.br'::text as email,
    '2026-07-31 00:00:00-03'::timestamptz as inicio_tentativa,
    '2026-08-01 00:00:00-03'::timestamptz as fim_tentativa
)
select
  a.id as alocacao_id,
  a.created_at,
  f.nome as funcionario,
  a.data,
  o.nome as centro_custo
from public.alocacoes a
join auth.users u on u.id = a.created_by
join public.funcionarios f on f.id = a.funcionario_id
join public.obras o on o.id = a.obra_id
left join public.registros_horas r
  on r.funcionario_id = a.funcionario_id
 and r.obra_id = a.obra_id
 and r.data = a.data
cross join parametros p
where lower(u.email) = lower(p.email)
  and a.created_at >= p.inicio_tentativa
  and a.created_at < p.fim_tentativa
  and r.id is null
order by a.created_at, f.nome, a.data;
