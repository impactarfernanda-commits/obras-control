BEGIN;

CREATE TEMP TABLE salarios_um_avaliacao ON COMMIT DROP AS
SELECT f.id, f.nome, f.categoria_mo, f.salario AS salario_anterior,
       f.encargos AS encargos_anterior, count(cs.categoria) AS correspondencias,
       min(cs.salario) AS salario_esperado, min(cs.encargos) AS encargos_esperados
FROM public.funcionarios f
LEFT JOIN public.categoria_salarios cs ON cs.categoria = f.categoria_mo
WHERE f.salario = 1::numeric AND f.visivel_obras_control IS TRUE
GROUP BY f.id, f.nome, f.categoria_mo, f.salario, f.encargos;

CREATE TEMP TABLE salarios_um_corrigidos ON COMMIT DROP AS
SELECT * FROM public.obras_corrigir_salarios_placeholder();

SELECT id, nome, categoria_mo, salario_anterior, salario_novo,
       encargos_anterior, encargos_novo
FROM salarios_um_corrigidos
ORDER BY nome, id;

SELECT a.id, a.nome, a.categoria_mo, a.salario_anterior, a.salario_esperado,
       CASE
         WHEN a.correspondencias = 0 OR a.salario_esperado IS NULL OR a.salario_esperado <= 0
           THEN 'SEM_CORRESPONDENCIA'
         ELSE 'AMBIGUO'
       END AS situacao
FROM salarios_um_avaliacao a
LEFT JOIN salarios_um_corrigidos c USING (id)
WHERE c.id IS NULL
ORDER BY situacao, a.nome, a.id;

COMMIT;
