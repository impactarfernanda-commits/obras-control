SELECT current_database() AS banco, current_user AS usuario, now() AS verificado_em;
SELECT to_regclass('public.obras') AS obras,
       to_regclass('public.funcionarios') AS funcionarios,
       to_regclass('public.alocacoes') AS alocacoes,
       to_regclass('public.registros_horas') AS registros_horas,
       to_regprocedure('public.can_view_salario(uuid)') AS regra_financeira;
SELECT role, count(*) FROM public.user_roles GROUP BY role ORDER BY role;
SELECT tipo_registro, falta_tipo, count(*)
  FROM public.registros_horas GROUP BY tipo_registro, falta_tipo ORDER BY 1, 2;
SELECT tablename, rowsecurity FROM pg_tables
 WHERE schemaname = 'public' AND tablename IN ('obras','funcionarios','alocacoes','registros_horas');
