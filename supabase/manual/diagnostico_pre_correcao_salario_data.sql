SELECT current_date AS data_atual_banco, current_setting('TimeZone') AS timezone_banco;
SELECT 'funcionarios_salario_um' AS verificacao, count(*) AS quantidade
FROM public.funcionarios WHERE salario = 1::numeric AND visivel_obras_control IS TRUE
UNION ALL
SELECT 'alocacoes_futuras', count(*) FROM public.alocacoes WHERE data > current_date
UNION ALL
SELECT 'registros_horas_futuros', count(*) FROM public.registros_horas WHERE data > current_date;
