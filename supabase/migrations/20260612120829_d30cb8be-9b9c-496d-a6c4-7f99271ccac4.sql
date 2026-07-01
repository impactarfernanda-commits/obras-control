
-- Notificacoes
CREATE TABLE public.notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  titulo text NOT NULL,
  mensagem text NOT NULL,
  severidade text NOT NULL DEFAULT 'info' CHECK (severidade IN ('info','warning','critical')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  lida boolean NOT NULL DEFAULT false,
  resolvida boolean NOT NULL DEFAULT false,
  resolvida_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolvida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notificacoes_user_idx ON public.notificacoes(user_id, created_at DESC);
CREATE INDEX notificacoes_lida_idx ON public.notificacoes(user_id, lida);
CREATE UNIQUE INDEX notificacoes_dedupe_idx ON public.notificacoes(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacoes TO authenticated;
GRANT ALL ON public.notificacoes TO service_role;

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuario ve suas notificacoes ou gerente ve todas"
  ON public.notificacoes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.get_user_level(auth.uid()) >= 2);

CREATE POLICY "Usuario atualiza suas notificacoes ou gerente todas"
  ON public.notificacoes FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.get_user_level(auth.uid()) >= 2)
  WITH CHECK (user_id = auth.uid() OR public.get_user_level(auth.uid()) >= 2);

CREATE POLICY "Usuario deleta suas notificacoes"
  ON public.notificacoes FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.get_user_level(auth.uid()) >= 2);

CREATE TRIGGER notificacoes_touch BEFORE UPDATE ON public.notificacoes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;

-- Configuracao por usuario
CREATE TABLE public.notificacao_config (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tipos_ativos jsonb NOT NULL DEFAULT '{"sem_alocacao":true,"horas_extras":true,"custo_acima_media":true,"ausencia_consecutiva":true,"obra_sem_lancamento":true}'::jsonb,
  thresholds jsonb NOT NULL DEFAULT '{"horas_extras_semanal":15,"pct_acima_media":120,"dias_ausencia":5,"dias_sem_lancamento":3,"dias_sem_alocacao":30}'::jsonb,
  frequencia_email text NOT NULL DEFAULT 'realtime' CHECK (frequencia_email IN ('realtime','diario','semanal','desativado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificacao_config TO authenticated;
GRANT ALL ON public.notificacao_config TO service_role;

ALTER TABLE public.notificacao_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuario gerencia sua config"
  ON public.notificacao_config FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER notificacao_config_touch BEFORE UPDATE ON public.notificacao_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
