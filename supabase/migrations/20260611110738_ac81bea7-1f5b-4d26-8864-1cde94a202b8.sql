
-- Tighten funcionarios constraints
ALTER TABLE public.funcionarios
  ALTER COLUMN categoria_mo SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS funcionarios_cpf_unique
  ON public.funcionarios (cpf) WHERE cpf IS NOT NULL;

ALTER TABLE public.funcionarios
  DROP CONSTRAINT IF EXISTS funcionarios_salario_positive;
ALTER TABLE public.funcionarios
  ADD CONSTRAINT funcionarios_salario_positive CHECK (salario > 0);

-- Allocations table
CREATE TABLE public.alocacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  obra_id uuid NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  data date NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funcionario_id, obra_id, data)
);

CREATE INDEX alocacoes_funcionario_data_idx ON public.alocacoes (funcionario_id, data DESC);
CREATE INDEX alocacoes_obra_data_idx ON public.alocacoes (obra_id, data DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alocacoes TO authenticated;
GRANT ALL ON public.alocacoes TO service_role;

ALTER TABLE public.alocacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view alocacoes"
  ON public.alocacoes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert alocacoes"
  ON public.alocacoes FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can update alocacoes"
  ON public.alocacoes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete alocacoes"
  ON public.alocacoes FOR DELETE TO authenticated USING (true);
