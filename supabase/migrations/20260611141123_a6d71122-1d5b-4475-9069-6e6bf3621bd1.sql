
ALTER TABLE public.registros_horas DROP CONSTRAINT IF EXISTS extras_requerem_normais;
ALTER TABLE public.registros_horas
  ADD CONSTRAINT extras_requerem_normais
  CHECK (horas_extras = 0 OR horas_normais >= 8);
