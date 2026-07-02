-- Campo para preservar o sufixo da planilha legado sem criar obras separadas.
ALTER TABLE public.alocacoes
  ADD COLUMN IF NOT EXISTS tipo_mao_obra text NULL;

ALTER TABLE public.alocacoes
  DROP CONSTRAINT IF EXISTS alocacoes_tipo_mao_obra_check;
ALTER TABLE public.alocacoes
  ADD CONSTRAINT alocacoes_tipo_mao_obra_check
  CHECK (tipo_mao_obra IS NULL OR tipo_mao_obra IN ('montagem', 'civil', 'indireta'));

CREATE INDEX IF NOT EXISTS alocacoes_tipo_mao_obra_idx
  ON public.alocacoes (tipo_mao_obra);
