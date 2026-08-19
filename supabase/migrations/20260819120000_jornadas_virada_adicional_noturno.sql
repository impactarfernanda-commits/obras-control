-- Jornadas v2: persistência detalhada, feriados configuráveis e salvamento atômico.
-- Não reclassifica nem altera registros históricos.

CREATE TABLE public.feriados_obras_control (
  data date PRIMARY KEY,
  descricao text NOT NULL CHECK (length(btrim(descricao)) > 0),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES auth.users(id),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES auth.users(id)
);

ALTER TABLE public.feriados_obras_control ENABLE ROW LEVEL SECURITY;
CREATE POLICY feriados_obras_control_select ON public.feriados_obras_control
  FOR SELECT TO authenticated USING (true);
CREATE POLICY feriados_obras_control_insert ON public.feriados_obras_control
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role((SELECT auth.uid()), 'gerente'::public.app_role) OR public.has_role((SELECT auth.uid()), 'diretor'::public.app_role));
CREATE POLICY feriados_obras_control_update ON public.feriados_obras_control
  FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'gerente'::public.app_role) OR public.has_role((SELECT auth.uid()), 'diretor'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'gerente'::public.app_role) OR public.has_role((SELECT auth.uid()), 'diretor'::public.app_role));
CREATE POLICY feriados_obras_control_delete ON public.feriados_obras_control
  FOR DELETE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'gerente'::public.app_role) OR public.has_role((SELECT auth.uid()), 'diretor'::public.app_role));

