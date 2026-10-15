-- Inclui somente feriados nacionais restantes de 2026 no calendario global.
-- A data e a chave primaria; reaplicar esta migration nao cria duplicidades.

INSERT INTO public.feriados_obras_control (data, descricao, ativo)
VALUES
  (DATE '2026-10-12', 'Nossa Senhora Aparecida', true),
  (DATE '2026-11-02', 'Finados', true),
  (DATE '2026-11-15', 'Proclamação da República', true),
  (DATE '2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', true),
  (DATE '2026-12-25', 'Natal', true)
ON CONFLICT (data) DO UPDATE
SET ativo = true,
    atualizado_em = now();
