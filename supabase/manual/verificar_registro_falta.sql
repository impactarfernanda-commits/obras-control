-- Verificacao somente leitura da implantacao de falta integral no Obras Control.
-- Cada consulta pode ser executada isoladamente no SQL Editor web do Supabase.

-- 1. Colunas
SELECT
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns AS c
WHERE c.table_schema = 'public'
  AND c.table_name = 'registros_horas'
  AND c.column_name IN ('tipo_registro', 'falta_tipo')
ORDER BY c.ordinal_position;

-- 2. Constraints
SELECT
  con.conname AS nome,
  CASE con.contype
    WHEN 'c' THEN 'CHECK'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'x' THEN 'EXCLUSION'
    ELSE con.contype::text
  END AS tipo,
  pg_get_constraintdef(con.oid, true) AS definicao,
  con.convalidated
FROM pg_constraint AS con
WHERE con.conrelid = 'public.registros_horas'::regclass
ORDER BY con.conname;

-- 3. Triggers
-- Lista todos os triggers nao internos, evitando falso negativo por filtro de nome.
SELECT
  tg.tgname AS nome,
  pg_get_triggerdef(tg.oid, true) AS definicao,
  pn.nspname || '.' || proc.proname AS funcao_chamada,
  CASE tg.tgenabled
    WHEN 'O' THEN 'habilitado'
    WHEN 'D' THEN 'desabilitado'
    WHEN 'R' THEN 'replica'
    WHEN 'A' THEN 'sempre'
    ELSE tg.tgenabled::text
  END AS status_habilitado
FROM pg_trigger AS tg
JOIN pg_proc AS proc ON proc.oid = tg.tgfoid
JOIN pg_namespace AS pn ON pn.oid = proc.pronamespace
WHERE tg.tgrelid = 'public.registros_horas'::regclass
  AND NOT tg.tgisinternal
ORDER BY tg.tgname;

-- 4. Funcoes/RPC
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  pg_get_function_result(p.oid) AS tipo_retorno,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS seguranca,
  array_to_string(p.proconfig, ', ') AS configuracao,
  pg_get_functiondef(p.oid) AS definicao
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname = 'obras_salvar_registro_horas'
    OR p.proname = 'obras_normalizar_validar_registro_horas'
    OR p.proname = 'obras_validar_conflito_apontamento_diario'
    OR p.proname ILIKE '%registro%falta%'
    OR p.proname ILIKE '%conflito%apontamento%'
  )
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- RPC principal: mostra todas as overloads sem presumir assinatura.
SELECT
  n.nspname AS schema_name,
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  pg_get_function_result(p.oid) AS tipo_retorno,
  CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS seguranca,
  array_to_string(p.proconfig, ', ') AS configuracao,
  pg_get_functiondef(p.oid) AS definicao
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'obras_salvar_registro_horas'
ORDER BY pg_get_function_identity_arguments(p.oid);

-- 5. Grants
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS argumentos,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_executa,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_executa
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'obras_salvar_registro_horas',
    'obras_normalizar_validar_registro_horas',
    'obras_validar_conflito_apontamento_diario'
  )
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- 6. Indices
SELECT
  i.indexname,
  i.indexdef,
  i.indexdef ILIKE '%funcionario_id%' AS relacionado_funcionario,
  i.indexdef ILIKE '%data%' AS relacionado_data,
  i.indexdef ILIKE '%tipo_registro%' AS relacionado_tipo_registro
FROM pg_indexes AS i
WHERE i.schemaname = 'public'
  AND i.tablename = 'registros_horas'
ORDER BY i.indexname;

-- 7. Distribuicao dos registros
SELECT
  r.tipo_registro,
  r.falta_tipo,
  count(*) AS quantidade
FROM public.registros_horas AS r
GROUP BY r.tipo_registro, r.falta_tipo
ORDER BY r.tipo_registro, r.falta_tipo NULLS FIRST;

-- 8. Faltas com horas positivas
-- Resultado esperado: zero.
SELECT count(*) AS faltas_com_horas_positivas
FROM public.registros_horas AS r
WHERE r.tipo_registro = 'falta'
  AND coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) > 0;

-- Detalhes para diagnostico, sem expor nomes ou observacoes.
SELECT
  r.id,
  r.funcionario_id,
  r.data,
  r.horas_normais,
  r.horas_extras
FROM public.registros_horas AS r
WHERE r.tipo_registro = 'falta'
  AND coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) > 0
ORDER BY r.data, r.funcionario_id;

-- 9. Horas zero
-- A tabela possui created_at, mas nao ha no schema uma data confiavel da implantacao.
-- Por isso a consulta nao classifica artificialmente registros como anteriores/posteriores.
SELECT
  count(*) AS total_horas_zero,
  min(r.created_at) AS primeiro_created_at,
  max(r.created_at) AS ultimo_created_at
FROM public.registros_horas AS r
WHERE r.tipo_registro = 'horas'
  AND coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) = 0;

-- 10. Conflitos por funcionario/data
-- Cancelamento no modelo atual e exclusao fisica; somente registros presentes sao considerados.
-- Resultado esperado: zero linhas.
SELECT
  r.funcionario_id,
  r.data,
  count(*) FILTER (WHERE r.tipo_registro = 'falta') AS faltas,
  count(*) FILTER (
    WHERE r.tipo_registro = 'horas'
      AND coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) > 0
  ) AS apontamentos_horas_positivas
FROM public.registros_horas AS r
GROUP BY r.funcionario_id, r.data
HAVING count(*) FILTER (WHERE r.tipo_registro = 'falta') > 0
   AND count(*) FILTER (
     WHERE r.tipo_registro = 'horas'
       AND coalesce(r.horas_normais, 0) + coalesce(r.horas_extras, 0) > 0
   ) > 0
ORDER BY r.data, r.funcionario_id;

-- Duas ou mais faltas para o mesmo funcionario/data. Resultado esperado: zero linhas.
SELECT
  r.funcionario_id,
  r.data,
  count(*) AS quantidade_faltas
FROM public.registros_horas AS r
WHERE r.tipo_registro = 'falta'
GROUP BY r.funcionario_id, r.data
HAVING count(*) > 1
ORDER BY r.data, r.funcionario_id;

-- 11. Classificacoes
SELECT
  r.falta_tipo,
  count(*) AS quantidade
FROM public.registros_horas AS r
WHERE r.tipo_registro = 'falta'
GROUP BY r.falta_tipo
ORDER BY r.falta_tipo NULLS FIRST;

-- Evidencia estrutural dos valores permitidos, sem inserir fixtures.
SELECT
  con.conname AS origem,
  pg_get_constraintdef(con.oid, true) AS definicao
FROM pg_constraint AS con
WHERE con.conrelid = 'public.registros_horas'::regclass
  AND pg_get_constraintdef(con.oid, true) ~
    '(nao_justificada|justificada|atestado|suspensao|afastamento|outro)'
UNION ALL
SELECT
  p.proname AS origem,
  pg_get_functiondef(p.oid) AS definicao
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'obras_normalizar_validar_registro_horas'
ORDER BY origem;

-- A ausencia de alteracoes no RO Passagens e validada estruturalmente pelo teste
-- automatizado da migration. Este script nao consulta tabelas nem dados desse sistema.
