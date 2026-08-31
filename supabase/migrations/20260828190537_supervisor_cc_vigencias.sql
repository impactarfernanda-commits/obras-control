-- Vigencias de centro de custo de Supervisores a partir da competencia 25/08/2026.
-- Esta migration prepara a estrutura; nao cria vigencias iniciais nem altera alocacoes historicas.
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE public.funcionario_cc_vigencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE RESTRICT,
  obra_id uuid NOT NULL REFERENCES public.obras(id) ON DELETE RESTRICT,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  origem text NOT NULL CHECK (origem IN ('implantacao', 'transferencia', 'correcao')),
  observacao text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funcionario_cc_vigencias_periodo_valido
    CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT funcionario_cc_vigencias_observacao_limite
    CHECK (observacao IS NULL OR length(observacao) <= 1000),
  CONSTRAINT funcionario_cc_vigencias_inicio_unico UNIQUE (funcionario_id, vigencia_inicio),
  CONSTRAINT funcionario_cc_vigencias_sem_sobreposicao EXCLUDE USING gist (
    funcionario_id WITH =,
    daterange(vigencia_inicio, COALESCE(vigencia_fim, 'infinity'::date), '[]') WITH &&
  )
);

CREATE INDEX funcionario_cc_vigencias_funcionario_periodo_idx
  ON public.funcionario_cc_vigencias (funcionario_id, vigencia_inicio DESC, vigencia_fim);
CREATE INDEX funcionario_cc_vigencias_obra_periodo_idx
  ON public.funcionario_cc_vigencias (obra_id, vigencia_inicio DESC, vigencia_fim);

ALTER TABLE public.funcionario_cc_vigencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.funcionario_cc_vigencias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.funcionario_cc_vigencias TO authenticated;
GRANT ALL ON TABLE public.funcionario_cc_vigencias TO service_role;

CREATE POLICY "Internos consultam vigencias de CC de Supervisor"
  ON public.funcionario_cc_vigencias FOR SELECT TO authenticated
  USING (public.get_user_level((SELECT auth.uid())) >= 1);

