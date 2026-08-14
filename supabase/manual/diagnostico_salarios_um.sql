WITH correspondencias AS (
  SELECT f.id, f.nome, f.categoria_mo, f.salario AS salario_atual,
         count(cs.categoria) AS quantidade_correspondencias,
         min(cs.salario) AS salario_esperado
  FROM public.funcionarios f
  LEFT JOIN public.categoria_salarios cs ON cs.categoria = f.categoria_mo
  WHERE f.salario = 1::numeric
    AND f.visivel_obras_control IS TRUE
  GROUP BY f.id, f.nome, f.categoria_mo, f.salario
)
SELECT id, nome, categoria_mo, salario_atual, salario_esperado,
       CASE
         WHEN quantidade_correspondencias = 0 OR salario_esperado IS NULL OR salario_esperado <= 0
           THEN 'SEM_CORRESPONDENCIA'
         WHEN quantidade_correspondencias = 1 THEN 'CORRIGIVEL'
         ELSE 'AMBIGUO'
       END AS situacao
FROM correspondencias
ORDER BY situacao, nome, id;

WITH correspondencias AS (
  SELECT f.id, count(cs.categoria) AS quantidade_correspondencias,
         min(cs.salario) AS salario_esperado
  FROM public.funcionarios f
  LEFT JOIN public.categoria_salarios cs ON cs.categoria = f.categoria_mo
  WHERE f.salario = 1::numeric AND f.visivel_obras_control IS TRUE
  GROUP BY f.id
), classificacao AS (
  SELECT CASE
    WHEN quantidade_correspondencias = 0 OR salario_esperado IS NULL OR salario_esperado <= 0
      THEN 'SEM_CORRESPONDENCIA'
    WHEN quantidade_correspondencias = 1 THEN 'CORRIGIVEL'
    ELSE 'AMBIGUO' END AS situacao
  FROM correspondencias
)
SELECT count(*) AS total_obras_control_salario_1,
       count(*) FILTER (WHERE situacao = 'CORRIGIVEL') AS corrigiveis,
       count(*) FILTER (WHERE situacao = 'SEM_CORRESPONDENCIA') AS sem_correspondencia,
       count(*) FILTER (WHERE situacao = 'AMBIGUO') AS ambiguos,
       (SELECT count(*) FROM public.funcionarios
         WHERE salario = 1::numeric AND visivel_obras_control IS NOT TRUE)
         AS ignorados_fora_obras_control
FROM classificacao;
