-- Diagnostico somente leitura anterior a migration
-- 20260824105715_exclusao_lancamento_dia_auditada.sql.
-- Todos os comandos deste arquivo sao SELECT.

-- 1. Ambiente PostgreSQL/Supabase.
SELECT
  current_database() AS banco,
  current_user AS usuario_execucao,
  current_setting('server_version') AS versao_postgresql,
  version() AS versao_completa;

-- 2. RPCs que serao substituidas: assinatura, owner, modo de seguranca e ACL atual.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) AS result_type,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_mode,
  p.provolatile AS volatility,
  p.proconfig AS function_config,
  p.proacl AS acl
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('obras_copiar_dia_anterior', 'obras_copiar_jornadas_v2')
ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- 3. Definicao integral atual das RPCs que serao substituidas.
SELECT
  p.oid::regprocedure::text AS assinatura,
  pg_catalog.pg_get_functiondef(p.oid) AS definicao_atual
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('obras_copiar_dia_anterior', 'obras_copiar_jornadas_v2')
ORDER BY p.oid::regprocedure::text;

-- 4. Estrutura e estado de RLS das tabelas envolvidas.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relkind,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
  c.relacl AS acl
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('alocacoes', 'registros_horas', 'alocacoes_dia_exclusoes')
ORDER BY c.relname;

-- 5. Colunas reais de alocacoes e registros_horas usadas pela migration.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  a.attnum AS ordinal_position,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null,
  pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS column_default
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef ad
  ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relname IN ('alocacoes', 'registros_horas')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

-- 6. Constraints atuais relevantes, incluindo FKs, checks e unicidade.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  con.convalidated AS validated,
  pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('alocacoes', 'registros_horas')
ORDER BY c.relname, con.contype, con.conname;

-- 7. Indices atuais, especialmente unicidade funcionario/data.
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('alocacoes', 'registros_horas', 'alocacoes_dia_exclusoes')
ORDER BY tablename, indexname;

-- 8. Policies RLS atuais das tabelas envolvidas.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('alocacoes', 'registros_horas', 'alocacoes_dia_exclusoes')
ORDER BY tablename, cmd, policyname;

-- 9. Triggers nao internos atuais e suas definicoes.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled_mode,
  p.oid::regprocedure::text AS trigger_function,
  pg_catalog.pg_get_triggerdef(t.oid, true) AS trigger_definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND c.relname IN ('alocacoes', 'registros_horas')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- 10. Privilegios efetivos nas tabelas atuais e em eventual objeto homonimo preexistente.
SELECT
  roles.role_name,
  tables.table_name,
  pg_catalog.has_table_privilege(roles.role_name, 'public.' || tables.table_name, 'SELECT') AS can_select,
  pg_catalog.has_table_privilege(roles.role_name, 'public.' || tables.table_name, 'INSERT') AS can_insert,
  pg_catalog.has_table_privilege(roles.role_name, 'public.' || tables.table_name, 'UPDATE') AS can_update,
  pg_catalog.has_table_privilege(roles.role_name, 'public.' || tables.table_name, 'DELETE') AS can_delete,
  pg_catalog.has_table_privilege(roles.role_name, 'public.' || tables.table_name, 'TRUNCATE') AS can_truncate,
  pg_catalog.has_table_privilege(roles.role_name, 'public.' || tables.table_name, 'REFERENCES') AS can_reference,
  pg_catalog.has_table_privilege(roles.role_name, 'public.' || tables.table_name, 'TRIGGER') AS can_trigger
FROM (
  VALUES ('authenticated'), ('anon'), ('PUBLIC'), ('service_role')
) AS roles(role_name)
CROSS JOIN (
  VALUES ('alocacoes'), ('registros_horas')
) AS tables(table_name)
ORDER BY tables.table_name, roles.role_name;

-- 11. ACL bruta das tabelas atuais, incluindo grants herdados ou concedidos a outros roles.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
  pg_catalog.pg_get_userbyid(acl.grantor) AS grantor,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
) acl
WHERE n.nspname = 'public'
  AND c.relname IN ('alocacoes', 'registros_horas', 'alocacoes_dia_exclusoes')
ORDER BY c.relname, grantee, acl.privilege_type;

-- 12. Funcoes auxiliares exigidas pela migration e assinaturas instaladas.
SELECT
  required.expected_signature,
  pg_catalog.to_regprocedure(required.expected_signature) AS installed_signature,
  CASE
    WHEN pg_catalog.to_regprocedure(required.expected_signature) IS NULL THEN 'INCOMPATIVEL_AUSENTE'
    ELSE 'OK'
  END AS status
