SELECT conname, pg_get_constraintdef(oid) AS definicao, convalidated
FROM pg_constraint
WHERE conrelid = 'public.registros_horas'::regclass
  AND conname IN (
    'registros_horas_tipo_registro_check',
    'registros_horas_tipo_conteudo_check'
  )
ORDER BY conname;

SELECT tgrelid::regclass AS tabela, tgname, tgenabled, pg_get_triggerdef(oid, true) AS definicao
FROM pg_trigger
WHERE tgrelid IN ('public.alocacoes'::regclass, 'public.registros_horas'::regclass)
  AND tgname IN ('guard_data_nao_futura', 'trg_obras_normalizar_validar_registro_horas')
  AND NOT tgisinternal
ORDER BY (tgrelid::regclass)::text, tgname;

SELECT p.oid::regprocedure AS funcao,
       p.prosecdef AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       coalesce(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), false)
         AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl ON true
WHERE n.nspname = 'public'
  AND p.proname = 'obras_salvar_ausencia_planejada_periodo'
GROUP BY p.oid;

SELECT tipo_registro, count(*) AS quantidade,
       min(data) AS primeira_data, max(data) AS ultima_data
FROM public.registros_horas
WHERE tipo_registro IN ('ferias', 'folga_campo')
GROUP BY tipo_registro
ORDER BY tipo_registro;

-- Deve retornar zero: ausencia planejada nao depende de alocacao futura.
SELECT count(*) AS ausencias_planejadas_com_alocacao_futura
FROM public.registros_horas r
JOIN public.alocacoes a
  ON a.funcionario_id = r.funcionario_id
 AND a.obra_id = r.obra_id
 AND a.data = r.data
WHERE r.tipo_registro IN ('ferias', 'folga_campo')
  AND r.data > current_date;

SELECT pg_get_functiondef(
  'public.obras_salvar_ausencia_planejada_periodo(uuid,uuid,text,date,date,text)'::regprocedure
) AS definicao_rpc;
