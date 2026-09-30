-- Reativacao corrige um desligamento lancado por engano; nao representa readmissao.
-- A autorizacao interna e criada e consumida dentro da mesma transacao. A role
-- authenticated nao possui privilegio nem policy para fabricar esse contexto.
CREATE TABLE public.funcionario_reativacao_autorizacoes (
  transacao_id bigint NOT NULL,
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (transacao_id, funcionario_id, created_by)
);

ALTER TABLE public.funcionario_reativacao_autorizacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.funcionario_reativacao_autorizacoes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.funcionario_reativacao_autorizacoes TO service_role;

CREATE TABLE public.funcionario_estado_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE RESTRICT,
  acao text NOT NULL CHECK (acao = 'reativacao'),
  ativo_anterior boolean NOT NULL,
  ativo_novo boolean NOT NULL,
  data_desligamento_anterior date,
  data_desligamento_novo date,
  deleted_at_anterior timestamptz,
  deleted_at_novo timestamptz,
  motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 10 AND 1000 AND motivo = btrim(motivo)),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX funcionario_estado_auditoria_funcionario_data_idx
  ON public.funcionario_estado_auditoria (funcionario_id, created_at DESC);

ALTER TABLE public.funcionario_estado_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.funcionario_estado_auditoria FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.funcionario_estado_auditoria TO authenticated;
GRANT ALL ON TABLE public.funcionario_estado_auditoria TO service_role;

CREATE POLICY funcionario_estado_auditoria_select_gerente_diretor
  ON public.funcionario_estado_auditoria
  FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'gerente')
    OR public.has_role((SELECT auth.uid()), 'diretor')
  );

COMMENT ON TABLE public.funcionario_estado_auditoria IS
  'Historico imutavel de correcoes auditadas do estado de funcionarios.';

-- Mantem todas as regras atuais e exige uma autorizacao privada, transacional
-- e consumivel criada pela RPC para a transicao estrita de reativacao.
CREATE OR REPLACE FUNCTION public.guard_estado_funcionario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  ultima_alocacao date;
  usuario_interno boolean;
  gerente_ou_diretor boolean;
  desligamento_inicial boolean;
  reativacao boolean;
  autorizacoes_consumidas integer := 0;
