-- Categorias dinâmicas
CREATE TABLE public.categorias (
  nome text PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('MOI','MOD')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categorias TO authenticated;
GRANT ALL ON public.categorias TO service_role;

ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categorias_select_auth" ON public.categorias
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "categorias_insert_supervisor" ON public.categorias
  FOR INSERT TO authenticated WITH CHECK (public.get_user_level(auth.uid()) >= 1);

CREATE POLICY "categorias_update_supervisor" ON public.categorias
  FOR UPDATE TO authenticated USING (public.get_user_level(auth.uid()) >= 1)
  WITH CHECK (public.get_user_level(auth.uid()) >= 1);

CREATE POLICY "categorias_delete_supervisor" ON public.categorias
  FOR DELETE TO authenticated USING (public.get_user_level(auth.uid()) >= 1);

-- Seed das 19 categorias atuais
INSERT INTO public.categorias (nome, tipo) VALUES
  ('Assistente Eng I','MOI'),
  ('Assistente Eng II','MOI'),
  ('Supervisor I','MOI'),
  ('Supervisor II','MOI'),
  ('Supervisor III','MOI'),
  ('Coordenador','MOI'),
  ('Assist Admin','MOI'),
  ('Técnico Segurança','MOI'),
  ('Ajudante','MOD'),
  ('Montador I','MOD'),
  ('Armador','MOD'),
  ('Carpinteiro','MOD'),
  ('Encarregado de Montagem','MOD'),
  ('Líder de Montagem','MOD'),
  ('Meio Oficial Montador','MOD'),
  ('Mestre de Obras I','MOD'),
  ('Mestre de Obras II','MOD'),
  ('Operador Escavadeira','MOD'),
  ('Pedreiro','MOD')
ON CONFLICT (nome) DO NOTHING;

-- Garantir linha em categoria_salarios para todas
INSERT INTO public.categoria_salarios (categoria, salario, encargos)
SELECT nome, 0, 0 FROM public.categorias
ON CONFLICT (categoria) DO NOTHING;

-- FK com cascade entre categoria_salarios e categorias
ALTER TABLE public.categoria_salarios
  ADD CONSTRAINT categoria_salarios_categoria_fkey
  FOREIGN KEY (categoria) REFERENCES public.categorias(nome)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- Trigger: ao criar uma categoria, cria a linha em categoria_salarios automaticamente
CREATE OR REPLACE FUNCTION public.create_categoria_salario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.categoria_salarios (categoria, salario, encargos)
  VALUES (NEW.nome, 0, 0)
  ON CONFLICT (categoria) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER categorias_after_insert
  AFTER INSERT ON public.categorias
  FOR EACH ROW EXECUTE FUNCTION public.create_categoria_salario();