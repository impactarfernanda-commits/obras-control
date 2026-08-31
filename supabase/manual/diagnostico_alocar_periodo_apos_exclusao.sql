-- Somente leitura. Substitua os tres valores em parametros pelo funcionario e periodo do teste.
WITH parametros AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS funcionario_id,
    DATE '2026-08-01' AS data_inicio,
    DATE '2026-08-31' AS data_fim
), datas AS (
  SELECT generate_series(p.data_inicio, p.data_fim, interval '1 day')::date AS data
  FROM parametros p
)
SELECT
  d.data,
  a.id AS alocacao_id,
  r.id AS registro_horas_id,
  r.tipo_registro,
  r.horas_normais,
  r.horas_extras,
  e.id AS exclusao_id,
  e.ativa_para_copia,
  e.excluido_em,
  e.neutralizada_em,
  CASE
    WHEN a.id IS NOT NULL THEN 'alocacao_real'
    WHEN r.id IS NOT NULL THEN 'registro_horas_orfao'
    WHEN e.ativa_para_copia THEN 'somente_supressao_ativa'
    WHEN e.id IS NOT NULL THEN 'somente_historico_neutralizado'
    ELSE 'livre'
  END AS diagnostico
FROM datas d
CROSS JOIN parametros p
LEFT JOIN public.alocacoes a
  ON a.funcionario_id = p.funcionario_id AND a.data = d.data
LEFT JOIN public.registros_horas r
  ON r.funcionario_id = p.funcionario_id AND r.data = d.data
LEFT JOIN public.alocacoes_dia_exclusoes e
  ON e.funcionario_id = p.funcionario_id AND e.data = d.data
ORDER BY d.data, a.id, r.id, e.excluido_em;
