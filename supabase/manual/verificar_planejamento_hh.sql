SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name LIKE 'planejamento_hh_%' ORDER BY table_name;
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND tablename LIKE 'planejamento_hh_%' ORDER BY indexname;
SELECT tablename, policyname, roles, cmd FROM pg_policies
 WHERE schemaname = 'public' AND tablename LIKE 'planejamento_hh_%' ORDER BY tablename, policyname;
SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name LIKE 'planejamento_hh_%' ORDER BY table_name, grantee, privilege_type;
SELECT obra_id, count(*) FILTER (WHERE ativa) AS ativas
 FROM public.planejamento_hh_baselines GROUP BY obra_id HAVING count(*) FILTER (WHERE ativa) > 1;
SELECT count(*) AS itens_invalidos FROM public.planejamento_hh_baseline_itens
 WHERE hh_previsto < 0 OR custo_previsto < 0;

SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'funcionario_custos_vigencias'
 ORDER BY ordinal_position;
SELECT conname, pg_get_constraintdef(oid) AS definicao
  FROM pg_constraint
 WHERE conrelid = 'public.funcionario_custos_vigencias'::regclass
 ORDER BY conname;
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'funcionario_custos_vigencias';
SELECT proname, prosecdef, proacl
  FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace
 WHERE n.nspname = 'public' AND proname LIKE '%custo%vigencia%';
SELECT event_object_table, trigger_name, action_timing, event_manipulation
  FROM information_schema.triggers
 WHERE trigger_name LIKE 'snapshot_custo_%'
 ORDER BY event_object_table, trigger_name;
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'funcionario_custos_vigencias'
 ORDER BY grantee, privilege_type;
SELECT tablename, rowsecurity FROM pg_tables
 WHERE schemaname = 'public' AND tablename = 'funcionario_custos_vigencias';
SELECT funcionario_id, count(*) AS sobreposicoes
  FROM public.funcionario_custos_vigencias a
 WHERE EXISTS (
   SELECT 1 FROM public.funcionario_custos_vigencias b
    WHERE b.funcionario_id = a.funcionario_id AND b.id <> a.id
      AND daterange(a.vigencia_inicio, COALESCE(a.vigencia_fim, 'infinity'::date), '[]')
       && daterange(b.vigencia_inicio, COALESCE(b.vigencia_fim, 'infinity'::date), '[]')
 ) GROUP BY funcionario_id;
SELECT status_historico, count(*) FROM public.funcionario_custos_vigencias
 GROUP BY status_historico ORDER BY status_historico;
