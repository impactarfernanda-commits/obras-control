
-- Categorias
CREATE TABLE public.custos_indiretos_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  predefinida boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custos_indiretos_categorias TO authenticated;
GRANT ALL ON public.custos_indiretos_categorias TO service_role;
ALTER TABLE public.custos_indiretos_categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read categorias" ON public.custos_indiretos_categorias
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert categorias" ON public.custos_indiretos_categorias
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "gerente update categorias" ON public.custos_indiretos_categorias
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'diretor'));
CREATE POLICY "gerente delete categorias" ON public.custos_indiretos_categorias
  FOR DELETE TO authenticated USING ((public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'diretor')) AND predefinida = false);

INSERT INTO public.custos_indiretos_categorias (nome, predefinida) VALUES
  ('Refeição', true),
  ('Alojamento', true),
  ('Viagens', true),
  ('Ferramentas', true),
  ('Materiais', true),
  ('Manutenção de Canteiro', true);

-- Lançamentos
CREATE TABLE public.custos_indiretos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id uuid NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  categoria_id uuid NOT NULL REFERENCES public.custos_indiretos_categorias(id) ON DELETE RESTRICT,
  descricao text NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  data date NOT NULL,
  responsavel_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custos_indiretos TO authenticated;
GRANT ALL ON public.custos_indiretos TO service_role;
ALTER TABLE public.custos_indiretos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read custos" ON public.custos_indiretos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert custos" ON public.custos_indiretos
  FOR INSERT TO authenticated WITH CHECK (responsavel_id = auth.uid());
CREATE POLICY "owner or manager update custos" ON public.custos_indiretos
  FOR UPDATE TO authenticated
  USING (responsavel_id = auth.uid() OR public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'diretor'));
CREATE POLICY "owner or manager delete custos" ON public.custos_indiretos
  FOR DELETE TO authenticated
  USING (responsavel_id = auth.uid() OR public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'diretor'));

CREATE TRIGGER touch_custos_indiretos
  BEFORE UPDATE ON public.custos_indiretos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_custos_indiretos_obra ON public.custos_indiretos(obra_id);
CREATE INDEX idx_custos_indiretos_data ON public.custos_indiretos(data);
CREATE INDEX idx_custos_indiretos_categoria ON public.custos_indiretos(categoria_id);
