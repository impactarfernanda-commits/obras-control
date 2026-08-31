-- PREVIA SOMENTE LEITURA. Nao insere nem altera vigencias.
-- Executar somente depois da migration, para revisao manual da carga inicial de 25/08/2026.
WITH supervisores AS (
  SELECT f.id, f.nome, f.categoria_mo, f.data_admissao, f.data_desligamento
  FROM public.funcionarios f
  WHERE f.ativo
    AND f.deleted_at IS NULL
    AND f.visivel_obras_control IS NOT FALSE
    AND public.obras_control_categoria_supervisor(f.categoria_mo)
), ultimo_cc AS (
  SELECT DISTINCT ON (a.funcionario_id)
    a.funcionario_id, a.obra_id, a.data AS ultima_alocacao
  FROM public.alocacoes a
  JOIN supervisores s ON s.id = a.funcionario_id
  WHERE a.data < DATE '2026-08-25'
  ORDER BY a.funcionario_id, a.data DESC, a.created_at DESC, a.id DESC
), regime AS (
  SELECT DISTINCT ON (r.funcionario_id)
    r.funcionario_id, r.regime, r.vigencia_inicio
  FROM public.funcionario_regime_vigencias r
  JOIN supervisores s ON s.id = r.funcionario_id
  WHERE DATE '2026-08-25' BETWEEN r.vigencia_inicio AND COALESCE(r.vigencia_fim, 'infinity'::date)
  ORDER BY r.funcionario_id, r.vigencia_inicio DESC
)
SELECT
  s.id AS funcionario_id,
  s.nome,
  s.categoria_mo AS categoria,
  r.regime AS regime_atual,
  u.obra_id AS ultimo_cc_id,
  o.nome AS ultimo_cc_nome,
  u.ultima_alocacao,
  u.obra_id AS cc_inferido_para_2026_08_25,
  CASE WHEN u.obra_id IS NULL THEN NULL ELSE 'ultima_alocacao_anterior_ao_corte' END AS origem_inferencia,
  concat_ws('; ',
    CASE WHEN r.regime IS NULL THEN 'regime nao informado' END,
    CASE WHEN r.regime IS NOT NULL AND r.regime <> 'alojado' THEN 'Supervisor nao alojado: revisar' END,
    CASE WHEN u.obra_id IS NULL THEN 'sem CC historico para inferencia' END,
    CASE WHEN s.data_admissao > DATE '2026-08-25' THEN 'admissao posterior ao corte' END,
    CASE WHEN s.data_desligamento IS NOT NULL AND s.data_desligamento < DATE '2026-08-25' THEN 'desligado antes do corte' END
  ) AS divergencias_alertas
FROM supervisores s
LEFT JOIN ultimo_cc u ON u.funcionario_id = s.id
LEFT JOIN public.obras o ON o.id = u.obra_id
LEFT JOIN regime r ON r.funcionario_id = s.id
ORDER BY s.nome, s.id;
