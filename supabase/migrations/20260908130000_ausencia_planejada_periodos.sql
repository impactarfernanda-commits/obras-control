-- Versionamento do SQL aplicado manualmente e validado em producao.
-- Nao executar automaticamente. Preserva os IDs de periodo ja preenchidos.
BEGIN;

ALTER TABLE public.registros_horas
ADD COLUMN IF NOT EXISTS ausencia_periodo_id uuid;

CREATE INDEX IF NOT EXISTS registros_horas_ausencia_periodo_idx
ON public.registros_horas (ausencia_periodo_id)
WHERE ausencia_periodo_id IS NOT NULL;

-- Backfill: apenas linhas sem periodo e blocos efetivamente consecutivos.
-- Nao insere dias e nao altera IDs de periodos ja identificados.
WITH ordenados AS (
    SELECT
        rh.id, rh.funcionario_id, rh.obra_id, rh.tipo_registro,
        rh.created_by, rh.created_at, rh.observacoes, rh.data,
        CASE
            WHEN lag(rh.data) OVER (
                PARTITION BY rh.funcionario_id, rh.obra_id, rh.tipo_registro,
                    rh.created_by, rh.created_at, rh.observacoes
                ORDER BY rh.data
            ) = rh.data - 1
            THEN 0 ELSE 1
        END AS novo_bloco
    FROM public.registros_horas rh
    WHERE rh.tipo_registro IN ('ferias', 'folga_campo')
      AND rh.ausencia_periodo_id IS NULL
),
marcados AS (
    SELECT o.*,
        sum(o.novo_bloco) OVER (
            PARTITION BY o.funcionario_id, o.obra_id, o.tipo_registro,
                o.created_by, o.created_at, o.observacoes
            ORDER BY o.data ROWS UNBOUNDED PRECEDING
        ) AS bloco
    FROM ordenados o
),
grupos AS (
    SELECT array_agg(id ORDER BY data) AS ids, gen_random_uuid() AS periodo_id
    FROM marcados
    GROUP BY funcionario_id, obra_id, tipo_registro,
        created_by, created_at, observacoes, bloco
),
mapa AS (
    SELECT unnest(ids) AS id, periodo_id FROM grupos
)
UPDATE public.registros_horas rh
SET ausencia_periodo_id = mapa.periodo_id
FROM mapa
WHERE rh.id = mapa.id;