FROM (
  VALUES
    ('auth.uid()'),
    ('public.get_user_level(uuid)'),
    ('public.has_role(uuid,public.app_role)'),
    ('public.competencia_fechada(date)'),
    ('public.obras_control_funcionarios_por_ids(uuid[])'),
    ('public.obras_control_funcionarios_safe()'),
    ('public.obras_salvar_registro_horas(uuid,uuid,uuid,date,text,text,numeric,numeric,text,text)'),
    ('public.obras_salvar_jornada_v2(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,integer,numeric,numeric,text,text,text,jsonb,text)'),
    ('public.obras_copiar_dia_anterior(uuid,date,date,boolean)'),
    ('public.obras_copiar_jornadas_v2(jsonb)'),
    ('pg_catalog.gen_random_uuid()')
) AS required(expected_signature)
ORDER BY required.expected_signature;

-- 13. Definicao e propriedades das funcoes auxiliares usadas pela nova RPC.
SELECT
  p.oid::regprocedure::text AS assinatura,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_mode,
  p.proconfig AS function_config,
  p.proacl AS acl,
  pg_catalog.pg_get_functiondef(p.oid) AS definicao
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE (n.nspname, p.proname) IN (
  ('public', 'get_user_level'),
  ('public', 'has_role'),
  ('public', 'competencia_fechada'),
  ('public', 'obras_control_funcionarios_por_ids'),
  ('public', 'obras_control_funcionarios_safe'),
  ('public', 'obras_salvar_registro_horas'),
  ('public', 'obras_salvar_jornada_v2')
)
ORDER BY p.oid::regprocedure::text;

-- 14. Privilegios efetivos das funcoes atuais para os quatro principals solicitados.
SELECT
  roles.role_name,
  functions.expected_signature,
  pg_catalog.to_regprocedure(functions.expected_signature) AS installed_signature,
  pg_catalog.has_function_privilege(
    roles.role_name,
    pg_catalog.to_regprocedure(functions.expected_signature),
    'EXECUTE'
  ) AS can_execute
FROM (
  VALUES ('authenticated'), ('anon'), ('PUBLIC'), ('service_role')
) AS roles(role_name)
CROSS JOIN (
  VALUES
    ('public.obras_copiar_dia_anterior(uuid,date,date,boolean)'),
    ('public.obras_copiar_jornadas_v2(jsonb)'),
    ('public.obras_salvar_jornada_v2(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,integer,numeric,numeric,text,text,text,jsonb,text)'),
    ('public.obras_salvar_registro_horas(uuid,uuid,uuid,date,text,text,numeric,numeric,text,text)'),
    ('public.competencia_fechada(date)'),
    ('public.get_user_level(uuid)'),
    ('public.has_role(uuid,public.app_role)')
) AS functions(expected_signature)
ORDER BY functions.expected_signature, roles.role_name;

-- 15. ACL bruta das funcoes atuais, para detectar grants adicionais preservados por CREATE OR REPLACE.
SELECT
  p.oid::regprocedure::text AS assinatura,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
  pg_catalog.pg_get_userbyid(acl.grantor) AS grantor,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
) acl
WHERE n.nspname = 'public'
  AND p.proname IN (
    'obras_copiar_dia_anterior',
    'obras_copiar_jornadas_v2',
    'obras_salvar_jornada_v2',
    'obras_salvar_registro_horas',
    'competencia_fechada',
    'get_user_level',
    'has_role'
  )
ORDER BY p.oid::regprocedure::text, grantee;

-- 16. Objetos que colidiriam com nomes criados pela migration.
SELECT
  'relation' AS object_kind,
  n.nspname AS schema_name,
  c.relname AS object_name,
  c.relkind::text AS object_detail
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'alocacoes_dia_exclusoes',
    'alocacoes_dia_exclusoes_obra_data_idx',
    'alocacoes_dia_exclusoes_supressao_ativa_uidx'
  )
UNION ALL
SELECT
  'function' AS object_kind,
  n.nspname AS schema_name,
  p.proname AS object_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS object_detail
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'obras_excluir_lancamento_dia',
    'limpar_supressao_alocacao_recriada'
  )
UNION ALL
SELECT
  'trigger' AS object_kind,
  n.nspname AS schema_name,
  t.tgname AS object_name,
  c.relname AS object_detail
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND t.tgname = 'trg_limpar_supressao_alocacao_recriada'
ORDER BY object_kind, object_name;

