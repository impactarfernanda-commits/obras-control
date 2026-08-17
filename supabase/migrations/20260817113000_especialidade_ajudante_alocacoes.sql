-- Classificacao historica do AJUDANTE pertence a cada alocacao.
-- NULL permanece permitido no schema para que o legado continue legivel.
ALTER TABLE public.alocacoes
  ADD COLUMN IF NOT EXISTS especialidade_ajudante text NULL;

ALTER TABLE public.alocacoes
  DROP CONSTRAINT IF EXISTS alocacoes_especialidade_ajudante_check;
ALTER TABLE public.alocacoes
  ADD CONSTRAINT alocacoes_especialidade_ajudante_check
  CHECK (especialidade_ajudante IS NULL OR especialidade_ajudante IN ('civil', 'montagem'));

COMMENT ON COLUMN public.alocacoes.especialidade_ajudante IS
  'Atuacao civil ou montagem do AJUDANTE nesta alocacao; NULL identifica legado pendente.';

CREATE OR REPLACE FUNCTION public.validar_especialidade_ajudante_alocacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_categoria text;
  v_competencia date;
BEGIN
  v_competencia := date_trunc('month', NEW.data)::date;
  IF extract(day FROM NEW.data) >= 25 THEN
    v_competencia := (v_competencia + interval '1 month')::date;
  END IF;

  -- A segmentacao passa a valer na competencia agosto/2026 (25/07 a 24/08).
  IF v_competencia < DATE '2026-08-01' THEN
    RETURN NEW;
  END IF;

  SELECT upper(btrim(translate(f.categoria_mo,
    'ÃÃ€Ã‚ÃƒÃ‰ÃˆÃŠÃÃŒÃŽÃ“Ã’Ã”Ã•ÃšÃ™Ã›Ã‡Ã¡Ã Ã¢Ã£Ã©Ã¨ÃªÃ­Ã¬Ã®Ã³Ã²Ã´ÃµÃºÃ¹Ã»Ã§',
    'AAAAEEEIIIOOOOUUUCaaaaeeeiiioooouuuc')))
    INTO v_categoria
  FROM public.funcionarios f
  WHERE f.id = NEW.funcionario_id;

  IF v_categoria = 'AJUDANTE' AND NEW.especialidade_ajudante IS NULL THEN
    RAISE EXCEPTION 'Informe se o ajudante atuara em Civil ou Montagem.' USING ERRCODE = '23514';
  END IF;
  -- Preserva o historico se o cadastro do funcionario mudou depois da alocacao.
  IF TG_OP = 'UPDATE'
     AND OLD.especialidade_ajudante IS NOT NULL
     AND NEW.especialidade_ajudante IS NOT DISTINCT FROM OLD.especialidade_ajudante THEN
    RETURN NEW;
  END IF;
  IF v_categoria IS DISTINCT FROM 'AJUDANTE' AND NEW.especialidade_ajudante IS NOT NULL THEN
    RAISE EXCEPTION 'Especialidade de ajudante somente pode ser informada para AJUDANTE.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.validar_especialidade_ajudante_alocacao()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validar_especialidade_ajudante_alocacao ON public.alocacoes;
CREATE TRIGGER trg_validar_especialidade_ajudante_alocacao
  BEFORE INSERT OR UPDATE
  ON public.alocacoes
  FOR EACH ROW EXECUTE FUNCTION public.validar_especialidade_ajudante_alocacao();

COMMENT ON TRIGGER trg_validar_especialidade_ajudante_alocacao ON public.alocacoes IS
  'Exige classificacao de AJUDANTE a partir da competencia agosto/2026, sem backfill historico.';
