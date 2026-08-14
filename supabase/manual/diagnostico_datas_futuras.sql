SELECT 'alocacoes'::text AS tabela, id, funcionario_id, obra_id, data
FROM public.alocacoes WHERE data > current_date
UNION ALL
SELECT 'registros_horas'::text, id, funcionario_id, obra_id, data
FROM public.registros_horas WHERE data > current_date
ORDER BY tabela, data, id;