-- 17. Quantidades atuais, apenas para referencia de integridade.
SELECT
  (SELECT count(*) FROM public.alocacoes) AS total_alocacoes,
  (SELECT count(*) FROM public.registros_horas) AS total_registros_horas,
  (SELECT count(*) FROM public.alocacoes WHERE created_by IS NULL) AS alocacoes_sem_autor,
  (SELECT count(*) FROM public.registros_horas WHERE created_by IS NULL) AS registros_sem_autor;

-- 18. Integridade da chave canonica funcionario/data e do pareamento alocacao/registro.
SELECT
  (SELECT count(*) FROM (
    SELECT funcionario_id, data
    FROM public.alocacoes
    GROUP BY funcionario_id, data
    HAVING count(*) > 1
  ) duplicadas) AS duplicidades_alocacao_funcionario_data,
  (SELECT count(*) FROM public.alocacoes a
    WHERE NOT EXISTS (
      SELECT 1 FROM public.registros_horas r
      WHERE r.funcionario_id = a.funcionario_id
        AND r.obra_id = a.obra_id
        AND r.data = a.data
    )
  ) AS alocacoes_sem_registro_correspondente,
  (SELECT count(*) FROM public.registros_horas r
    WHERE NOT EXISTS (
      SELECT 1 FROM public.alocacoes a
      WHERE a.funcionario_id = r.funcionario_id
        AND a.obra_id = r.obra_id
        AND a.data = r.data
    )
  ) AS registros_sem_alocacao_correspondente;

-- 19. Competencias fechadas e confirmacao dos triggers de protecao no banco.
SELECT
  (SELECT count(*) FROM public.fechamentos_competencia WHERE fechada = true) AS competencias_fechadas,
  (SELECT count(*)
   FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.alocacoes'::regclass
     AND t.tgname = 'trg_guard_competencia_fechada_alocacoes'
     AND t.tgenabled <> 'D') AS guard_ativo_alocacoes,
  (SELECT count(*)
   FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.registros_horas'::regclass
     AND t.tgname = 'trg_guard_competencia_fechada_registros_horas'
     AND t.tgenabled <> 'D') AS guard_ativo_registros_horas;

-- 20. Premissas estruturais consolidadas. Qualquer status diferente de OK exige revisao.
SELECT
  checks.check_name,
  CASE WHEN checks.ok THEN 'OK' ELSE 'INCOMPATIVEL_REVISAR' END AS status,
  checks.detail