CREATE OR REPLACE FUNCTION public.obras_salvar_ausencia_planejada_periodo(
    p_funcionario_id uuid,
    p_obra_id uuid,
    p_tipo_registro text,
    p_data_inicio date,
    p_data_fim date,
    p_observacoes text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_total integer;
    v_usuario uuid := auth.uid();
    v_periodo_id uuid := gen_random_uuid();
BEGIN
    IF v_usuario IS NULL THEN
        RAISE EXCEPTION 'Autenticacao obrigatoria.' USING ERRCODE = '42501';
    END IF;
    IF p_tipo_registro NOT IN ('ferias', 'folga_campo') THEN
        RAISE EXCEPTION 'Tipo de ausencia planejada invalido.' USING ERRCODE = '23514';
    END IF;
    IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_fim < p_data_inicio THEN
        RAISE EXCEPTION 'PERIODO_AUSENCIA_INVALIDO' USING ERRCODE = '22007';
    END IF;
    IF p_data_fim - p_data_inicio > 366 THEN
        RAISE EXCEPTION 'Periodo de ausencia excede 367 dias.' USING ERRCODE = '22023';
    END IF;

    PERFORM public.obras_validar_conflito_apontamento_diario(
        p_funcionario_id, d::date, p_tipo_registro, NULL
    )
    FROM generate_series(p_data_inicio, p_data_fim, interval '1 day') AS d;

    INSERT INTO public.registros_horas (
        funcionario_id, obra_id, data, tipo_registro, falta_tipo,
        horas_normais, horas_extras, justificativa_extras, ausencia,
        motivo_ausencia, observacoes, created_by, updated_by, ausencia_periodo_id
    )
    SELECT p_funcionario_id, p_obra_id, d::date, p_tipo_registro, NULL,
        0, 0, NULL, true, p_tipo_registro, nullif(btrim(p_observacoes), ''),
        v_usuario, v_usuario, v_periodo_id
    FROM generate_series(p_data_inicio, p_data_fim, interval '1 day') AS d;

    GET DIAGNOSTICS v_total = ROW_COUNT;
    RETURN v_total;
END;
$function$;

-- CREATE OR REPLACE preserva a ACL da RPC de criacao, definida na migration
-- 20260814110000_adiciona_ferias_folga_campo.sql.

CREATE OR REPLACE FUNCTION public.obras_obter_ausencia_planejada_periodo(p_registro_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
    v_usuario uuid := auth.uid();
    v_registro public.registros_horas;
    v_data_inicio date;
    v_data_fim date;
    v_quantidade integer;
BEGIN
    IF v_usuario IS NULL THEN
        RAISE EXCEPTION 'Autenticacao obrigatoria.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_registro FROM public.registros_horas WHERE id = p_registro_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registro nao encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF v_registro.tipo_registro NOT IN ('ferias', 'folga_campo') THEN
        RAISE EXCEPTION 'Este registro nao pertence a uma ausencia planejada.' USING ERRCODE = '23514';
    END IF;

    IF v_registro.ausencia_periodo_id IS NULL THEN
        v_data_inicio := v_registro.data;
        v_data_fim := v_registro.data;
        v_quantidade := 1;
    ELSE
        WITH ordenadas AS (
            SELECT rh.id, rh.data,
                rh.data - (row_number() OVER (ORDER BY rh.data))::integer AS grupo
            FROM public.registros_horas rh
            WHERE rh.ausencia_periodo_id = v_registro.ausencia_periodo_id
              AND rh.funcionario_id = v_registro.funcionario_id
              AND rh.obra_id = v_registro.obra_id
              AND rh.tipo_registro = v_registro.tipo_registro
        ),
        alvo AS (
            SELECT grupo FROM ordenadas WHERE id = v_registro.id
        )
        SELECT min(o.data), max(o.data), count(*)::integer
        INTO v_data_inicio, v_data_fim, v_quantidade
        FROM ordenadas o CROSS JOIN alvo a
        WHERE o.grupo = a.grupo;
    END IF;

    RETURN jsonb_build_object(
        'registro_id', v_registro.id,
        'ausencia_periodo_id', v_registro.ausencia_periodo_id,
        'funcionario_id', v_registro.funcionario_id,
        'obra_id', v_registro.obra_id,
        'tipo_registro', v_registro.tipo_registro,
        'data_inicio', v_data_inicio,
        'data_fim', v_data_fim,
        'quantidade_dias', v_quantidade,
        'observacoes', v_registro.observacoes
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.obras_obter_ausencia_planejada_periodo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_obter_ausencia_planejada_periodo(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.obras_editar_ausencia_planejada_periodo(
    p_registro_id uuid,
    p_data_inicio date,
    p_data_fim date,
    p_observacoes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_usuario uuid := auth.uid();
    v_registro public.registros_horas;
    v_periodo_id uuid;
    v_ids uuid[];
    v_inicio_atual date;
    v_fim_atual date;
    v_total_atual integer;
    v_total_bloqueado integer;
    v_data date;
    v_observacoes text;
    v_atualizados integer := 0;
    v_removidos integer := 0;
    v_adicionados integer := 0;
BEGIN
    IF v_usuario IS NULL THEN
        RAISE EXCEPTION 'Sessao expirada.' USING ERRCODE = '42501';
    END IF;
    IF p_data_inicio IS NULL OR p_data_fim IS NULL OR p_data_fim < p_data_inicio THEN
        RAISE EXCEPTION 'PERIODO_AUSENCIA_INVALIDO' USING ERRCODE = '22007';
    END IF;
    IF p_data_fim - p_data_inicio > 366 THEN
        RAISE EXCEPTION 'Periodo de ausencia excede 367 dias.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_registro FROM public.registros_horas WHERE id = p_registro_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registro nao encontrado ou ja excluido.' USING ERRCODE = 'P0002';
    END IF;
    IF v_registro.tipo_registro NOT IN ('ferias', 'folga_campo') THEN
        RAISE EXCEPTION 'Este tipo de registro nao pode ser editado por esta operacao.' USING ERRCODE = '23514';
    END IF;

    IF NOT (
        coalesce(v_registro.created_by = v_usuario, false)
        OR EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = v_usuario
              AND ur.role::text IN ('coordenador', 'gerente', 'diretor')
        )
    ) THEN
        RAISE EXCEPTION 'Sem permissao para editar este lancamento.' USING ERRCODE = '42501';
    END IF;

    v_periodo_id := coalesce(v_registro.ausencia_periodo_id, gen_random_uuid());
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('ausencia_periodo|' || v_periodo_id::text, 0)
    );

    IF v_registro.ausencia_periodo_id IS NULL THEN
        v_ids := ARRAY[v_registro.id];
        v_inicio_atual := v_registro.data;
        v_fim_atual := v_registro.data;
        v_total_atual := 1;
    ELSE
        WITH ordenadas AS (
            SELECT rh.id, rh.data,
                rh.data - (row_number() OVER (ORDER BY rh.data))::integer AS grupo
            FROM public.registros_horas rh
            WHERE rh.ausencia_periodo_id = v_registro.ausencia_periodo_id
              AND rh.funcionario_id = v_registro.funcionario_id
              AND rh.obra_id = v_registro.obra_id
              AND rh.tipo_registro = v_registro.tipo_registro
        ),
        alvo AS (
            SELECT grupo FROM ordenadas WHERE id = v_registro.id
        )
        SELECT array_agg(o.id ORDER BY o.data), min(o.data), max(o.data), count(*)::integer
        INTO v_ids, v_inicio_atual, v_fim_atual, v_total_atual
        FROM ordenadas o CROSS JOIN alvo a
        WHERE o.grupo = a.grupo;
    END IF;

    IF v_ids IS NULL OR v_total_atual = 0 THEN
        RAISE EXCEPTION 'Periodo de ausencia nao encontrado.' USING ERRCODE = 'P0002';
    END IF;

    -- Locks deterministicos das datas atuais e pretendidas.
    FOR v_data IN
        SELECT DISTINCT x.data
        FROM (
            SELECT d::date AS data
            FROM generate_series(v_inicio_atual, v_fim_atual, interval '1 day') AS d
            UNION
            SELECT d::date AS data
            FROM generate_series(p_data_inicio, p_data_fim, interval '1 day') AS d
        ) x ORDER BY x.data
    LOOP
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(v_registro.funcionario_id::text || '|' || v_data::text, 0)
        );
    END LOOP;

    PERFORM 1 FROM public.registros_horas rh WHERE rh.id = ANY(v_ids) FOR UPDATE;
    GET DIAGNOSTICS v_total_bloqueado = ROW_COUNT;
    IF v_total_bloqueado <> v_total_atual THEN
        RAISE EXCEPTION 'O periodo foi alterado por outro usuario. Recarregue e tente novamente.'
            USING ERRCODE = '40001';
    END IF;

    FOR v_data IN
        SELECT DISTINCT x.data
        FROM (
            SELECT d::date AS data
            FROM generate_series(v_inicio_atual, v_fim_atual, interval '1 day') AS d
            UNION
            SELECT d::date AS data
            FROM generate_series(p_data_inicio, p_data_fim, interval '1 day') AS d
        ) x ORDER BY x.data
    LOOP
        IF public.competencia_fechada(v_data) THEN
            RAISE EXCEPTION 'Competencia fechada. Solicite reabertura ao gerente para alterar este periodo.'
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;

    FOR v_data IN
        SELECT d::date
        FROM generate_series(p_data_inicio, p_data_fim, interval '1 day') AS d
        WHERE d::date < v_inicio_atual OR d::date > v_fim_atual
        ORDER BY d::date
    LOOP
        PERFORM public.obras_validar_conflito_apontamento_diario(
            v_registro.funcionario_id, v_data, v_registro.tipo_registro, NULL
        );
        IF EXISTS (
            SELECT 1 FROM public.registros_horas rh
            WHERE rh.funcionario_id = v_registro.funcionario_id
              AND rh.obra_id = v_registro.obra_id
              AND rh.data = v_data
              AND NOT (rh.id = ANY(v_ids))
        ) THEN
            RAISE EXCEPTION 'REGISTRO_AUSENCIA_JA_EXISTE'
                USING ERRCODE = '23514',
                    DETAIL = 'Ja existe registro para o mesmo funcionario, obra e data.';
        END IF;
    END LOOP;

    v_observacoes := nullif(pg_catalog.btrim(p_observacoes), '');

    UPDATE public.registros_horas rh
    SET ausencia_periodo_id = v_periodo_id, observacoes = v_observacoes, updated_by = v_usuario
    WHERE rh.id = ANY(v_ids) AND rh.data BETWEEN p_data_inicio AND p_data_fim;
    GET DIAGNOSTICS v_atualizados = ROW_COUNT;

    INSERT INTO public.registros_horas_exclusoes (
        registro_id_original, funcionario_id, obra_id, data,
        tipo_registro, registro_snapshot, excluido_por
    )
    SELECT rh.id, rh.funcionario_id, rh.obra_id, rh.data,
        rh.tipo_registro, to_jsonb(rh), v_usuario
    FROM public.registros_horas rh
    WHERE rh.id = ANY(v_ids) AND (rh.data < p_data_inicio OR rh.data > p_data_fim);
    GET DIAGNOSTICS v_removidos = ROW_COUNT;

    DELETE FROM public.registros_horas rh
    WHERE rh.id = ANY(v_ids) AND (rh.data < p_data_inicio OR rh.data > p_data_fim);

    INSERT INTO public.registros_horas (
        funcionario_id, obra_id, data, tipo_registro, falta_tipo,
        horas_normais, horas_extras, justificativa_extras, ausencia,
        motivo_ausencia, observacoes, created_by, created_at, updated_by, ausencia_periodo_id
    )
    SELECT v_registro.funcionario_id, v_registro.obra_id, d::date,
        v_registro.tipo_registro, NULL, 0, 0, NULL, true,
        v_registro.tipo_registro, v_observacoes,
        coalesce(v_registro.created_by, v_usuario), v_registro.created_at,
        v_usuario, v_periodo_id
    FROM generate_series(p_data_inicio, p_data_fim, interval '1 day') AS d
    WHERE d::date < v_inicio_atual OR d::date > v_fim_atual;
    GET DIAGNOSTICS v_adicionados = ROW_COUNT;

    RETURN jsonb_build_object(
        'ausencia_periodo_id', v_periodo_id,
        'tipo_registro', v_registro.tipo_registro,
        'data_inicio_anterior', v_inicio_atual,
        'data_fim_anterior', v_fim_atual,
        'data_inicio', p_data_inicio,
        'data_fim', p_data_fim,
        'atualizados', v_atualizados,
        'removidos', v_removidos,
        'adicionados', v_adicionados
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.obras_editar_ausencia_planejada_periodo(uuid, date, date, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_editar_ausencia_planejada_periodo(uuid, date, date, text)
TO authenticated, service_role;

COMMIT;
