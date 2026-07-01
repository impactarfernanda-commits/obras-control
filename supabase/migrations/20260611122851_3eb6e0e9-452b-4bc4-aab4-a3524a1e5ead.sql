
CREATE TABLE public.registros_horas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  obra_id uuid NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  data date NOT NULL,
  horas_normais numeric(4,2) NOT NULL DEFAULT 0,
  horas_extras numeric(4,2) NOT NULL DEFAULT 0,
  justificativa_extras text,
  ausencia boolean NOT NULL DEFAULT false,
  motivo_ausencia text,
  observacoes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registros_horas_unique UNIQUE (funcionario_id, obra_id, data),
  CONSTRAINT horas_normais_range CHECK (horas_normais >= 0 AND horas_normais <= 9),
  CONSTRAINT horas_extras_range CHECK (horas_extras >= 0 AND horas_extras <= 7),
  CONSTRAINT horas_totais_max CHECK ((horas_normais + horas_extras) <= 16),
  CONSTRAINT extras_requerem_normais CHECK (horas_extras = 0 OR horas_normais >= 9),
  CONSTRAINT extras_justificativa CHECK (horas_extras <= 2 OR (justificativa_extras IS NOT NULL AND length(btrim(justificativa_extras)) > 0)),
  CONSTRAINT ausencia_sem_horas CHECK (NOT ausencia OR (horas_normais = 0 AND horas_extras = 0))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.registros_horas TO authenticated;
GRANT ALL ON public.registros_horas TO service_role;

ALTER TABLE public.registros_horas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view registros"
  ON public.registros_horas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert registros"
  ON public.registros_horas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Creator or manager can update registros"
  ON public.registros_horas FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.get_user_level(auth.uid()) >= 2)
  WITH CHECK (created_by = auth.uid() OR public.get_user_level(auth.uid()) >= 2);

CREATE POLICY "Creator or manager can delete registros"
  ON public.registros_horas FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.get_user_level(auth.uid()) >= 2);

CREATE INDEX registros_horas_data_idx ON public.registros_horas(data);
CREATE INDEX registros_horas_func_data_idx ON public.registros_horas(funcionario_id, data);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER registros_horas_touch BEFORE UPDATE ON public.registros_horas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.registros_horas REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.registros_horas;