BEGIN
  usuario_interno :=
    public.has_role(auth.uid(), 'assistente')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'coordenador')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'diretor');
  gerente_ou_diretor :=
    public.has_role(auth.uid(), 'gerente') OR public.has_role(auth.uid(), 'diretor');

  desligamento_inicial :=
    usuario_interno
    AND OLD.ativo IS TRUE
    AND NEW.ativo IS FALSE
    AND OLD.data_desligamento IS NULL
    AND NEW.data_desligamento IS NOT NULL
    AND OLD.deleted_at IS NULL
    AND NEW.deleted_at IS NULL
    AND OLD.deleted_by IS NULL
    AND NEW.deleted_by IS NULL;

  reativacao :=
    OLD.ativo IS FALSE
    AND NEW.ativo IS TRUE
    AND OLD.data_desligamento IS NOT NULL
    AND NEW.data_desligamento IS NULL
    AND OLD.deleted_at IS NULL
    AND NEW.deleted_at IS NULL
    AND OLD.deleted_by IS NULL
    AND NEW.deleted_by IS NULL;

  IF reativacao THEN
    DELETE FROM public.funcionario_reativacao_autorizacoes a
    WHERE a.transacao_id = txid_current()
      AND a.funcionario_id = NEW.id
      AND a.created_by = auth.uid();
    GET DIAGNOSTICS autorizacoes_consumidas = ROW_COUNT;
    IF autorizacoes_consumidas <> 1 THEN
      RAISE EXCEPTION 'REATIVACAO_FUNCIONARIO_SOMENTE_VIA_RPC' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (OLD.ativo, OLD.data_desligamento, OLD.deleted_at, OLD.deleted_by)
       IS DISTINCT FROM
     (NEW.ativo, NEW.data_desligamento, NEW.deleted_at, NEW.deleted_by)
     AND NOT gerente_ou_diretor
     AND NOT desligamento_inicial THEN
    RAISE EXCEPTION 'ALTERACAO_ESTADO_FUNCIONARIO_RESTRITA_GERENTE_DIRETOR';
  END IF;

  IF OLD.deleted_at IS NOT NULL
     AND OLD.data_desligamento IS DISTINCT FROM NEW.data_desligamento THEN
    RAISE EXCEPTION 'Nao e permitido editar desligamento de funcionario excluido';
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_by := coalesce(NEW.deleted_by, auth.uid());
  ELSE
    NEW.deleted_by := NULL;
  END IF;

  IF NOT NEW.ativo AND NEW.deleted_at IS NULL AND NEW.data_desligamento IS NULL THEN
    RAISE EXCEPTION 'DATA_DESLIGAMENTO_OBRIGATORIA';
  END IF;
  IF NEW.ativo AND NEW.data_desligamento IS NOT NULL THEN
    RAISE EXCEPTION 'Funcionario ativo nao pode possuir data de desligamento';
  END IF;

  IF (NEW.data_desligamento IS DISTINCT FROM OLD.data_desligamento
      OR NEW.data_admissao IS DISTINCT FROM OLD.data_admissao)
     AND NEW.data_desligamento IS NOT NULL
     AND NEW.deleted_at IS NULL THEN
    IF NEW.data_admissao IS NOT NULL AND NEW.data_desligamento < NEW.data_admissao THEN
      RAISE EXCEPTION 'DATA_DESLIGAMENTO_ANTERIOR_ADMISSAO';
    END IF;

    SELECT max(a.data) INTO ultima_alocacao
    FROM public.alocacoes a
    WHERE a.funcionario_id = NEW.id;

    IF ultima_alocacao IS NOT NULL AND NEW.data_desligamento < ultima_alocacao THEN
      RAISE EXCEPTION 'ULTIMA_ALOCACAO_FUNCIONARIO:%', to_char(ultima_alocacao, 'DD/MM/YYYY');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_estado_funcionario() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reativar_funcionario(
  p_funcionario_id uuid,
  p_motivo text
)
RETURNS TABLE (funcionario_id uuid, ativo boolean, data_desligamento date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid := auth.uid();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_funcionario public.funcionarios%ROWTYPE;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'AUTENTICACAO_OBRIGATORIA' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(v_usuario, 'gerente') OR public.has_role(v_usuario, 'diretor')
  ) THEN
    RAISE EXCEPTION 'REATIVACAO_RESTRITA_GERENTE_DIRETOR' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'MOTIVO_REATIVACAO_MINIMO_10_CARACTERES' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_motivo) > 1000 THEN
    RAISE EXCEPTION 'MOTIVO_REATIVACAO_MAXIMO_1000_CARACTERES' USING ERRCODE = '22023';
  END IF;

  SELECT f.* INTO v_funcionario
  FROM public.funcionarios f
  WHERE f.id = p_funcionario_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FUNCIONARIO_NAO_ENCONTRADO' USING ERRCODE = 'P0002';
  END IF;
  IF v_funcionario.ativo IS NOT FALSE THEN
    RAISE EXCEPTION 'FUNCIONARIO_JA_ATIVO' USING ERRCODE = 'P0001';
  END IF;
  IF v_funcionario.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FUNCIONARIO_EXCLUIDO_NAO_PODE_SER_REATIVADO' USING ERRCODE = 'P0001';
  END IF;
  IF v_funcionario.data_desligamento IS NULL THEN
    RAISE EXCEPTION 'FUNCIONARIO_SEM_DATA_DESLIGAMENTO' USING ERRCODE = 'P0001';
  END IF;
  IF v_funcionario.visivel_obras_control IS NOT TRUE THEN
    RAISE EXCEPTION 'FUNCIONARIO_FORA_OBRAS_CONTROL' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.funcionario_reativacao_autorizacoes (
    transacao_id, funcionario_id, created_by
  ) VALUES (
    txid_current(), v_funcionario.id, v_usuario
  );

  UPDATE public.funcionarios f
  SET ativo = true,
      data_desligamento = NULL
  WHERE f.id = v_funcionario.id;

  INSERT INTO public.funcionario_estado_auditoria (
    funcionario_id, acao, ativo_anterior, ativo_novo,
    data_desligamento_anterior, data_desligamento_novo,
    deleted_at_anterior, deleted_at_novo, motivo, created_by
  ) VALUES (
    v_funcionario.id, 'reativacao', v_funcionario.ativo, true,
    v_funcionario.data_desligamento, NULL,
    v_funcionario.deleted_at, v_funcionario.deleted_at, v_motivo, v_usuario
  );

  RETURN QUERY SELECT v_funcionario.id, true, NULL::date;
END;
$$;

REVOKE ALL ON FUNCTION public.reativar_funcionario(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reativar_funcionario(uuid,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.reativar_funcionario(uuid,text) IS
  'Corrige desligamento indevido, preserva o mesmo vinculo e registra motivo e autor atomicamente.';