CREATE OR REPLACE FUNCTION public.obras_control_categoria_supervisor(p_categoria text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT upper(regexp_replace(translate(btrim(COALESCE(p_categoria, '')),
    'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'), '\s+', ' ', 'g'))
    ~ '^SUPERVISOR([[:space:]]|[-/]|$)';
$function$;
REVOKE ALL ON FUNCTION public.obras_control_categoria_supervisor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obras_control_categoria_supervisor(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transferir_supervisor_centro_custo(
  p_funcionario_id uuid,
  p_novo_obra_id uuid,
  p_data_transferencia date,
  p_observacao text DEFAULT NULL
) RETURNS TABLE (
  funcionario_id uuid,
  obra_anterior_id uuid,
  obra_nova_id uuid,
  vigencia_anterior_inicio date,
  vigencia_anterior_fim date,
  vigencia_nova_inicio date,
  vigencia_nova_fim date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_funcionario public.funcionarios%ROWTYPE;
  v_anterior public.funcionario_cc_vigencias%ROWTYPE;
  v_nova public.funcionario_cc_vigencias%ROWTYPE;
  v_proxima_inicio date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticacao obrigatoria.' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'coordenador')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'diretor')
  ) THEN
    RAISE EXCEPTION 'Sem permissao para transferir centro de custo de Supervisor.' USING ERRCODE = '42501';
  END IF;
  IF p_funcionario_id IS NULL OR p_novo_obra_id IS NULL OR p_data_transferencia IS NULL THEN
    RAISE EXCEPTION 'Funcionario, centro de custo e data sao obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF p_data_transferencia < DATE '2026-08-25' THEN
    RAISE EXCEPTION 'Vigencias de Supervisor iniciam em 25/08/2026.' USING ERRCODE = '22023';
  END IF;
  IF p_observacao IS NOT NULL AND length(p_observacao) > 1000 THEN
    RAISE EXCEPTION 'Observacao deve ter no maximo 1000 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_funcionario
  FROM public.funcionarios f
  WHERE f.id = p_funcionario_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_funcionario.ativo OR v_funcionario.deleted_at IS NOT NULL
    OR v_funcionario.visivel_obras_control IS FALSE THEN
    RAISE EXCEPTION 'Funcionario inexistente, inativo ou fora do Obras Control.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.obras_control_categoria_supervisor(v_funcionario.categoria_mo) THEN
    RAISE EXCEPTION 'A regra de vigencia de CC e exclusiva para categoria Supervisor.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.obras o WHERE o.id = p_novo_obra_id) THEN
    RAISE EXCEPTION 'Centro de custo inexistente.' USING ERRCODE = 'P0002';
  END IF;

  -- A transferencia muda o CC somente a partir desta data. Usa exatamente a
  -- funcao canonica compartilhada pelos guards de alocacoes e registros_horas.
  IF public.competencia_fechada(p_data_transferencia) THEN
    RAISE EXCEPTION 'Competencia fechada nao permite alterar a vigencia de centro de custo.'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_anterior
  FROM public.funcionario_cc_vigencias v
  WHERE v.funcionario_id = p_funcionario_id
    AND v.vigencia_inicio <= p_data_transferencia
    AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= p_data_transferencia)
  ORDER BY v.vigencia_inicio DESC
  LIMIT 1
  FOR UPDATE;

  IF v_anterior.id IS NOT NULL AND v_anterior.obra_id = p_novo_obra_id THEN
    RAISE EXCEPTION 'O Supervisor ja esta vigente neste centro de custo na data informada.'
      USING ERRCODE = '23514';
  END IF;

  SELECT min(vigencia_inicio) INTO v_proxima_inicio
  FROM public.funcionario_cc_vigencias
  WHERE funcionario_id = p_funcionario_id AND vigencia_inicio > p_data_transferencia;

  IF EXISTS (
    SELECT 1 FROM public.funcionario_cc_vigencias
    WHERE funcionario_id = p_funcionario_id AND vigencia_inicio = p_data_transferencia
  ) THEN
    RAISE EXCEPTION 'Ja existe uma vigencia iniciada na data informada.' USING ERRCODE = '23505';
  END IF;

  IF v_anterior.id IS NOT NULL THEN
    UPDATE public.funcionario_cc_vigencias
      SET vigencia_fim = p_data_transferencia - 1,
          updated_by = auth.uid(), updated_at = now()
    WHERE id = v_anterior.id;
    v_anterior.vigencia_fim := p_data_transferencia - 1;
  END IF;

  INSERT INTO public.funcionario_cc_vigencias (
    funcionario_id, obra_id, vigencia_inicio, vigencia_fim, origem, observacao,
    created_by, updated_by
  ) VALUES (
    p_funcionario_id, p_novo_obra_id, p_data_transferencia,
    CASE WHEN v_proxima_inicio IS NULL THEN NULL ELSE v_proxima_inicio - 1 END,
    CASE WHEN v_anterior.id IS NULL THEN 'implantacao' ELSE 'transferencia' END,
    NULLIF(btrim(p_observacao), ''), auth.uid(), auth.uid()
  ) RETURNING * INTO v_nova;

  RETURN QUERY SELECT p_funcionario_id, v_anterior.obra_id, v_nova.obra_id,
    v_anterior.vigencia_inicio, v_anterior.vigencia_fim,
    v_nova.vigencia_inicio, v_nova.vigencia_fim;
END;
$function$;

REVOKE ALL ON FUNCTION public.transferir_supervisor_centro_custo(uuid,uuid,date,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferir_supervisor_centro_custo(uuid,uuid,date,text)
  TO authenticated, service_role;

COMMENT ON TABLE public.funcionario_cc_vigencias IS
  'Fonte de verdade do CC de Supervisores desde 25/08/2026; nao substitui alocacoes historicas.';

-- Defesa no banco: alocacao, jornada de horas e falta deixam de aceitar
-- Supervisor na nova regra. Somente ferias e folga de campo continuam permitidas.
CREATE OR REPLACE FUNCTION public.guard_supervisor_sem_apontamento_diario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE v_categoria text;
BEGIN
  IF NEW.data < DATE '2026-08-25' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'registros_horas' THEN
    IF NEW.tipo_registro IN ('ferias', 'folga_campo') THEN
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'alocacoes' THEN
    NULL;

  ELSE
    RAISE EXCEPTION 'guard_supervisor_sem_apontamento_diario nao suporta a tabela %.', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  SELECT categoria_mo INTO v_categoria FROM public.funcionarios WHERE id = NEW.funcionario_id;
  IF public.obras_control_categoria_supervisor(v_categoria) THEN
    RAISE EXCEPTION 'Supervisor e controlado por vigencia de centro de custo desde 25/08/2026.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_supervisor_sem_apontamento_diario()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_supervisor_sem_alocacao_diaria
  BEFORE INSERT OR UPDATE ON public.alocacoes
  FOR EACH ROW EXECUTE FUNCTION public.guard_supervisor_sem_apontamento_diario();
CREATE TRIGGER trg_guard_supervisor_sem_registro_diario
  BEFORE INSERT OR UPDATE ON public.registros_horas
  FOR EACH ROW EXECUTE FUNCTION public.guard_supervisor_sem_apontamento_diario();

COMMIT;
