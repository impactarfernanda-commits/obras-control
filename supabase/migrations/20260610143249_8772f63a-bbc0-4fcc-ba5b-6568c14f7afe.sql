
-- Enum de roles
CREATE TYPE public.app_role AS ENUM ('assistente','supervisor','coordenador','gerente','diretor');

-- users_profiles
CREATE TABLE public.users_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.users_profiles TO authenticated;
GRANT ALL ON public.users_profiles TO service_role;
ALTER TABLE public.users_profiles ENABLE ROW LEVEL SECURITY;

-- user_roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Funções utilitárias (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Nível: 3=diretor, 2=gerente, 1=demais
CREATE OR REPLACE FUNCTION public.get_user_level(_user_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'diretor') THEN 3
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'gerente') THEN 2
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id) THEN 1
    ELSE 0
  END
$$;

-- obras
CREATE TABLE public.obras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  status text NOT NULL DEFAULT 'ativa',
  data_inicio date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obras TO authenticated;
GRANT ALL ON public.obras TO service_role;
ALTER TABLE public.obras ENABLE ROW LEVEL SECURITY;

-- funcionarios
CREATE TABLE public.funcionarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cpf text,
  salario numeric(12,2) NOT NULL DEFAULT 0,
  encargos numeric(12,2) NOT NULL DEFAULT 0,
  categoria_mo text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.funcionarios TO authenticated;
GRANT ALL ON public.funcionarios TO service_role;
ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;

-- user_permissions
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  obra_id uuid NOT NULL REFERENCES public.obras(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, obra_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Policies: users_profiles
CREATE POLICY "Ver próprio perfil ou gerente+" ON public.users_profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.get_user_level(auth.uid()) >= 2);
CREATE POLICY "Inserir próprio perfil" ON public.users_profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "Atualizar próprio perfil" ON public.users_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'diretor'));

-- Policies: user_roles
CREATE POLICY "Ver próprio role ou diretor" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'diretor'));

-- Policies: obras
CREATE POLICY "Ler obras (gerente+ ou alocado)" ON public.obras FOR SELECT TO authenticated
  USING (
    public.get_user_level(auth.uid()) >= 2
    OR EXISTS (SELECT 1 FROM public.user_permissions p WHERE p.obra_id = obras.id AND p.user_id = auth.uid())
  );
CREATE POLICY "Criar obras (autenticados)" ON public.obras FOR INSERT TO authenticated
  WITH CHECK (public.get_user_level(auth.uid()) >= 1);
CREATE POLICY "Atualizar obras (diretor ou alocado)" ON public.obras FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'diretor')
    OR EXISTS (SELECT 1 FROM public.user_permissions p WHERE p.obra_id = obras.id AND p.user_id = auth.uid())
  );
CREATE POLICY "Excluir obras (diretor)" ON public.obras FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'diretor'));

-- Policies: funcionarios
CREATE POLICY "Ler funcionarios (autenticados)" ON public.funcionarios FOR SELECT TO authenticated
  USING (public.get_user_level(auth.uid()) >= 1);
CREATE POLICY "Inserir funcionarios (autenticados)" ON public.funcionarios FOR INSERT TO authenticated
  WITH CHECK (public.get_user_level(auth.uid()) >= 1);
CREATE POLICY "Atualizar funcionarios (autenticados)" ON public.funcionarios FOR UPDATE TO authenticated
  USING (public.get_user_level(auth.uid()) >= 1);
CREATE POLICY "Excluir funcionarios (diretor)" ON public.funcionarios FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'diretor'));

-- Policies: user_permissions
CREATE POLICY "Ver permissões próprias ou diretor" ON public.user_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.get_user_level(auth.uid()) >= 2);
CREATE POLICY "Gerenciar permissões (diretor)" ON public.user_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'diretor'))
  WITH CHECK (public.has_role(auth.uid(),'diretor'));

-- Trigger: handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users_profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'assistente');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
