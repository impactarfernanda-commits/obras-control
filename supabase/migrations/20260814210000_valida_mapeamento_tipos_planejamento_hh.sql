-- Impede ativar uma baseline cuja mesma categoria canonica esteja ligada a
-- itens MOI e MOD. Itens do mesmo tipo podem compartilhar categoria: o
-- consolidado gerencial soma o previsto e contabiliza o realizado uma vez.
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
