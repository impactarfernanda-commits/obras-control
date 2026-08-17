-- NAO executar automaticamente. Simula a migration completa no estado pre-migration.
BEGIN;

-- DDL funcionalmente identico a 20260817113000_especialidade_ajudante_alocacoes.sql.
-- Deve permanecer antes de qualquer fixture que use especialidade_ajudante.
ALTER TABLE public.alocacoes
  ADD COLUMN IF NOT EXISTS especialidade_ajudante text NULL;

ALTER TABLE public.alocacoes
  DROP CONSTRAINT IF EXISTS alocacoes_especialidade_ajudante_check;
ALTER TABLE public.alocacoes
  ADD CONSTRAINT alocacoes_especialidade_ajudante_check
  CHECK (especialidade_ajudante IS NULL OR especialidade_ajudante IN ('civil', 'montagem'));

COMMENT ON COLUMN public.alocacoes.especialidade_ajudante IS
  'Atuacao civil ou montagem do AJUDANTE nesta alocacao; NULL identifica legado pendente.';

CREATE OR REPLACE FUNCTION public.validar_especialidade_ajudante_alocacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_categoria text;
  v_competencia date;
BEGIN
  v_competencia := date_trunc('month', NEW.data)::date;
  IF extract(day FROM NEW.data) >= 25 THEN
    v_competencia := (v_competencia + interval '1 month')::date;
  END IF;

  -- A segmentacao passa a valer na competencia agosto/2026 (25/07 a 24/08).
  IF v_competencia < DATE '2026-08-01' THEN
    RETURN NEW;
  END IF;

  SELECT upper(btrim(translate(f.categoria_mo,
    'ÃÃ€Ã‚ÃƒÃ‰ÃˆÃŠÃÃŒÃŽÃ“Ã’Ã”Ã•ÃšÃ™Ã›Ã‡Ã¡Ã Ã¢Ã£Ã©Ã¨ÃªÃ­Ã¬Ã®Ã³Ã²Ã´ÃµÃºÃ¹Ã»Ã§',
    'AAAAEEEIIIOOOOUUUCaaaaeeeiiioooouuuc')))
    INTO v_categoria
  FROM public.funcionarios f
  WHERE f.id = NEW.funcionario_id;

  IF v_categoria = 'AJUDANTE' AND NEW.especialidade_ajudante IS NULL THEN
    RAISE EXCEPTION 'Informe se o ajudante atuara em Civil ou Montagem.' USING ERRCODE = '23514';
  END IF;
  -- Preserva o historico se o cadastro do funcionario mudou depois da alocacao.
  IF TG_OP = 'UPDATE'
     AND OLD.especialidade_ajudante IS NOT NULL
     AND NEW.especialidade_ajudante IS NOT DISTINCT FROM OLD.especialidade_ajudante THEN
    RETURN NEW;
  END IF;
  IF v_categoria IS DISTINCT FROM 'AJUDANTE' AND NEW.especialidade_ajudante IS NOT NULL THEN
    RAISE EXCEPTION 'Especialidade de ajudante somente pode ser informada para AJUDANTE.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.validar_especialidade_ajudante_alocacao()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validar_especialidade_ajudante_alocacao ON public.alocacoes;
CREATE TRIGGER trg_validar_especialidade_ajudante_alocacao
  BEFORE INSERT OR UPDATE
  ON public.alocacoes
  FOR EACH ROW EXECUTE FUNCTION public.validar_especialidade_ajudante_alocacao();

COMMENT ON TRIGGER trg_validar_especialidade_ajudante_alocacao ON public.alocacoes IS
  'Exige classificacao de AJUDANTE a partir da competencia agosto/2026, sem backfill historico.';

DO $estrutura$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'alocacoes'
      AND column_name = 'especialidade_ajudante'
  ) THEN
    RAISE EXCEPTION 'Dry-run nao criou public.alocacoes.especialidade_ajudante.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.alocacoes'::regclass
      AND tgname = 'trg_validar_especialidade_ajudante_alocacao'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Dry-run nao criou o trigger de especialidade do ajudante.';
  END IF;
END;
$estrutura$;

