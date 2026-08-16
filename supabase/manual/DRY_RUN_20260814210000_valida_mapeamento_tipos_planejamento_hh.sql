BEGIN;

-- Execute primeiro em ambiente que ja contenha a migration de planejamento.
-- Corpo integral da migration incremental.
CREATE OR REPLACE FUNCTION public.ativar_planejamento_hh_baseline(p_baseline_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE v_obra_id uuid; v_categoria text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_view_salario(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao para ativar baseline.' USING ERRCODE = '42501';
  END IF;
  SELECT obra_id INTO v_obra_id FROM public.planejamento_hh_baselines
    WHERE id = p_baseline_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Baseline nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT categoria_mo_mapeada INTO v_categoria
    FROM public.planejamento_hh_baseline_itens
   WHERE baseline_id = p_baseline_id AND categoria_mo_mapeada IS NOT NULL
   GROUP BY categoria_mo_mapeada
  HAVING count(DISTINCT tipo_mo) > 1
   ORDER BY categoria_mo_mapeada
   LIMIT 1;
  IF v_categoria IS NOT NULL THEN
    RAISE EXCEPTION
      'A categoria % esta associada simultaneamente a itens MOI e MOD. O Obras Control nao possui informacao suficiente para dividir o HH realizado.',
      v_categoria USING ERRCODE = '23514';
  END IF;
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

DO $cenarios$
DECLARE
  v_user uuid;
  v_obra uuid;
  v_versao integer;
  v_baseline uuid;
  v_bloqueou boolean := false;
  v_previsto numeric;
  v_realizado numeric;
  v_categoria_moi text;
  v_categoria_mod text;
BEGIN
  SELECT ur.user_id INTO v_user FROM public.user_roles ur
   WHERE ur.role IN ('gerente', 'diretor') ORDER BY ur.user_id LIMIT 1;
  SELECT id INTO v_obra FROM public.obras ORDER BY id LIMIT 1;
  IF v_user IS NULL OR v_obra IS NULL THEN
    RAISE EXCEPTION 'Dry-run requer um gerente/diretor e uma obra existentes';
  END IF;
  SELECT nome INTO v_categoria_moi
    FROM public.categorias WHERE tipo = 'MOI' ORDER BY nome LIMIT 1;
  SELECT nome INTO v_categoria_mod
    FROM public.categorias WHERE tipo = 'MOD' ORDER BY nome LIMIT 1;
  IF v_categoria_moi IS NULL OR v_categoria_mod IS NULL THEN
    RAISE EXCEPTION 'Dry-run requer ao menos uma categoria MOI e uma MOD no catalogo';
  END IF;
  RAISE NOTICE 'Categorias reais selecionadas: MOI=%, MOD=%', v_categoria_moi, v_categoria_mod;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  SELECT COALESCE(max(versao), 0) + 100 INTO v_versao
    FROM public.planejamento_hh_baselines WHERE obra_id = v_obra;

  -- A: item MOI pode mapear uma categoria real classificada como MOD.
  INSERT INTO public.planejamento_hh_baselines
    (obra_id, nome, versao, arquivo_origem, criado_por)
  VALUES (v_obra, 'DRY A MOI para MOD', v_versao, 'dry.xlsx', v_user)
  RETURNING id INTO v_baseline;
  INSERT INTO public.planejamento_hh_baseline_itens
    (baseline_id, funcao_orcamento, funcao_orcamento_normalizada,
     categoria_mo_mapeada, tipo_mo, hh_previsto, custo_previsto, origem)
  VALUES (v_baseline, 'Item orcamentario MOI', 'item orcamentario moi',
          v_categoria_mod, 'MOI', 990, 49036.23, 'MO');
  PERFORM public.ativar_planejamento_hh_baseline(v_baseline);

  -- A2: a divergencia inversa tambem e valida: item MOD -> categoria MOI.
  INSERT INTO public.planejamento_hh_baselines
    (obra_id, nome, versao, arquivo_origem, criado_por)
  VALUES (v_obra, 'DRY A2 MOD para MOI', v_versao + 1, 'dry.xlsx', v_user)
  RETURNING id INTO v_baseline;
  INSERT INTO public.planejamento_hh_baseline_itens
    (baseline_id, funcao_orcamento, funcao_orcamento_normalizada,
     categoria_mo_mapeada, tipo_mo, hh_previsto, custo_previsto, origem)
  VALUES (v_baseline, 'Item orcamentario MOD', 'item orcamentario mod',
          v_categoria_moi, 'MOD', 100, 10, 'MO');
  PERFORM public.ativar_planejamento_hh_baseline(v_baseline);

  -- B/C: repeticao no mesmo tipo e permitida. O CTE reproduz a consolidacao:
  -- previsto soma por categoria+tipo e realizado aparece uma unica vez.
  WITH itens(categoria, tipo, hh) AS (VALUES
    (v_categoria_mod, 'MOD'::text, 100::numeric),
    (v_categoria_mod, 'MOD'::text, 50::numeric)
  ), realizado(categoria, hh) AS (VALUES (v_categoria_mod, 20::numeric)),
  consolidado AS (
    SELECT i.categoria, i.tipo, sum(i.hh) AS previsto,
           (SELECT r.hh FROM realizado r WHERE r.categoria = i.categoria) AS realizado
      FROM itens i GROUP BY i.categoria, i.tipo
  ) SELECT previsto, realizado INTO v_previsto, v_realizado FROM consolidado;
  IF v_previsto <> 150 OR v_realizado <> 20 THEN
    RAISE EXCEPTION 'Consolidacao MOD duplicou ou perdeu valores';
  END IF;

  INSERT INTO public.planejamento_hh_baselines
    (obra_id, nome, versao, arquivo_origem, criado_por)
  VALUES (v_obra, 'DRY B mesmo tipo MOD', v_versao + 2, 'dry.xlsx', v_user)
  RETURNING id INTO v_baseline;
  INSERT INTO public.planejamento_hh_baseline_itens
    (baseline_id, funcao_orcamento, funcao_orcamento_normalizada,
     categoria_mo_mapeada, tipo_mo, hh_previsto, custo_previsto, origem)
  VALUES
    (v_baseline, 'Ajudante civil', 'ajudante civil', v_categoria_mod, 'MOD', 100, 10, 'MO'),
    (v_baseline, 'Servente', 'servente', v_categoria_mod, 'MOD', 50, 5, 'MO');
  PERFORM public.ativar_planejamento_hh_baseline(v_baseline);

  INSERT INTO public.planejamento_hh_baselines
    (obra_id, nome, versao, arquivo_origem, criado_por)
  VALUES (v_obra, 'DRY C mesmo tipo MOI', v_versao + 3, 'dry.xlsx', v_user)
  RETURNING id INTO v_baseline;
  INSERT INTO public.planejamento_hh_baseline_itens
    (baseline_id, funcao_orcamento, funcao_orcamento_normalizada,
     categoria_mo_mapeada, tipo_mo, hh_previsto, custo_previsto, origem)
  VALUES
    (v_baseline, 'Indireta A', 'indireta a', v_categoria_moi, 'MOI', 100, 10, 'MO'),
    (v_baseline, 'Indireta B', 'indireta b', v_categoria_moi, 'MOI', 50, 5, 'MO');
  PERFORM public.ativar_planejamento_hh_baseline(v_baseline);

  -- D: a mesma categoria em MOI e MOD deve bloquear a ativacao.
  INSERT INTO public.planejamento_hh_baselines
    (obra_id, nome, versao, arquivo_origem, criado_por)
  VALUES (v_obra, 'DRY D tipos mistos', v_versao + 4, 'dry.xlsx', v_user)
  RETURNING id INTO v_baseline;
  INSERT INTO public.planejamento_hh_baseline_itens
    (baseline_id, funcao_orcamento, funcao_orcamento_normalizada,
     categoria_mo_mapeada, tipo_mo, hh_previsto, custo_previsto, origem)
  VALUES
    (v_baseline, 'Conflito MOI', 'conflito moi', v_categoria_mod, 'MOI', 100, 10, 'MO'),
    (v_baseline, 'Conflito MOD', 'conflito mod', v_categoria_mod, 'MOD', 50, 5, 'MO');
  BEGIN
    PERFORM public.ativar_planejamento_hh_baseline(v_baseline);
  EXCEPTION WHEN check_violation THEN
    v_bloqueou := true;
  END;
  IF NOT v_bloqueou THEN RAISE EXCEPTION 'Ativacao MOI+MOD nao foi bloqueada'; END IF;
END;
$cenarios$;

-- E: o bloqueio de composicoes nao reconciliadas (como ABA) permanece no
-- parser/Server Function e e coberto pela suite TypeScript; esta migration nao
-- altera parser, itens importados ou a regra previa.erros.length.

DO $check$
DECLARE
  v_oid oid := to_regprocedure('public.ativar_planejamento_hh_baseline(uuid)');
  v_public_execute boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'ativar_planejamento_hh_baseline'
       AND p.prosecdef
  ) THEN RAISE EXCEPTION 'Funcao de ativacao ausente ou sem contrato esperado'; END IF;
  SELECT coalesce(bool_or(acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'), false)
    INTO v_public_execute
    FROM pg_proc p
    LEFT JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl ON true
   WHERE p.oid = v_oid;
  IF v_oid IS NULL
     OR v_public_execute
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL invalida: PUBLIC/anon nao podem executar e authenticated deve executar';
  END IF;
END;
$check$;

ROLLBACK;