CREATE TABLE public.registros_horas_detalhes (
  registro_horas_id uuid PRIMARY KEY REFERENCES public.registros_horas(id) ON DELETE CASCADE,
  alocacao_id uuid NOT NULL UNIQUE REFERENCES public.alocacoes(id) ON DELETE CASCADE,
  data_inicio date NOT NULL,
  data_saida date NOT NULL,
  hora_entrada time NOT NULL,
  hora_saida time NOT NULL,
  intervalo_minutos integer NOT NULL CHECK (intervalo_minutos >= 0),
  permanencia_minutos integer NOT NULL CHECK (permanencia_minutos > 0 AND permanencia_minutos < 1440),
  total_trabalhado_minutos integer NOT NULL CHECK (total_trabalhado_minutos > 0),
  minutos_normais integer NOT NULL DEFAULT 0 CHECK (minutos_normais >= 0),
  minutos_he_50 integer NOT NULL DEFAULT 0 CHECK (minutos_he_50 >= 0),
  minutos_he_100 integer NOT NULL DEFAULT 0 CHECK (minutos_he_100 >= 0),
  minutos_sem_adicional_he integer NOT NULL DEFAULT 0 CHECK (minutos_sem_adicional_he >= 0),
  minutos_noturnos_reais integer NOT NULL DEFAULT 0 CHECK (minutos_noturnos_reais >= 0),
  minutos_noturnos_remuneraveis numeric(12,4) NOT NULL DEFAULT 0 CHECK (minutos_noturnos_remuneraveis >= 0),
  minutos_noturnos_normais_remuneraveis numeric(12,4) NOT NULL DEFAULT 0 CHECK (minutos_noturnos_normais_remuneraveis >= 0),
  minutos_noturnos_he_50_remuneraveis numeric(12,4) NOT NULL DEFAULT 0 CHECK (minutos_noturnos_he_50_remuneraveis >= 0),
  minutos_noturnos_he_100_remuneraveis numeric(12,4) NOT NULL DEFAULT 0 CHECK (minutos_noturnos_he_100_remuneraveis >= 0),
  minutos_noturnos_sem_adicional_he_remuneraveis numeric(12,4) NOT NULL DEFAULT 0 CHECK (minutos_noturnos_sem_adicional_he_remuneraveis >= 0),
  adicional_noturno_percentual numeric(5,2) NOT NULL DEFAULT 20 CHECK (adicional_noturno_percentual = 20),
  jornada_excepcional boolean NOT NULL DEFAULT false,
  supervisor_sem_he boolean NOT NULL DEFAULT false,
  versao_calculo text NOT NULL,
  origem_calculo text NOT NULL DEFAULT 'aplicacao' CHECK (origem_calculo IN ('aplicacao', 'copia')),
  segmentos jsonb NOT NULL CHECK (jsonb_typeof(segmentos) = 'array'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES auth.users(id),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES auth.users(id),
  CONSTRAINT registro_horas_detalhe_datas_check CHECK (data_saida IN (data_inicio, data_inicio + 1)),
  CONSTRAINT registro_horas_detalhe_total_check CHECK (
    total_trabalhado_minutos = permanencia_minutos - intervalo_minutos
    AND total_trabalhado_minutos = minutos_normais + minutos_he_50 + minutos_he_100 + minutos_sem_adicional_he
  ),
  CONSTRAINT registro_horas_detalhe_noturno_check CHECK (
    minutos_noturnos_reais <= total_trabalhado_minutos
    AND minutos_noturnos_remuneraveis = minutos_noturnos_normais_remuneraveis
      + minutos_noturnos_he_50_remuneraveis
      + minutos_noturnos_he_100_remuneraveis
      + minutos_noturnos_sem_adicional_he_remuneraveis
  )
);

CREATE INDEX registros_horas_detalhes_datas_idx
  ON public.registros_horas_detalhes (data_inicio, data_saida);
ALTER TABLE public.registros_horas_detalhes ENABLE ROW LEVEL SECURITY;
CREATE POLICY registros_horas_detalhes_select ON public.registros_horas_detalhes
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.feriados_obras_control FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.registros_horas_detalhes FROM authenticated, anon;
GRANT SELECT ON public.registros_horas_detalhes, public.feriados_obras_control TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feriados_obras_control TO authenticated;

ALTER TABLE public.registros_horas DROP CONSTRAINT IF EXISTS horas_normais_range;
ALTER TABLE public.registros_horas DROP CONSTRAINT IF EXISTS horas_extras_range;
ALTER TABLE public.registros_horas DROP CONSTRAINT IF EXISTS horas_totais_max;
ALTER TABLE public.registros_horas ADD CONSTRAINT horas_normais_range CHECK (horas_normais >= 0 AND horas_normais < 24) NOT VALID;
ALTER TABLE public.registros_horas ADD CONSTRAINT horas_extras_range CHECK (horas_extras >= 0 AND horas_extras < 24) NOT VALID;
ALTER TABLE public.registros_horas ADD CONSTRAINT horas_totais_max CHECK ((horas_normais + horas_extras) < 24) NOT VALID;

CREATE OR REPLACE FUNCTION public.obras_salvar_jornada_v2(
  p_alocacao_id uuid,
  p_registro_id uuid,
  p_funcionario_id uuid,
  p_obra_id uuid,
  p_data date,
  p_hora_entrada time,
  p_hora_saida time,
  p_intervalo_minutos integer,
  p_horas_normais numeric,
  p_horas_extras numeric,
  p_justificativa text,
  p_observacoes text,
  p_especialidade_ajudante text,
  p_detalhe jsonb,
  p_origem_calculo text DEFAULT 'aplicacao'
) RETURNS TABLE(alocacao_id uuid, registro_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid := auth.uid();
  v_alocacao public.alocacoes;
  v_registro public.registros_horas;
  v_data_saida date;
  v_inicio timestamp;
  v_fim timestamp;
  v_soma_intervalo integer;
  v_soma_liquida integer;
BEGIN
  IF v_usuario IS NULL THEN RAISE EXCEPTION 'Sessao expirada.' USING ERRCODE = '42501'; END IF;
  IF p_hora_entrada = p_hora_saida THEN RAISE EXCEPTION 'Entrada e saida nao podem ser iguais.' USING ERRCODE = '23514'; END IF;
  IF p_intervalo_minutos < 0 THEN RAISE EXCEPTION 'Intervalo invalido.' USING ERRCODE = '23514'; END IF;
  IF p_origem_calculo NOT IN ('aplicacao', 'copia') THEN RAISE EXCEPTION 'Origem de calculo invalida.' USING ERRCODE = '23514'; END IF;
  -- Serializa qualquer criação/edição do funcionário antes de verificar sobreposição.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_funcionario_id::text, 0));
  IF p_alocacao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.alocacoes a
    WHERE a.id = p_alocacao_id
      AND a.funcionario_id = p_funcionario_id AND a.obra_id = p_obra_id AND a.data = p_data
      AND (
        a.created_by = v_usuario
        OR public.has_role(v_usuario, 'coordenador'::public.app_role)
        OR public.has_role(v_usuario, 'gerente'::public.app_role)
        OR public.has_role(v_usuario, 'diretor'::public.app_role)
      )
  ) THEN
    RAISE EXCEPTION 'Sem permissao para editar esta alocacao.' USING ERRCODE = '42501';
  END IF;
  IF p_registro_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.registros_horas r
    WHERE r.id = p_registro_id AND r.funcionario_id = p_funcionario_id
      AND r.obra_id = p_obra_id AND r.data = p_data
  ) THEN
    RAISE EXCEPTION 'Registro de horas nao corresponde a jornada informada.' USING ERRCODE = '23514';
  END IF;
  v_data_saida := p_data + CASE WHEN p_hora_saida < p_hora_entrada THEN 1 ELSE 0 END;
  v_inicio := p_data + p_hora_entrada;
  v_fim := v_data_saida + p_hora_saida;
  IF p_intervalo_minutos >= extract(epoch FROM (v_fim - v_inicio)) / 60 THEN
    RAISE EXCEPTION 'O intervalo deve ser menor que a permanencia.' USING ERRCODE = '23514';
  END IF;
  IF coalesce((p_detalhe->>'totalTrabalhadoMinutos')::integer, 0) > 600
     AND nullif(btrim(p_justificativa), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para jornada superior a 10 horas.' USING ERRCODE = '23514';
  END IF;
  SELECT
    coalesce(sum((s->>'minutosIntervalo')::integer), 0),
    coalesce(sum((s->>'minutosLiquidos')::integer), 0)
  INTO v_soma_intervalo, v_soma_liquida
  FROM jsonb_array_elements(p_detalhe->'segmentos') AS s;
  IF v_soma_intervalo <> p_intervalo_minutos
     OR v_soma_liquida <> (p_detalhe->>'totalTrabalhadoMinutos')::integer
     OR round(p_horas_normais * 60) <> (p_detalhe->>'minutosNormais')::integer + (p_detalhe->>'minutosSemAdicionalHe')::integer
     OR round(p_horas_extras * 60) <> (p_detalhe->>'minutosHe50')::integer + (p_detalhe->>'minutosHe100')::integer THEN
    RAISE EXCEPTION 'Detalhamento da jornada nao concilia com o agregado.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.alocacoes a
    WHERE a.funcionario_id = p_funcionario_id AND a.id IS DISTINCT FROM p_alocacao_id
      AND a.hora_entrada IS NOT NULL AND a.hora_saida IS NOT NULL
      AND tsrange(
        a.data + a.hora_entrada,
        a.data + a.hora_saida + CASE WHEN a.hora_saida < a.hora_entrada THEN interval '1 day' ELSE interval '0 day' END,
        '[)'
      ) && tsrange(v_inicio, v_fim, '[)')
  ) THEN
    RAISE EXCEPTION 'ALOCACAO_CONFLITO_PERIODO' USING ERRCODE = '23505', DETAIL = 'O funcionario ja possui jornada sobreposta.';
  END IF;

  IF p_alocacao_id IS NULL THEN
    INSERT INTO public.alocacoes (
      funcionario_id, obra_id, data, created_by, hora_entrada, hora_saida,
      intervalo_padrao_minutos, especialidade_ajudante
    ) VALUES (
      p_funcionario_id, p_obra_id, p_data, v_usuario, p_hora_entrada, p_hora_saida,
      p_intervalo_minutos, p_especialidade_ajudante
    ) RETURNING * INTO v_alocacao;
  ELSE
    UPDATE public.alocacoes SET
      hora_entrada = p_hora_entrada, hora_saida = p_hora_saida,
      intervalo_padrao_minutos = p_intervalo_minutos,
      especialidade_ajudante = coalesce(p_especialidade_ajudante, especialidade_ajudante)
    WHERE id = p_alocacao_id RETURNING * INTO v_alocacao;
    IF v_alocacao.id IS NULL THEN RAISE EXCEPTION 'Alocacao nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  END IF;

  SELECT * INTO v_registro FROM public.obras_salvar_registro_horas(
    p_registro_id, p_funcionario_id, p_obra_id, p_data, 'horas', NULL,
    p_horas_normais, p_horas_extras, nullif(btrim(p_justificativa), ''),
    nullif(btrim(p_observacoes), '')
  );

  INSERT INTO public.registros_horas_detalhes (
    registro_horas_id, alocacao_id, data_inicio, data_saida, hora_entrada, hora_saida,
    intervalo_minutos, permanencia_minutos, total_trabalhado_minutos,
    minutos_normais, minutos_he_50, minutos_he_100, minutos_sem_adicional_he,
    minutos_noturnos_reais, minutos_noturnos_remuneraveis,
    minutos_noturnos_normais_remuneraveis, minutos_noturnos_he_50_remuneraveis,
    minutos_noturnos_he_100_remuneraveis, minutos_noturnos_sem_adicional_he_remuneraveis,
    jornada_excepcional,
    supervisor_sem_he, versao_calculo, origem_calculo, segmentos,
    criado_por, atualizado_por
  ) VALUES (
    v_registro.id, v_alocacao.id, p_data, v_data_saida, p_hora_entrada, p_hora_saida,
    p_intervalo_minutos, (p_detalhe->>'permanenciaMinutos')::integer,
    (p_detalhe->>'totalTrabalhadoMinutos')::integer,
    (p_detalhe->>'minutosNormais')::integer, (p_detalhe->>'minutosHe50')::integer,
    (p_detalhe->>'minutosHe100')::integer, (p_detalhe->>'minutosSemAdicionalHe')::integer,
    (p_detalhe->>'minutosNoturnosReais')::integer,
    (p_detalhe->>'minutosNoturnosRemuneraveis')::numeric,
    (p_detalhe->>'minutosNoturnosNormaisRemuneraveis')::numeric,
    (p_detalhe->>'minutosNoturnosHe50Remuneraveis')::numeric,
    (p_detalhe->>'minutosNoturnosHe100Remuneraveis')::numeric,
    (p_detalhe->>'minutosNoturnosSemAdicionalHeRemuneraveis')::numeric,
    (p_detalhe->>'excepcionalAcima12h')::boolean,
    (p_detalhe->>'minutosSemAdicionalHe')::integer > 0,
    p_detalhe->>'versaoCalculo', p_origem_calculo, p_detalhe->'segmentos',
    v_usuario, v_usuario
  ) ON CONFLICT (registro_horas_id) DO UPDATE SET
    alocacao_id = EXCLUDED.alocacao_id, data_inicio = EXCLUDED.data_inicio,
    data_saida = EXCLUDED.data_saida, hora_entrada = EXCLUDED.hora_entrada,
    hora_saida = EXCLUDED.hora_saida, intervalo_minutos = EXCLUDED.intervalo_minutos,
    permanencia_minutos = EXCLUDED.permanencia_minutos,
    total_trabalhado_minutos = EXCLUDED.total_trabalhado_minutos,
    minutos_normais = EXCLUDED.minutos_normais, minutos_he_50 = EXCLUDED.minutos_he_50,
    minutos_he_100 = EXCLUDED.minutos_he_100,
    minutos_sem_adicional_he = EXCLUDED.minutos_sem_adicional_he,
    minutos_noturnos_reais = EXCLUDED.minutos_noturnos_reais,
    minutos_noturnos_remuneraveis = EXCLUDED.minutos_noturnos_remuneraveis,
    minutos_noturnos_normais_remuneraveis = EXCLUDED.minutos_noturnos_normais_remuneraveis,
    minutos_noturnos_he_50_remuneraveis = EXCLUDED.minutos_noturnos_he_50_remuneraveis,
    minutos_noturnos_he_100_remuneraveis = EXCLUDED.minutos_noturnos_he_100_remuneraveis,
    minutos_noturnos_sem_adicional_he_remuneraveis = EXCLUDED.minutos_noturnos_sem_adicional_he_remuneraveis,
    jornada_excepcional = EXCLUDED.jornada_excepcional,
    supervisor_sem_he = EXCLUDED.supervisor_sem_he, versao_calculo = EXCLUDED.versao_calculo,
    origem_calculo = EXCLUDED.origem_calculo, segmentos = EXCLUDED.segmentos,
    atualizado_em = now(), atualizado_por = v_usuario;
  RETURN QUERY SELECT v_alocacao.id, v_registro.id;
