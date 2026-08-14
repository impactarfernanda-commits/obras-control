SELECT conname, pg_get_constraintdef(oid) AS definicao, convalidated
FROM pg_constraint
WHERE conrelid = 'public.registros_horas'::regclass
  AND conname IN (
    'registros_horas_tipo_registro_check',
    'registros_horas_tipo_conteudo_check'
  )
ORDER BY conname;

SELECT tgrelid::regclass AS tabela, tgname, pg_get_triggerdef(oid, true) AS definicao
FROM pg_trigger
WHERE tgrelid IN ('public.alocacoes'::regclass, 'public.registros_horas'::regclass)
  AND tgname IN ('guard_data_nao_futura', 'trg_obras_normalizar_validar_registro_horas')
  AND NOT tgisinternal
ORDER BY (tgrelid::regclass)::text, tgname;

SELECT
  to_regprocedure(
    'public.obras_salvar_ausencia_planejada_periodo(uuid,uuid,text,date,date,text)'
  ) AS rpc_periodo_antes,
  count(*) FILTER (WHERE tipo_registro = 'ferias') AS ferias_existentes,
  count(*) FILTER (WHERE tipo_registro = 'folga_campo') AS folgas_existentes
FROM public.registros_horas;