FROM (
  SELECT
    'tabela_alocacoes_existe' AS check_name,
    pg_catalog.to_regclass('public.alocacoes') IS NOT NULL AS ok,
    pg_catalog.to_regclass('public.alocacoes')::text AS detail
  UNION ALL
  SELECT
    'tabela_registros_horas_existe',
    pg_catalog.to_regclass('public.registros_horas') IS NOT NULL,
    pg_catalog.to_regclass('public.registros_horas')::text
  UNION ALL
  SELECT
    'tabela_auditoria_ainda_nao_existe',
    pg_catalog.to_regclass('public.alocacoes_dia_exclusoes') IS NULL,
    COALESCE(pg_catalog.to_regclass('public.alocacoes_dia_exclusoes')::text, 'ausente_como_esperado')
  UNION ALL
  SELECT
    'rpc_previa_assinatura_exata',
    pg_catalog.to_regprocedure('public.obras_copiar_dia_anterior(uuid,date,date,boolean)') IS NOT NULL,
    COALESCE(pg_catalog.to_regprocedure('public.obras_copiar_dia_anterior(uuid,date,date,boolean)')::text, 'ausente')
  UNION ALL
  SELECT
    'rpc_copia_definitiva_assinatura_exata',
    pg_catalog.to_regprocedure('public.obras_copiar_jornadas_v2(jsonb)') IS NOT NULL,
    COALESCE(pg_catalog.to_regprocedure('public.obras_copiar_jornadas_v2(jsonb)')::text, 'ausente')
  UNION ALL
  SELECT
    'rpc_salvar_jornada_assinatura_exata',
    pg_catalog.to_regprocedure('public.obras_salvar_jornada_v2(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,integer,numeric,numeric,text,text,text,jsonb,text)') IS NOT NULL,
    COALESCE(pg_catalog.to_regprocedure('public.obras_salvar_jornada_v2(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,integer,numeric,numeric,text,text,text,jsonb,text)')::text, 'ausente')
  UNION ALL
  SELECT
    'funcao_competencia_fechada_existe',
    pg_catalog.to_regprocedure('public.competencia_fechada(date)') IS NOT NULL,
    COALESCE(pg_catalog.to_regprocedure('public.competencia_fechada(date)')::text, 'ausente')
  UNION ALL
  SELECT
    'funcao_nivel_usuario_existe',
    pg_catalog.to_regprocedure('public.get_user_level(uuid)') IS NOT NULL,
    COALESCE(pg_catalog.to_regprocedure('public.get_user_level(uuid)')::text, 'ausente')
  UNION ALL
  SELECT
    'funcao_role_usuario_existe',
    pg_catalog.to_regprocedure('public.has_role(uuid,public.app_role)') IS NOT NULL,
    COALESCE(pg_catalog.to_regprocedure('public.has_role(uuid,public.app_role)')::text, 'ausente')
  UNION ALL
  SELECT
    'rls_alocacoes_ativo',
    COALESCE((SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.alocacoes'::regclass), false),
    COALESCE((SELECT c.relrowsecurity::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.alocacoes'::regclass), 'false')
  UNION ALL
  SELECT
    'rls_registros_horas_ativo',
    COALESCE((SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.registros_horas'::regclass), false),
    COALESCE((SELECT c.relrowsecurity::text FROM pg_catalog.pg_class c WHERE c.oid = 'public.registros_horas'::regclass), 'false')
  UNION ALL
  SELECT
    'constraint_unica_alocacao_funcionario_data',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint con
      WHERE con.conrelid = 'public.alocacoes'::regclass
        AND con.conname = 'alocacoes_funcionario_data_unique'
        AND con.contype = 'u'
        AND con.convalidated
    ),
    COALESCE((
      SELECT pg_catalog.pg_get_constraintdef(con.oid, true)
      FROM pg_catalog.pg_constraint con
      WHERE con.conrelid = 'public.alocacoes'::regclass
        AND con.conname = 'alocacoes_funcionario_data_unique'
    ), 'ausente')
  UNION ALL
  SELECT
    'guard_competencia_alocacoes_ativo',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.alocacoes'::regclass
        AND t.tgname = 'trg_guard_competencia_fechada_alocacoes'
        AND t.tgenabled <> 'D'
    ),
    COALESCE((
      SELECT pg_catalog.pg_get_triggerdef(t.oid, true)
      FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.alocacoes'::regclass
        AND t.tgname = 'trg_guard_competencia_fechada_alocacoes'
    ), 'ausente')
  UNION ALL
  SELECT
    'guard_competencia_registros_ativo',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.registros_horas'::regclass
        AND t.tgname = 'trg_guard_competencia_fechada_registros_horas'
        AND t.tgenabled <> 'D'
    ),
    COALESCE((
      SELECT pg_catalog.pg_get_triggerdef(t.oid, true)
      FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.registros_horas'::regclass
        AND t.tgname = 'trg_guard_competencia_fechada_registros_horas'
    ), 'ausente')
  UNION ALL
  SELECT
    'colunas_alocacoes_requeridas',
    (SELECT count(*) = 9
     FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.alocacoes'::regclass
       AND a.attname IN (
         'id', 'funcionario_id', 'obra_id', 'data', 'created_by',
         'hora_entrada', 'hora_saida', 'intervalo_padrao_minutos', 'especialidade_ajudante'
       )
       AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT count(*)::text
     FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.alocacoes'::regclass
       AND a.attname IN (
         'id', 'funcionario_id', 'obra_id', 'data', 'created_by',
         'hora_entrada', 'hora_saida', 'intervalo_padrao_minutos', 'especialidade_ajudante'
       )
       AND a.attnum > 0 AND NOT a.attisdropped) || '/9 colunas'
  UNION ALL
  SELECT
    'colunas_registros_requeridas',
    (SELECT count(*) = 13
     FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.registros_horas'::regclass
       AND a.attname IN (
         'id', 'funcionario_id', 'obra_id', 'data', 'horas_normais', 'horas_extras',
         'justificativa_extras', 'ausencia', 'motivo_ausencia', 'observacoes',
         'tipo_registro', 'falta_tipo', 'created_by'
       )
       AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT count(*)::text
     FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.registros_horas'::regclass
       AND a.attname IN (
         'id', 'funcionario_id', 'obra_id', 'data', 'horas_normais', 'horas_extras',
         'justificativa_extras', 'ausencia', 'motivo_ausencia', 'observacoes',
         'tipo_registro', 'falta_tipo', 'created_by'
       )
       AND a.attnum > 0 AND NOT a.attisdropped) || '/13 colunas'
) AS checks
ORDER BY checks.check_name;
