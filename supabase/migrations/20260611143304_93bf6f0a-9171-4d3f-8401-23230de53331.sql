
-- Tabela de salários por categoria
CREATE TABLE public.categoria_salarios (
  categoria text PRIMARY KEY,
  salario numeric NOT NULL DEFAULT 0 CHECK (salario >= 0),
  encargos numeric NOT NULL DEFAULT 0 CHECK (encargos >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categoria_salarios TO authenticated;
GRANT ALL ON public.categoria_salarios TO service_role;

ALTER TABLE public.categoria_salarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ler categoria_salarios (autenticados)" ON public.categoria_salarios
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Inserir categoria_salarios (gerente/diretor)" ON public.categoria_salarios
  FOR INSERT TO authenticated WITH CHECK (public.can_view_salario(auth.uid()));
CREATE POLICY "Atualizar categoria_salarios (gerente/diretor)" ON public.categoria_salarios
  FOR UPDATE TO authenticated USING (public.can_view_salario(auth.uid())) WITH CHECK (public.can_view_salario(auth.uid()));
CREATE POLICY "Excluir categoria_salarios (gerente/diretor)" ON public.categoria_salarios
  FOR DELETE TO authenticated USING (public.can_view_salario(auth.uid()));

CREATE TRIGGER touch_categoria_salarios_updated_at
  BEFORE UPDATE ON public.categoria_salarios
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed das 19 categorias
INSERT INTO public.categoria_salarios (categoria) VALUES
  ('Assistente Eng I'),('Assistente Eng II'),('Supervisor I'),('Supervisor II'),
  ('Supervisor III'),('Coordenador'),('Assist Admin'),('Técnico Segurança'),
  ('Ajudante'),('Montador I'),('Armador'),('Carpinteiro'),
  ('Encarregado de Montagem'),('Líder de Montagem'),('Meio Oficial Montador'),
  ('Mestre de Obras I'),('Mestre de Obras II'),('Operador Escavadeira'),('Pedreiro')
ON CONFLICT (categoria) DO NOTHING;

-- Trigger: bloqueia alteração de salário/encargos em funcionarios por quem não pode ver salários
CREATE OR REPLACE FUNCTION public.guard_funcionarios_salario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.salario IS DISTINCT FROM OLD.salario OR NEW.encargos IS DISTINCT FROM OLD.encargos)
     AND NOT public.can_view_salario(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas gerentes/diretores podem alterar salário ou encargos';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_funcionarios_salario_update
  BEFORE UPDATE ON public.funcionarios
  FOR EACH ROW EXECUTE FUNCTION public.guard_funcionarios_salario();
