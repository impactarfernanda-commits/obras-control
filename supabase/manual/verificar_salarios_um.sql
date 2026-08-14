SELECT count(*) AS total_obras_control_salario_um
FROM public.funcionarios
WHERE salario = 1::numeric AND visivel_obras_control IS TRUE;
SELECT f.id, f.nome, f.categoria_mo, f.salario, cs.salario AS salario_categoria,
       cs.encargos AS encargos_categoria
FROM public.funcionarios f
LEFT JOIN public.categoria_salarios cs ON cs.categoria = f.categoria_mo
WHERE f.visivel_obras_control IS TRUE
  AND (f.salario = 1::numeric OR cs.categoria IS NULL OR cs.salario <= 0)
ORDER BY f.nome, f.id;
