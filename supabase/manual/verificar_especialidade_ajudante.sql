-- NAO executar automaticamente. Auditoria somente leitura.
SELECT c.nome, c.tipo
FROM public.categorias c
ORDER BY c.tipo, c.nome;

-- Confirma os nomes reais de operador existentes sem criar aliases/categorias.
SELECT c.nome, c.tipo,
  CASE
    WHEN upper(btrim(c.nome)) IN (
      'OPERADOR DE RETRO',
      'OPERADOR DE RETROESCAVADEIRA',
      'OPERADOR ESCAVADEIRA',
      'OPERADOR DE ESCAVADEIRA'
    )
      THEN 'MOD Civil'
    ELSE 'revisar variante real antes de mapear'
  END AS classificacao_relatorio
FROM public.categorias c
WHERE upper(c.nome) LIKE '%OPERADOR%'
   OR upper(c.nome) LIKE '%RETRO%'
ORDER BY c.nome;

SELECT
  CASE
    WHEN date_trunc('month', a.data)::date
         + CASE WHEN extract(day FROM a.data) >= 25 THEN interval '1 month' ELSE interval '0 month' END
         < DATE '2026-08-01'
      THEN 'historico ate julho/2026'
    ELSE 'segmentado desde agosto/2026'
  END AS periodo_regra,
  f.categoria_mo, a.especialidade_ajudante, count(*) AS alocacoes
FROM public.alocacoes a
JOIN public.funcionarios f ON f.id = a.funcionario_id
GROUP BY periodo_regra, f.categoria_mo, a.especialidade_ajudante
ORDER BY periodo_regra, f.categoria_mo, a.especialidade_ajudante;

SELECT a.id, a.data, a.funcionario_id, f.nome, f.categoria_mo, a.obra_id
FROM public.alocacoes a
JOIN public.funcionarios f ON f.id = a.funcionario_id
WHERE upper(btrim(f.categoria_mo)) = 'AJUDANTE'
  AND a.especialidade_ajudante IS NULL
  AND date_trunc('month', a.data)::date
      + CASE WHEN extract(day FROM a.data) >= 25 THEN interval '1 month' ELSE interval '0 month' END
      >= DATE '2026-08-01'
ORDER BY a.data, f.nome;

SELECT a.id, a.data, f.nome, f.categoria_mo, a.especialidade_ajudante
FROM public.alocacoes a
JOIN public.funcionarios f ON f.id = a.funcionario_id
WHERE upper(btrim(f.categoria_mo)) <> 'AJUDANTE'
  AND a.especialidade_ajudante IS NOT NULL
ORDER BY a.data, f.nome;
