-- Armazena a jornada informada sem modificar em massa alocações antigas.
ALTER TABLE public.alocacoes
  ADD COLUMN IF NOT EXISTS hora_entrada time,
  ADD COLUMN IF NOT EXISTS hora_saida time,
  ADD COLUMN IF NOT EXISTS intervalo_padrao_minutos integer NOT NULL DEFAULT 60;

COMMENT ON COLUMN public.alocacoes.hora_entrada IS
  'Hora de entrada informada na criação ou correção da alocação.';
COMMENT ON COLUMN public.alocacoes.hora_saida IS
  'Hora de saída informada na criação ou correção da alocação.';
COMMENT ON COLUMN public.alocacoes.intervalo_padrao_minutos IS
  'Intervalo fixo, em minutos, descontado da jornada informada.';
