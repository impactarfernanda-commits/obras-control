-- Versiona infraestrutura aplicada manualmente em producao.
-- Nao executar automaticamente. IF NOT EXISTS preserva a tabela ja instalada;
-- nao reconcilia uma tabela preexistente com estrutura divergente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.registros_horas_exclusoes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registro_id_original uuid NOT NULL,
    funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id),
    obra_id uuid NOT NULL REFERENCES public.obras(id),
    data date NOT NULL,
    tipo_registro text NOT NULL,
    registro_snapshot jsonb NOT NULL,
    excluido_por uuid NOT NULL REFERENCES auth.users(id),
    excluido_em timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT registros_horas_exclusoes_tipo_check
        CHECK (tipo_registro IN ('ferias', 'folga_campo'))
);

COMMENT ON TABLE public.registros_horas_exclusoes IS
'Auditoria de exclusões isoladas de registros de férias e folga de campo.';

ALTER TABLE public.registros_horas_exclusoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registros_horas_exclusoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.registros_horas_exclusoes TO service_role;

CREATE OR REPLACE FUNCTION public.obras_excluir_ausencia_planejada(p_registro_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_usuario uuid := auth.uid();
    v_registro public.registros_horas;
    v_nivel integer;
BEGIN
    IF v_usuario IS NULL THEN
        RAISE EXCEPTION 'Sessao expirada.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_registro
    FROM public.registros_horas
    WHERE id = p_registro_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registro nao encontrado ou ja excluido.' USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            v_registro.funcionario_id::text || '|' || v_registro.data::text, 0
        )
    );

    SELECT * INTO v_registro
    FROM public.registros_horas
    WHERE id = p_registro_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registro nao encontrado ou ja excluido.' USING ERRCODE = 'P0002';
    END IF;

    IF v_registro.tipo_registro NOT IN ('ferias', 'folga_campo') THEN
        RAISE EXCEPTION 'Este tipo de registro nao pode ser excluido por esta operacao.'
            USING ERRCODE = '23514';
    END IF;

    IF public.competencia_fechada(v_registro.data) THEN
        RAISE EXCEPTION 'Competencia fechada. Solicite reabertura ao gerente para alterar este periodo.'
            USING ERRCODE = 'P0001';
    END IF;

    v_nivel := coalesce(public.get_user_level(v_usuario), 0);
    IF NOT (
        coalesce(v_registro.created_by = v_usuario, false)
        OR v_nivel >= 2
    ) THEN
        RAISE EXCEPTION 'Sem permissao para excluir este lancamento.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.registros_horas_exclusoes (
        registro_id_original, funcionario_id, obra_id, data,
        tipo_registro, registro_snapshot, excluido_por
    ) VALUES (
        v_registro.id, v_registro.funcionario_id, v_registro.obra_id,
        v_registro.data, v_registro.tipo_registro, to_jsonb(v_registro), v_usuario
    );

    DELETE FROM public.registros_horas WHERE id = v_registro.id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nao foi possivel excluir o registro.' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
        'registro_id', v_registro.id,
        'funcionario_id', v_registro.funcionario_id,
        'obra_id', v_registro.obra_id,
        'data', v_registro.data,
        'tipo_registro', v_registro.tipo_registro
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.obras_excluir_ausencia_planejada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_excluir_ausencia_planejada(uuid) TO authenticated, service_role;
COMMIT;