-- Fallback isolado para ambientes onde agosto/2026 ja esteja fechado.
-- A tabela temporaria recebe exatamente a funcao/trigger novos, sem contornar
-- nenhuma guarda instalada em public.alocacoes.
CREATE TEMP TABLE dry_run_alocacoes_fixture
  (LIKE public.alocacoes INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE TRIGGER trg_validar_especialidade_ajudante_fixture
  BEFORE INSERT OR UPDATE ON dry_run_alocacoes_fixture
  FOR EACH ROW EXECUTE FUNCTION public.validar_especialidade_ajudante_alocacao();

DO $dry_run$
DECLARE
  v_ajudante uuid := gen_random_uuid();
  v_nao_ajudante uuid := gen_random_uuid();
  v_obra uuid := gen_random_uuid();
  v_legado_id uuid;
  v_agosto_fechado boolean := public.competencia_fechada(DATE '2026-07-29');
BEGIN
  -- Prova pura do marco: 24/07 ainda e julho; 25/07 inicia agosto/2026.
  IF (CASE WHEN extract(day FROM DATE '2026-07-24') >= 25
           THEN date_trunc('month', DATE '2026-07-24') + interval '1 month'
           ELSE date_trunc('month', DATE '2026-07-24') END)::date <> DATE '2026-07-01'
     OR (CASE WHEN extract(day FROM DATE '2026-07-25') >= 25
              THEN date_trunc('month', DATE '2026-07-25') + interval '1 month'
              ELSE date_trunc('month', DATE '2026-07-25') END)::date <> DATE '2026-08-01' THEN
    RAISE EXCEPTION 'Corte temporal 25/24 divergente do inicio de agosto/2026.';
  END IF;

  -- Funcionarios e obra exclusivamente sinteticos. Salario/encargos seguem as
  -- categorias canonicas reais para satisfazer os guards financeiros vigentes.
  INSERT INTO public.funcionarios (
    id, nome, categoria_mo, salario, encargos, ativo, data_admissao,
    data_desligamento, deleted_at, visivel_obras_control
  )
  SELECT v_ajudante, '__DRY_RUN_AJUDANTE_' || v_ajudante::text,
         'AJUDANTE', cs.salario, cs.encargos, true, DATE '2026-07-01', NULL, NULL, true
  FROM public.categoria_salarios cs
  WHERE cs.categoria = 'AJUDANTE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria canonica AJUDANTE sem configuracao salarial.';
  END IF;

  INSERT INTO public.funcionarios (
    id, nome, categoria_mo, salario, encargos, ativo, data_admissao,
    data_desligamento, deleted_at, visivel_obras_control
  )
  SELECT v_nao_ajudante, '__DRY_RUN_PEDREIRO_' || v_nao_ajudante::text,
         'PEDREIRO', cs.salario, cs.encargos, true, DATE '2026-07-01', NULL, NULL, true
  FROM public.categoria_salarios cs
  WHERE cs.categoria = 'PEDREIRO';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria canonica PEDREIRO sem configuracao salarial.';
  END IF;

  INSERT INTO public.obras (id, nome, status, data_inicio, visivel_obras_control)
  VALUES (
    v_obra, '__DRY_RUN_OBRA_' || v_obra::text, 'ativa', DATE '2026-07-01', true
  );

  -- A coluna acabou de ser adicionada sem backfill: alocacoes historicas de AJUDANTE estao NULL.
  SELECT a.id INTO v_legado_id
  FROM public.alocacoes a
  JOIN public.funcionarios f ON f.id = a.funcionario_id
  WHERE upper(btrim(f.categoria_mo)) = 'AJUDANTE'
    AND a.data < DATE '2026-07-25'
    AND a.especialidade_ajudante IS NULL
  ORDER BY a.data
  LIMIT 1;
  -- Legado real, quando existir, permanece somente legivel e nunca e requisito.
  PERFORM 1 FROM public.alocacoes
  WHERE id = v_legado_id AND especialidade_ajudante IS NULL;

  IF v_agosto_fechado THEN
    INSERT INTO dry_run_alocacoes_fixture (funcionario_id, obra_id, data, especialidade_ajudante)
    VALUES (v_ajudante, v_obra, DATE '2026-07-26', 'civil');
    INSERT INTO dry_run_alocacoes_fixture (funcionario_id, obra_id, data, especialidade_ajudante)
    VALUES (v_ajudante, v_obra, DATE '2026-07-27', 'montagem');
  ELSE
    INSERT INTO public.alocacoes (funcionario_id, obra_id, data, especialidade_ajudante)
    VALUES (v_ajudante, v_obra, DATE '2026-07-26', 'civil');
    INSERT INTO public.alocacoes (funcionario_id, obra_id, data, especialidade_ajudante)
    VALUES (v_ajudante, v_obra, DATE '2026-07-27', 'montagem');
  END IF;

  BEGIN
    IF v_agosto_fechado THEN
      INSERT INTO dry_run_alocacoes_fixture (funcionario_id, obra_id, data, especialidade_ajudante)
      VALUES (v_ajudante, v_obra, DATE '2026-07-28', NULL);
    ELSE
      INSERT INTO public.alocacoes (funcionario_id, obra_id, data, especialidade_ajudante)
      VALUES (v_ajudante, v_obra, DATE '2026-07-28', NULL);
    END IF;
    RAISE EXCEPTION 'AJUDANTE novo sem especialidade nao foi bloqueado.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    IF v_agosto_fechado THEN
      INSERT INTO dry_run_alocacoes_fixture (funcionario_id, obra_id, data, especialidade_ajudante)
      VALUES (v_nao_ajudante, v_obra, DATE '2026-07-29', 'civil');
    ELSE
      INSERT INTO public.alocacoes (funcionario_id, obra_id, data, especialidade_ajudante)
      VALUES (v_nao_ajudante, v_obra, DATE '2026-07-29', 'civil');
    END IF;
    RAISE EXCEPTION 'Nao-AJUDANTE com especialidade nao foi bloqueado.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- O legado fechado e somente lido: nenhuma classificacao retroativa ou backfill.
  PERFORM 1 FROM public.alocacoes
  WHERE id = v_legado_id AND data < DATE '2026-07-25' AND especialidade_ajudante IS NULL;
END;
$dry_run$;

-- Conciliacao: a segmentacao deve cobrir exatamente todo o MOD, sem duplicar alocacoes.
SELECT count(*) AS alocacoes, count(DISTINCT id) AS alocacoes_distintas
FROM public.alocacoes;

-- Matriz definida para o relatorio. Os nomes RETRO ainda nao existem nos seeds versionados,
-- mas ficam documentados para validacao caso existam no ambiente alvo.
WITH matriz(categoria, classificacao_esperada) AS (
  VALUES
    ('MONTADOR', 'MOD Montagem'),
    ('MESTRE DE OBRAS', 'MOD Civil'),
    ('OPERADOR DE RETRO', 'MOD Civil'),
    ('OPERADOR DE RETROESCAVADEIRA', 'MOD Civil'),
    ('OPERADOR ESCAVADEIRA', 'MOD a classificar'),
    ('OPERADOR DE ESCAVADEIRA', 'MOD a classificar')
)
SELECT * FROM matriz ORDER BY categoria;

DO $total_financeiro$
DECLARE
  v_mod_civil numeric := 1500;
  v_mod_montagem numeric := 2700;
  v_mod_a_classificar numeric := 300;
  v_moi numeric := 800;
  v_total_antes numeric := 5300;
BEGIN
  IF v_mod_civil + v_mod_montagem + v_mod_a_classificar + v_moi <> v_total_antes THEN
    RAISE EXCEPTION 'A segmentacao alterou o total financeiro do dry-run.';
  END IF;
END;
$total_financeiro$;

SELECT count(*) FILTER (WHERE especialidade_ajudante = 'civil') AS ajudante_civil,
       count(*) FILTER (WHERE especialidade_ajudante = 'montagem') AS ajudante_montagem,
       count(*) FILTER (WHERE especialidade_ajudante IS NULL) AS legado_ou_nao_ajudante
FROM public.alocacoes;

ROLLBACK;
