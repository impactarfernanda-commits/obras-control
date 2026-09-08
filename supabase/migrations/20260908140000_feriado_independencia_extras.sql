-- Versionamento local do feriado ja cadastrado manualmente em producao.
-- Nao executar automaticamente. Nao duplica nem sobrescreve o cadastro existente.
BEGIN;

INSERT INTO public.feriados_obras_control (data, descricao, ativo)
VALUES (DATE '2026-09-07', 'Independência do Brasil', true)
ON CONFLICT (data) DO NOTHING;

ALTER TABLE public.registros_horas
DROP CONSTRAINT IF EXISTS extras_requerem_normais;

CREATE OR REPLACE FUNCTION public.guard_extras_requerem_normais()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_eh_feriado boolean;
BEGIN
    IF coalesce(NEW.horas_extras, 0) > 0
       AND coalesce(NEW.horas_normais, 0) <= 0
       AND extract(isodow FROM NEW.data) NOT IN (6, 7)
    THEN
        SELECT EXISTS (
            SELECT 1
            FROM public.feriados_obras_control f
            WHERE f.data = NEW.data
              AND f.ativo = true
        )
        INTO v_eh_feriado;

        IF NOT v_eh_feriado THEN
            RAISE EXCEPTION 'EXTRAS_REQUEREM_NORMAIS'
                USING ERRCODE = '23514',
                      DETAIL = 'Horas extras sem horas normais somente são permitidas em sábado, domingo ou feriado ativo.';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_registros_horas_extras_requerem_normais
ON public.registros_horas;

CREATE TRIGGER trg_registros_horas_extras_requerem_normais
BEFORE INSERT OR UPDATE OF data, horas_normais, horas_extras
ON public.registros_horas
FOR EACH ROW
EXECUTE FUNCTION public.guard_extras_requerem_normais();

COMMIT;
