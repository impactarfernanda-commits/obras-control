-- Blindagem crítica: um funcionário não pode ter presença em duas obras no mesmo dia.
--
-- Verificação manual de duplicidades antes da constraint:
-- SELECT
--   funcionario_id,
--   data,
--   count(*) AS quantidade,
--   array_agg(DISTINCT obra_id ORDER BY obra_id) AS obras_envolvidas
-- FROM public.alocacoes
-- GROUP BY funcionario_id, data
-- HAVING count(*) > 1
-- ORDER BY data, funcionario_id;
--
-- Esta migration não apaga nem corrige dados automaticamente. Se houver duplicidade,
-- ela interrompe a aplicação para que a correção seja feita de forma consciente.

DO $$
DECLARE
  duplicidades jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(d))
    INTO duplicidades
    FROM (
      SELECT
        funcionario_id,
        data,
        count(*)::integer AS quantidade,
        array_agg(DISTINCT obra_id ORDER BY obra_id) AS obras_envolvidas
      FROM public.alocacoes
      GROUP BY funcionario_id, data
      HAVING count(*) > 1
      ORDER BY data, funcionario_id
    ) AS d;

  IF duplicidades IS NOT NULL THEN
    RAISE EXCEPTION 'Não é possível criar a constraint alocacoes_funcionario_data_unique. Existem alocações duplicadas por funcionário e data: %', duplicidades
      USING
        ERRCODE = '23505',
        HINT = 'Corrija manualmente as duplicidades em public.alocacoes antes de aplicar esta migration.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.alocacoes'::regclass
      AND conname = 'alocacoes_funcionario_data_unique'
  ) THEN
    ALTER TABLE public.alocacoes
      ADD CONSTRAINT alocacoes_funcionario_data_unique UNIQUE (funcionario_id, data);
  END IF;
END $$;

COMMENT ON CONSTRAINT alocacoes_funcionario_data_unique ON public.alocacoes IS
  'Impede que o mesmo funcionário seja lançado em mais de uma obra na mesma data.';
