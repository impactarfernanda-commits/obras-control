CREATE TABLE public.beneficios_config (
  id boolean PRIMARY KEY DEFAULT true,
  assistencia_medica numeric(10,2) NOT NULL DEFAULT 0,
  assistencia_odontologica numeric(10,2) NOT NULL DEFAULT 0,
  vale_alimentacao numeric(10,2) NOT NULL DEFAULT 0,
  multibeneficio numeric(10,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = true)
);

GRANT SELECT ON public.beneficios_config TO authenticated;
GRANT ALL ON public.beneficios_config TO service_role;

ALTER TABLE public.beneficios_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read beneficios"
  ON public.beneficios_config FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers can insert beneficios"
  ON public.beneficios_config FOR INSERT
  TO authenticated
  WITH CHECK (public.can_view_salario(auth.uid()));

CREATE POLICY "Managers can update beneficios"
  ON public.beneficios_config FOR UPDATE
  TO authenticated
  USING (public.can_view_salario(auth.uid()))
  WITH CHECK (public.can_view_salario(auth.uid()));

CREATE TRIGGER touch_beneficios_config
  BEFORE UPDATE ON public.beneficios_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.beneficios_config (id, assistencia_medica, assistencia_odontologica, vale_alimentacao, multibeneficio)
VALUES (true, 483.63, 16.90, 435.00, 2310.00)
ON CONFLICT (id) DO NOTHING;
