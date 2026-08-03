-- Definicao anterior efetiva:
--   extras_requerem_normais CHECK (horas_extras = 0 OR horas_normais >= 8)
--   horas_extras_range CHECK (horas_extras >= 0 AND horas_extras <= 7)
--
-- Fins de semana possuem jornada normal zero. O limite individual de extras passa
-- a acompanhar o limite total de 16h, que continua protegido por horas_totais_max.
ALTER TABLE public.registros_horas
  DROP CONSTRAINT IF EXISTS extras_requerem_normais;

ALTER TABLE public.registros_horas
  ADD CONSTRAINT extras_requerem_normais
  CHECK (
    coalesce(horas_extras, 0) = 0
    OR coalesce(horas_normais, 0) > 0
    OR extract(isodow FROM data) IN (6, 7)
  );

ALTER TABLE public.registros_horas
  DROP CONSTRAINT IF EXISTS horas_extras_range;

ALTER TABLE public.registros_horas
  ADD CONSTRAINT horas_extras_range
  CHECK (horas_extras >= 0 AND horas_extras <= 16);