END;
$$;

REVOKE ALL ON FUNCTION public.obras_salvar_jornada_v2(uuid,uuid,uuid,uuid,date,time,time,integer,numeric,numeric,text,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_salvar_jornada_v2(uuid,uuid,uuid,uuid,date,time,time,integer,numeric,numeric,text,text,text,jsonb,text) TO authenticated;

COMMENT ON TABLE public.feriados_obras_control IS 'Calendario global do Obras Control; inicia vazio. Nao cadastrar feriados estaduais ou municipais sem futura associacao por obra.';
COMMENT ON TABLE public.registros_horas_detalhes IS 'Detalhamento calculado de jornadas v2; registros sem linha correspondente usam o fluxo historico legado.';

CREATE OR REPLACE FUNCTION public.obras_copiar_jornadas_v2(p_itens jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_item jsonb;
  v_solicitados integer := 0;
  v_processados integer := 0;
  v_preservados integer := 0;
  v_alocacao_id uuid;
  v_registro_id uuid;
  v_funcionario_id uuid;
  v_obra_id uuid;
  v_data date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessao expirada.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_itens) <> 'array' THEN RAISE EXCEPTION 'Itens de copia invalidos.' USING ERRCODE = '22023'; END IF;
  -- Lotes concorrentes adquirem todos os locks na mesma ordem, evitando deadlock.
  FOR v_funcionario_id IN
    SELECT DISTINCT (item->>'funcionarioId')::uuid
    FROM jsonb_array_elements(p_itens) AS itens(item)
    ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_funcionario_id::text, 0));
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens)
  LOOP
    v_solicitados := v_solicitados + 1;
    v_alocacao_id := nullif(v_item->>'alocacaoId', '')::uuid;
    v_registro_id := nullif(v_item->>'registroId', '')::uuid;
    v_funcionario_id := (v_item->>'funcionarioId')::uuid;
    v_obra_id := (v_item->>'obraId')::uuid;
    v_data := (v_item->>'data')::date;

    -- Equivalente transacional a ignoreDuplicates: true, protegido também pela
    -- constraint alocacoes_funcionario_data_unique: itens de criação nunca sobrescrevem
    -- uma chave já existente. IDs explícitos representam sobrescrita confirmada.
    IF v_alocacao_id IS NULL AND EXISTS (
      SELECT 1 FROM public.alocacoes a
      WHERE a.funcionario_id = v_funcionario_id AND a.data = v_data
    ) THEN
      v_preservados := v_preservados + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.obras_salvar_jornada_v2(
        v_alocacao_id, v_registro_id, v_funcionario_id, v_obra_id, v_data,
        (v_item->>'horaEntrada')::time, (v_item->>'horaSaida')::time,
        (v_item->>'intervaloMinutos')::integer, (v_item->>'horasNormais')::numeric,
        (v_item->>'horasExtras')::numeric, v_item->>'justificativa',
        v_item->>'observacoes', v_item->>'especialidadeAjudante',
        v_item->'detalhe', 'copia'
      );
      v_processados := v_processados + 1;
    EXCEPTION WHEN unique_violation THEN
      -- Cobre corrida entre a revalidação e o INSERT sem engolir outros conflitos.
      IF v_alocacao_id IS NULL AND EXISTS (
        SELECT 1 FROM public.alocacoes a
        WHERE a.funcionario_id = v_funcionario_id AND a.data = v_data
      ) THEN
        v_preservados := v_preservados + 1;
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object(
    'solicitados', v_solicitados,
    'processados', v_processados,
    'preservados', v_preservados
  );
END;
$$;
REVOKE ALL ON FUNCTION public.obras_copiar_jornadas_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_copiar_jornadas_v2(jsonb) TO authenticated;
