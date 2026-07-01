-- Fechamento global de competencia 25-24.
-- Nao ha obra_id: o fechamento e global para todas as obras.
-- Esta migration nao apaga dados existentes.

CREATE TABLE IF NOT EXISTS public.fechamentos_competencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia text UNIQUE NOT NULL,
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  fechada boolean NOT NULL DEFAULT false,
  fechado_por uuid NULL REFERENCES auth.users(id),
  fechado_em timestamptz NULL,
  reaberto_por uuid NULL REFERENCES auth.users(id),
  reaberto_em timestamptz NULL,
  motivo_reabertura text NULL,
  observacoes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fechamentos_competencia_periodo_valido CHECK (data_inicio <= data_fim),
  CONSTRAINT fechamentos_competencia_fechada_consistente CHECK (
    (fechada = false) OR (fechado_por IS NOT NULL AND fechado_em IS NOT NULL)
  ),
  CONSTRAINT fechamentos_competencia_reabertura_consistente CHECK (
    reaberto_em IS NULL OR (reaberto_por IS NOT NULL AND motivo_reabertura IS NOT NULL AND btrim(motivo_reabertura) <> '')
  )
);

CREATE INDEX IF NOT EXISTS fechamentos_competencia_periodo_idx
  ON public.fechamentos_competencia (data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS fechamentos_competencia_fechada_idx
  ON public.fechamentos_competencia (fechada);

ALTER TABLE public.fechamentos_competencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver fechamentos_competencia" ON public.fechamentos_competencia;
CREATE POLICY "Ver fechamentos_competencia"
  ON public.fechamentos_competencia
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Gerente diretor insere fechamentos_competencia" ON public.fechamentos_competencia;
CREATE POLICY "Gerente diretor insere fechamentos_competencia"
  ON public.fechamentos_competencia
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'gerente'::public.app_role)
    OR public.has_role(auth.uid(), 'diretor'::public.app_role)
  );

DROP POLICY IF EXISTS "Gerente diretor atualiza fechamentos_competencia" ON public.fechamentos_competencia;
CREATE POLICY "Gerente diretor atualiza fechamentos_competencia"
  ON public.fechamentos_competencia
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'gerente'::public.app_role)
    OR public.has_role(auth.uid(), 'diretor'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'gerente'::public.app_role)
    OR public.has_role(auth.uid(), 'diretor'::public.app_role)
  );

DROP TRIGGER IF EXISTS fechamentos_competencia_touch ON public.fechamentos_competencia;
CREATE TRIGGER fechamentos_competencia_touch
  BEFORE UPDATE ON public.fechamentos_competencia
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.competencia_25_24(_data date)
RETURNS TABLE (competencia text, data_inicio date, data_fim date)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    to_char(CASE WHEN extract(day FROM _data)::int >= 25 THEN _data + interval '1 month' ELSE _data END, 'YYYY-MM') AS competencia,
    CASE
      WHEN extract(day FROM _data)::int >= 25 THEN make_date(extract(year FROM (_data + interval '1 month'))::int, extract(month FROM (_data + interval '1 month'))::int, 25) - interval '1 month'
      ELSE make_date(extract(year FROM _data)::int, extract(month FROM _data)::int, 25) - interval '1 month'
    END::date AS data_inicio,
    CASE
      WHEN extract(day FROM _data)::int >= 25 THEN make_date(extract(year FROM (_data + interval '1 month'))::int, extract(month FROM (_data + interval '1 month'))::int, 24)
      ELSE make_date(extract(year FROM _data)::int, extract(month FROM _data)::int, 24)
    END::date AS data_fim;
$$;

CREATE OR REPLACE FUNCTION public.competencia_fechada(_data date)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fechamentos_competencia fc
    JOIN public.competencia_25_24(_data) c ON c.competencia = fc.competencia
    WHERE fc.fechada = true
      AND _data BETWEEN fc.data_inicio AND fc.data_fim
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_competencia_fechada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.competencia_fechada(OLD.data) THEN
      RAISE EXCEPTION 'Competencia fechada. Solicite reabertura ao gerente para alterar este periodo.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF public.competencia_fechada(OLD.data) OR public.competencia_fechada(NEW.data) THEN
      RAISE EXCEPTION 'Competencia fechada. Solicite reabertura ao gerente para alterar este periodo.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF public.competencia_fechada(NEW.data) THEN
    RAISE EXCEPTION 'Competencia fechada. Solicite reabertura ao gerente para alterar este periodo.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_competencia_fechada_alocacoes ON public.alocacoes;
CREATE TRIGGER trg_guard_competencia_fechada_alocacoes
  BEFORE INSERT OR UPDATE OR DELETE ON public.alocacoes
  FOR EACH ROW EXECUTE FUNCTION public.guard_competencia_fechada();

DROP TRIGGER IF EXISTS trg_guard_competencia_fechada_registros_horas ON public.registros_horas;
CREATE TRIGGER trg_guard_competencia_fechada_registros_horas
  BEFORE INSERT OR UPDATE OR DELETE ON public.registros_horas
  FOR EACH ROW EXECUTE FUNCTION public.guard_competencia_fechada();

REVOKE EXECUTE ON FUNCTION public.guard_competencia_fechada() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competencia_25_24(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.competencia_fechada(date) TO authenticated, service_role;
