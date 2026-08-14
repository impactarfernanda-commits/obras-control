-- Linhas de base de HH/custo. Valores financeiros permanecem server-side e
-- somente gerente/diretor recebem acesso direto.
CREATE TABLE public.planejamento_hh_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id uuid NOT NULL REFERENCES public.obras(id) ON DELETE RESTRICT,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  versao integer NOT NULL CHECK (versao > 0),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'ativa', 'inativa')),
  arquivo_origem text NOT NULL CHECK (btrim(arquivo_origem) <> ''),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid NOT NULL REFERENCES auth.users(id),
  ativada_em timestamptz,
  ativa boolean NOT NULL DEFAULT false,
  UNIQUE (obra_id, versao),
  CHECK ((ativa AND status = 'ativa' AND ativada_em IS NOT NULL) OR (NOT ativa AND status <> 'ativa'))
);

CREATE UNIQUE INDEX planejamento_hh_baselines_uma_ativa_por_obra_idx
  ON public.planejamento_hh_baselines (obra_id) WHERE ativa;
CREATE INDEX planejamento_hh_baselines_obra_criado_idx
  ON public.planejamento_hh_baselines (obra_id, criado_em DESC);

CREATE TABLE public.planejamento_hh_mapeamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcao_orcamento_normalizada text NOT NULL CHECK (btrim(funcao_orcamento_normalizada) <> ''),
  funcao_orcamento_original text NOT NULL CHECK (btrim(funcao_orcamento_original) <> ''),
  categoria_mo text NOT NULL REFERENCES public.categorias(nome) ON UPDATE CASCADE ON DELETE RESTRICT,
  tipo_mo text NOT NULL CHECK (tipo_mo IN ('MOI', 'MOD')),
  confirmado_por uuid NOT NULL REFERENCES auth.users(id),
  confirmado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (funcao_orcamento_normalizada, categoria_mo, tipo_mo)
);
CREATE INDEX planejamento_hh_mapeamentos_chave_idx
  ON public.planejamento_hh_mapeamentos (funcao_orcamento_normalizada, tipo_mo);

CREATE TABLE public.planejamento_hh_baseline_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id uuid NOT NULL REFERENCES public.planejamento_hh_baselines(id) ON DELETE CASCADE,
  funcao_orcamento text NOT NULL CHECK (btrim(funcao_orcamento) <> ''),
  funcao_orcamento_normalizada text NOT NULL CHECK (btrim(funcao_orcamento_normalizada) <> ''),
  mapeamento_id uuid REFERENCES public.planejamento_hh_mapeamentos(id) ON DELETE SET NULL,
  categoria_mo_mapeada text REFERENCES public.categorias(nome) ON UPDATE CASCADE ON DELETE RESTRICT,
  tipo_mo text NOT NULL CHECK (tipo_mo IN ('MOI', 'MOD')),
  hh_previsto numeric(16,4) NOT NULL CHECK (hh_previsto >= 0),
  custo_previsto numeric(16,2) NOT NULL CHECK (custo_previsto >= 0),
  origem text NOT NULL CHECK (origem IN ('MO', 'EAP/CPUs')),
  metadata_calculo jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (baseline_id, funcao_orcamento_normalizada, tipo_mo)
);
CREATE INDEX planejamento_hh_itens_baseline_idx
  ON public.planejamento_hh_baseline_itens (baseline_id);
CREATE INDEX planejamento_hh_itens_categoria_idx
  ON public.planejamento_hh_baseline_itens (categoria_mo_mapeada, tipo_mo);

ALTER TABLE public.planejamento_hh_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planejamento_hh_baseline_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planejamento_hh_mapeamentos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.planejamento_hh_baselines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.planejamento_hh_baseline_itens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.planejamento_hh_mapeamentos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.planejamento_hh_baselines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planejamento_hh_baseline_itens TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.planejamento_hh_mapeamentos TO authenticated;

CREATE POLICY "Financeiro gerencia baselines HH"
  ON public.planejamento_hh_baselines FOR ALL TO authenticated
  USING (public.can_view_salario((SELECT auth.uid())))
  WITH CHECK (public.can_view_salario((SELECT auth.uid())) AND criado_por = (SELECT auth.uid()));
CREATE POLICY "Financeiro gerencia itens baseline HH"
  ON public.planejamento_hh_baseline_itens FOR ALL TO authenticated
  USING (public.can_view_salario((SELECT auth.uid())))
  WITH CHECK (public.can_view_salario((SELECT auth.uid())));
