-- Corrige exclusivamente a janela de disponibilidade e expõe as datas do vínculo.
-- A implementação aplicada em 13/10 é preservada por OID para evitar quebrar dependências.
ALTER FUNCTION public.relatorio_alocacao_centro_custo(date, uuid, uuid, text, boolean)
  RENAME TO relatorio_alocacao_centro_custo_referencia_anterior;

REVOKE ALL ON FUNCTION public.relatorio_alocacao_centro_custo_referencia_anterior(date, uuid, uuid, text, boolean)
FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.relatorio_alocacao_centro_custo(
  p_competencia date,
  p_funcionario_id uuid DEFAULT NULL,
  p_obra_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_somente_pendencias boolean DEFAULT false
)
RETURNS TABLE (
  competencia text,
  periodo_inicio date,
  periodo_fim date,
  funcionario_id uuid,
  funcionario_nome text,
  categoria text,
  data date,
  data_inicio date,
  data_saida date,
  hora_entrada time,
  hora_saida time,
  situacao text,
  tipo_registro text,
  falta_tipo text,
  obra_id uuid,
  obra_nome text,
  minutos_normais numeric,
  minutos_he_50 numeric,
  minutos_he_100 numeric,
  minutos_sem_adicional_he numeric,
  minutos_noturnos numeric,
  observacoes text,
  possui_inconsistencia boolean,
  tipo_inconsistencia text,
  origem_horas text,
  dia_esperado boolean,
  dias_esperados_funcionario integer,
  data_admissao_funcionario date,
  data_desligamento_funcionario date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Sessao expirada.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_usuario
      AND ur.role::text IN ('assistente', 'supervisor', 'coordenador', 'gerente', 'diretor')
  ) THEN
    RAISE EXCEPTION 'Forbidden: relatorio indisponivel para este perfil' USING ERRCODE = '42501';
  END IF;
  IF p_competencia IS NULL OR extract(day FROM p_competencia)::integer <> 1 THEN
    RAISE EXCEPTION 'p_competencia deve ser o primeiro dia do mes' USING ERRCODE = '22007';
  END IF;

  RETURN QUERY
  SELECT
    r.competencia, r.periodo_inicio, r.periodo_fim, r.funcionario_id,
    r.funcionario_nome, r.categoria, r.data, r.data_inicio, r.data_saida,
    r.hora_entrada, r.hora_saida, r.situacao, r.tipo_registro, r.falta_tipo,
    r.obra_id, r.obra_nome, r.minutos_normais, r.minutos_he_50, r.minutos_he_100,
    r.minutos_sem_adicional_he, r.minutos_noturnos, r.observacoes,
    r.possui_inconsistencia, r.tipo_inconsistencia, r.origem_horas,
    (
      r.data BETWEEN greatest(r.periodo_inicio, coalesce(f.data_admissao, r.periodo_inicio))
                 AND least(r.periodo_fim, coalesce(f.data_desligamento, r.periodo_fim))
      AND extract(isodow FROM r.data) BETWEEN 1 AND 5
      AND NOT EXISTS (
        SELECT 1 FROM public.feriados_obras_control fo
        WHERE fo.data = r.data AND fo.ativo = true
      )
    ) AS dia_esperado,
    disponibilidade.quantidade AS dias_esperados_funcionario,
    f.data_admissao AS data_admissao_funcionario,
    f.data_desligamento AS data_desligamento_funcionario
  FROM public.relatorio_alocacao_centro_custo_referencia_anterior(
    p_competencia, p_funcionario_id, p_obra_id, p_categoria, p_somente_pendencias
  ) r
  JOIN public.funcionarios f ON f.id = r.funcionario_id
  CROSS JOIN LATERAL (
    SELECT count(*)::integer AS quantidade
    FROM generate_series(
      greatest(r.periodo_inicio, coalesce(f.data_admissao, r.periodo_inicio)),
      least(r.periodo_fim, coalesce(f.data_desligamento, r.periodo_fim)),
      interval '1 day'
    ) gs(d)
    WHERE extract(isodow FROM gs.d) BETWEEN 1 AND 5
      AND NOT EXISTS (
        SELECT 1 FROM public.feriados_obras_control fo
        WHERE fo.data = gs.d::date AND fo.ativo = true
      )
  ) disponibilidade;
END;
$function$;

REVOKE ALL ON FUNCTION public.relatorio_alocacao_centro_custo(date, uuid, uuid, text, boolean)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relatorio_alocacao_centro_custo(date, uuid, uuid, text, boolean)
TO authenticated;

COMMENT ON FUNCTION public.relatorio_alocacao_centro_custo(date, uuid, uuid, text, boolean) IS
  'Fonte diaria historica do rateio por centro de custo; disponibilidade cobre a competencia 25-24 integral.';