CREATE POLICY "Financeiro gerencia mapeamentos HH"
  ON public.planejamento_hh_mapeamentos FOR ALL TO authenticated
  USING (public.can_view_salario((SELECT auth.uid())))
  WITH CHECK (public.can_view_salario((SELECT auth.uid())) AND confirmado_por = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.ativar_planejamento_hh_baseline(p_baseline_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE v_obra_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_salario(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para ativar baseline.' USING ERRCODE = '42501';
  END IF;
  SELECT obra_id INTO v_obra_id FROM public.planejamento_hh_baselines
    WHERE id = p_baseline_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Baseline nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.planejamento_hh_baselines
     SET ativa = false, status = 'inativa'
   WHERE obra_id = v_obra_id AND ativa AND id <> p_baseline_id;
  UPDATE public.planejamento_hh_baselines
     SET ativa = true, status = 'ativa', ativada_em = now()
   WHERE id = p_baseline_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ativar_planejamento_hh_baseline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ativar_planejamento_hh_baseline(uuid) TO authenticated;

-- Historico financeiro por vigencia. O custo previsto permanece nas tabelas
-- acima; esta estrutura congela somente os componentes do custo realizado.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE public.funcionario_custos_vigencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcionario_id uuid NOT NULL REFERENCES public.funcionarios(id) ON DELETE RESTRICT,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  categoria_mo text NOT NULL REFERENCES public.categorias(nome) ON UPDATE CASCADE ON DELETE RESTRICT,
  salario numeric(16,2) NOT NULL CHECK (salario >= 0),
  encargos_cadastrados numeric(16,2) NOT NULL CHECK (encargos_cadastrados >= 0),
  encargos_calculados numeric(16,2) NOT NULL CHECK (encargos_calculados >= 0),
  provisao_13 numeric(16,2) NOT NULL CHECK (provisao_13 >= 0),
  provisao_aviso_previo numeric(16,2) NOT NULL CHECK (provisao_aviso_previo >= 0),
  provisao_ferias numeric(16,2) NOT NULL CHECK (provisao_ferias >= 0),
  assistencia_medica numeric(16,2) NOT NULL CHECK (assistencia_medica >= 0),
  assistencia_odontologica numeric(16,2) NOT NULL CHECK (assistencia_odontologica >= 0),
  vale_alimentacao numeric(16,2) NOT NULL CHECK (vale_alimentacao >= 0),
  multibeneficio numeric(16,2) NOT NULL CHECK (multibeneficio >= 0),
  seguro_vida numeric(16,2) NOT NULL CHECK (seguro_vida >= 0),
  custo_mensal_total numeric(16,2) NOT NULL CHECK (custo_mensal_total >= 0),
  origem text NOT NULL CHECK (origem IN ('implantacao', 'funcionario', 'beneficios', 'categoria_salario')),
  status_historico text NOT NULL CHECK (status_historico IN ('estimado_inicial', 'apurado_por_vigencia')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE (funcionario_id, vigencia_inicio),
  EXCLUDE USING gist (
    funcionario_id WITH =,
    daterange(vigencia_inicio, COALESCE(vigencia_fim, 'infinity'::date), '[]') WITH &&
  )
);
CREATE INDEX funcionario_custos_vigencias_busca_idx
  ON public.funcionario_custos_vigencias (funcionario_id, vigencia_inicio DESC);

ALTER TABLE public.funcionario_custos_vigencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.funcionario_custos_vigencias FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.funcionario_custos_vigencias TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_funcionario_custo_vigencia(
  p_funcionario_id uuid,
  p_vigencia_inicio date,
  p_origem text,
  p_status_historico text DEFAULT 'apurado_por_vigencia'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions AS $fn$
DECLARE
  v_funcionario public.funcionarios%ROWTYPE;
  v_beneficios public.beneficios_config%ROWTYPE;
  v_seguro numeric := 0;
  v_encargos numeric;
  v_prov_13 numeric;
  v_prov_aviso numeric;
  v_prov_ferias numeric;
  v_id uuid;
BEGIN
  IF p_vigencia_inicio IS NULL THEN RAISE EXCEPTION 'Vigencia inicial obrigatoria.'; END IF;
  IF p_origem NOT IN ('implantacao', 'funcionario', 'beneficios', 'categoria_salario') THEN
    RAISE EXCEPTION 'Origem de vigencia invalida.';
  END IF;
  IF p_status_historico NOT IN ('estimado_inicial', 'apurado_por_vigencia') THEN
    RAISE EXCEPTION 'Status historico invalido.';
  END IF;
  IF p_status_historico = 'apurado_por_vigencia' AND EXISTS (
    SELECT 1 FROM public.fechamentos_competencia
     WHERE fechada AND p_vigencia_inicio BETWEEN data_inicio AND data_fim
  ) THEN
    RAISE EXCEPTION 'Competencia fechada nao permite substituir vigencia financeira.' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_funcionario FROM public.funcionarios
   WHERE id = p_funcionario_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funcionario nao encontrado.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_beneficios FROM public.beneficios_config LIMIT 1;
  SELECT COALESCE((
    SELECT seguro_vida FROM public.categoria_salarios
     WHERE categoria = v_funcionario.categoria_mo
  ), 0) INTO v_seguro;
  v_encargos := round(v_funcionario.salario * 0.368, 2);
  v_prov_13 := round((v_funcionario.salario + v_encargos) / 12, 2);
  v_prov_aviso := v_prov_13;
  v_prov_ferias := round(v_prov_13 + v_prov_13 / 3, 2);

  -- Mais de uma mudanca no mesmo dia substitui a versao daquele dia somente
  -- enquanto a competencia estiver aberta. Periodos anteriores permanecem intactos.
  DELETE FROM public.funcionario_custos_vigencias
   WHERE funcionario_id = p_funcionario_id AND vigencia_inicio = p_vigencia_inicio;
  UPDATE public.funcionario_custos_vigencias
     SET vigencia_fim = p_vigencia_inicio - 1
   WHERE funcionario_id = p_funcionario_id
     AND vigencia_inicio < p_vigencia_inicio
     AND (vigencia_fim IS NULL OR vigencia_fim >= p_vigencia_inicio);

  INSERT INTO public.funcionario_custos_vigencias (
    funcionario_id, vigencia_inicio, categoria_mo, salario,
    encargos_cadastrados, encargos_calculados, provisao_13,
    provisao_aviso_previo, provisao_ferias, assistencia_medica,
    assistencia_odontologica, vale_alimentacao, multibeneficio, seguro_vida,
    custo_mensal_total, origem, status_historico, created_by
  ) VALUES (
    p_funcionario_id, p_vigencia_inicio, v_funcionario.categoria_mo,
    v_funcionario.salario, COALESCE(v_funcionario.encargos, 0), v_encargos,
    v_prov_13, v_prov_aviso, v_prov_ferias,
    COALESCE(v_beneficios.assistencia_medica, 0),
    COALESCE(v_beneficios.assistencia_odontologica, 0),
    COALESCE(v_beneficios.vale_alimentacao, 0),
    COALESCE(v_beneficios.multibeneficio, 0), v_seguro,
    round(v_funcionario.salario + v_encargos + v_prov_13 + v_prov_aviso + v_prov_ferias
      + COALESCE(v_beneficios.assistencia_medica, 0)
      + COALESCE(v_beneficios.assistencia_odontologica, 0)
      + COALESCE(v_beneficios.vale_alimentacao, 0)
      + COALESCE(v_beneficios.multibeneficio, 0) + v_seguro, 2),
    p_origem, p_status_historico, auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.registrar_funcionario_custo_vigencia(uuid,date,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_funcionario_custo_vigencia(uuid,date,text,text)
  TO service_role;

-- Congela a estimativa disponivel na implantacao desde a primeira evidencia
-- operacional; nao afirma que os componentes eram os valores reais daquela epoca.
DO $inicial$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT f.id,
      LEAST(
        COALESCE((SELECT min(rh.data) FROM public.registros_horas rh WHERE rh.funcionario_id = f.id), 'infinity'::date),
        COALESCE((SELECT min(a.data) FROM public.alocacoes a WHERE a.funcionario_id = f.id), 'infinity'::date),
        COALESCE(f.data_admissao, f.created_at::date, current_date)
      ) AS inicio
    FROM public.funcionarios f
    WHERE f.visivel_obras_control IS NOT FALSE
  LOOP
    PERFORM public.registrar_funcionario_custo_vigencia(r.id, r.inicio, 'implantacao', 'estimado_inicial');
  END LOOP;
END;
$inicial$;

CREATE OR REPLACE FUNCTION public.snapshot_custo_funcionario_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF NEW.visivel_obras_control IS NOT FALSE AND (
    TG_OP = 'INSERT' OR NEW.salario IS DISTINCT FROM OLD.salario
    OR NEW.encargos IS DISTINCT FROM OLD.encargos
    OR NEW.categoria_mo IS DISTINCT FROM OLD.categoria_mo
  ) THEN
    PERFORM public.registrar_funcionario_custo_vigencia(NEW.id, current_date, 'funcionario');
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER snapshot_custo_funcionario
AFTER INSERT OR UPDATE OF salario, encargos, categoria_mo, visivel_obras_control
ON public.funcionarios FOR EACH ROW EXECUTE FUNCTION public.snapshot_custo_funcionario_trigger();

CREATE OR REPLACE FUNCTION public.snapshot_custo_categoria_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE r record;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.seguro_vida IS DISTINCT FROM OLD.seguro_vida THEN
    FOR r IN SELECT id FROM public.funcionarios
      WHERE categoria_mo = NEW.categoria AND visivel_obras_control IS NOT FALSE
    LOOP
      PERFORM public.registrar_funcionario_custo_vigencia(r.id, current_date, 'categoria_salario');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER snapshot_custo_categoria
AFTER INSERT OR UPDATE OF seguro_vida ON public.categoria_salarios
FOR EACH ROW EXECUTE FUNCTION public.snapshot_custo_categoria_trigger();

CREATE OR REPLACE FUNCTION public.snapshot_custo_beneficios_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.funcionarios WHERE visivel_obras_control IS NOT FALSE
  LOOP
    PERFORM public.registrar_funcionario_custo_vigencia(r.id, current_date, 'beneficios');
  END LOOP;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER snapshot_custo_beneficios
AFTER INSERT OR UPDATE OF assistencia_medica, assistencia_odontologica, vale_alimentacao, multibeneficio
ON public.beneficios_config FOR EACH STATEMENT EXECUTE FUNCTION public.snapshot_custo_beneficios_trigger();

REVOKE ALL ON FUNCTION public.snapshot_custo_funcionario_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_custo_categoria_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_custo_beneficios_trigger() FROM PUBLIC, anon, authenticated;
