-- ---------------------------------------------------------------------------
-- Credenciais de API (cifradas no Worker)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_credenciais_leitura(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_mestre_ok(p_hash) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'chave mestra nao confere', 'credenciais', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'credenciais', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'fonte', c.fonte,
        'envname', c.envname,
        'ciphertext', c.ciphertext,
        'status', c.status,
        'limite_minuto', c.limite_minuto,
        'limite_dia', c.limite_dia,
        'observacao', c.observacao,
        'ultimo_uso', c.ultimo_uso,
        'total_usos', c.total_usos
      ) ORDER BY c.fonte)
      FROM public.admin_credenciais c
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_credenciais_uso(p_hash text, p_fonte text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_mestre_ok(p_hash) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'chave mestra nao confere');
  END IF;
  UPDATE public.admin_credenciais
     SET total_usos = total_usos + 1, ultimo_uso = now()
   WHERE fonte = p_fonte;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_credenciais_salvar(
  p_token text,
  p_fonte text,
  p_envname text,
  p_ciphertext text,
  p_status text DEFAULT 'ativa',
  p_limite_minuto integer DEFAULT NULL,
  p_limite_dia integer DEFAULT NULL,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  s jsonb;
BEGIN
  s := public.admin_sessao(p_token);
  IF NOT coalesce((s ->> 'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', s ->> 'motivo');
  END IF;
  IF p_fonte IS NULL OR length(p_fonte) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'fonte invalida');
  END IF;
  IF p_ciphertext IS NULL OR length(p_ciphertext) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'valor cifrado ausente');
  END IF;
  INSERT INTO public.admin_credenciais
    (fonte, envname, ciphertext, status, limite_minuto, limite_dia, observacao, criado_em, atualizado_em)
  VALUES
    (p_fonte, coalesce(p_envname, p_fonte), p_ciphertext, coalesce(p_status, 'ativa'), p_limite_minuto, p_limite_dia, p_observacao, now(), now())
  ON CONFLICT (fonte) DO UPDATE SET
    envname = EXCLUDED.envname,
    ciphertext = EXCLUDED.ciphertext,
    status = EXCLUDED.status,
    limite_minuto = EXCLUDED.limite_minuto,
    limite_dia = EXCLUDED.limite_dia,
    observacao = EXCLUDED.observacao,
    atualizado_em = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_credenciais_apagar(p_token text, p_fonte text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  s jsonb;
BEGIN
  s := public.admin_sessao(p_token);
  IF NOT coalesce((s ->> 'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', s ->> 'motivo');
  END IF;
  DELETE FROM public.admin_credenciais WHERE fonte = p_fonte;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Pool de proxies rotativos
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_proxies_leitura(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_mestre_ok(p_hash) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'chave mestra nao confere', 'proxies', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'proxies', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'rotulo', p.rotulo,
        'url', p.url,
        'esquema', p.esquema,
        'ativo', p.ativo,
        'peso', p.peso,
        'cooldown_ate', p.cooldown_ate,
        'falhas', p.falhas,
        'total_usos', p.total_usos,
        'ultimo_uso', p.ultimo_uso
      ) ORDER BY p.criado_em)
      FROM public.admin_proxies p
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_proxies_uso(p_hash text, p_id uuid, p_falhou boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_mestre_ok(p_hash) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'chave mestra nao confere');
  END IF;
  IF p_falhou THEN
    UPDATE public.admin_proxies
       SET falhas = falhas + 1,
           total_usos = total_usos + 1,
           ultimo_uso = now(),
           cooldown_ate = now() + interval '5 minutes'
     WHERE id = p_id;
  ELSE
    UPDATE public.admin_proxies
       SET total_usos = total_usos + 1, ultimo_uso = now()
     WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_proxies_salvar(
  p_token text,
  p_id uuid,
  p_rotulo text,
  p_url text,
  p_esquema text DEFAULT 'http',
  p_ativo boolean DEFAULT true,
  p_peso integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  s jsonb;
  v_id uuid;
BEGIN
  s := public.admin_sessao(p_token);
  IF NOT coalesce((s ->> 'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', s ->> 'motivo');
  END IF;
  IF p_url IS NULL OR length(p_url) < 8 OR length(p_url) > 400 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'url do proxy invalida');
  END IF;
  IF p_rotulo IS NULL OR length(p_rotulo) < 1 OR length(p_rotulo) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'rotulo invalido');
  END IF;
  IF p_id IS NULL THEN
    v_id := gen_random_uuid();
    INSERT INTO public.admin_proxies (id, rotulo, url, esquema, ativo, peso)
      VALUES (v_id, p_rotulo, p_url, coalesce(p_esquema, 'http'), coalesce(p_ativo, true), greatest(1, coalesce(p_peso, 1)));
  ELSE
    v_id := p_id;
    UPDATE public.admin_proxies
       SET rotulo = p_rotulo,
           url = p_url,
           esquema = coalesce(p_esquema, 'http'),
           ativo = coalesce(p_ativo, true),
           peso = greatest(1, coalesce(p_peso, 1))
     WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'proxy nao encontrado');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_proxies_apagar(p_token text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  s jsonb;
BEGIN
  s := public.admin_sessao(p_token);
  IF NOT coalesce((s ->> 'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', s ->> 'motivo');
  END IF;
  DELETE FROM public.admin_proxies WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Telemetria: visitas, scans e falhas
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_registrar_visita(
  p_hash text,
  p_etapa text,
  p_alvo_tipo text DEFAULT NULL,
  p_fonte text DEFAULT NULL,
  p_codigo text DEFAULT NULL,
  p_ok boolean DEFAULT NULL,
  p_ms integer DEFAULT NULL,
  p_job_id uuid DEFAULT NULL,
  p_ip_hash text DEFAULT NULL,
  p_agente text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_mestre_ok(p_hash) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'chave mestra nao confere');
  END IF;
  IF p_etapa IS NULL OR length(p_etapa) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'etapa invalida');
  END IF;
  INSERT INTO public.admin_visitas (etapa, alvo_tipo, fonte, codigo, ok, ms, job_id, ip_hash, agente)
    VALUES (p_etapa, left(coalesce(p_alvo_tipo, ''), 40), left(coalesce(p_fonte, ''), 64), left(coalesce(p_codigo, ''), 40), p_ok, p_ms, p_job_id, left(coalesce(p_ip_hash, ''), 64), left(coalesce(p_agente, ''), 200));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_registrar_evento(
  p_hash text,
  p_tipo text,
  p_fonte text DEFAULT NULL,
  p_codigo text DEFAULT NULL,
  p_mensagem text DEFAULT NULL,
  p_detalhe jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_mestre_ok(p_hash) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'chave mestra nao confere');
  END IF;
  INSERT INTO public.admin_eventos (tipo, fonte, codigo, mensagem, detalhe)
    VALUES (left(coalesce(p_tipo, 'evento'), 40), left(coalesce(p_fonte, ''), 64), left(coalesce(p_codigo, ''), 40), left(coalesce(p_mensagem, ''), 300), p_detalhe);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Painel: tudo que a interface mostra em uma leitura.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_painel(p_token text, p_dias integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  s jsonb;
  v_dias integer;
  v_visitas jsonb;
  v_serie jsonb;
  v_falhas jsonb;
  v_eventos jsonb;
  v_credenciais jsonb;
  v_proxies jsonb;
  v_fontes jsonb;
BEGIN
  s := public.admin_sessao(p_token);
  IF NOT coalesce((s ->> 'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', s ->> 'motivo');
  END IF;
  v_dias := greatest(1, least(coalesce(p_dias, 30), 365));

  SELECT coalesce(jsonb_object_agg(e.etapa, e.n), '{}'::jsonb) INTO v_visitas
    FROM (
      SELECT etapa, count(*)::bigint AS n
        FROM public.admin_visitas
       WHERE criado_em > now() - make_interval(days => v_dias)
       GROUP BY etapa) e;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_serie
    FROM (
      SELECT to_char(criado_em::date, 'YYYY-MM-DD') AS dia, etapa, count(*)::bigint AS n
        FROM public.admin_visitas
       WHERE criado_em > now() - make_interval(days => v_dias)
       GROUP BY 1, 2
       ORDER BY 1) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_falhas
    FROM (
      SELECT fonte, coalesce(codigo, 'erro') AS codigo, count(*)::bigint AS n, max(criado_em) AS ultimo_em
        FROM public.admin_visitas
       WHERE etapa = 'falha' AND criado_em > now() - make_interval(days => v_dias)
       GROUP BY fonte, coalesce(codigo, 'erro')
       ORDER BY n DESC
       LIMIT 50) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_eventos
    FROM (
      SELECT tipo, fonte, codigo, mensagem, criado_em
        FROM public.admin_eventos
       ORDER BY criado_em DESC
       LIMIT 30) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_credenciais
    FROM (
      SELECT fonte, envname, status, limite_minuto, limite_dia, observacao, ultimo_uso, total_usos, atualizado_em
        FROM public.admin_credenciais
       ORDER BY fonte) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_proxies
    FROM (
      SELECT id, rotulo, url, esquema, ativo, peso, cooldown_ate, falhas, total_usos, ultimo_uso
        FROM public.admin_proxies
       ORDER BY criado_em) t;

  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_fontes
    FROM (
      SELECT id, titulo, tipos, custo, ttl, proveniencia, requer_env, requer_tipo,
             limite_minuto, limite_dia, limite_texto, limite_origem, usa_proxy, observacao, explicacoes
        FROM public.admin_fontes
       ORDER BY id) t;

  RETURN jsonb_build_object(
    'ok', true,
    'usuario', s - 'ok',
    'dias', v_dias,
    'visitas', v_visitas,
    'serie', v_serie,
    'falhas', v_falhas,
    'eventos', v_eventos,
    'credenciais', v_credenciais,
    'proxies', v_proxies,
    'fontes', v_fontes,
    'mestre_configurado', public.admin_mestre_hash() <> ''
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Ajustes de limite e proxy por fonte, editaveis pelo painel.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_fontes_salvar(
  p_token text,
  p_id text,
  p_titulo text DEFAULT NULL,
  p_tipos text[] DEFAULT NULL,
  p_custo integer DEFAULT NULL,
  p_ttl integer DEFAULT NULL,
  p_proveniencia text DEFAULT NULL,
  p_requer_env text DEFAULT NULL,
  p_requer_tipo text DEFAULT NULL,
  p_limite_minuto integer DEFAULT NULL,
  p_limite_dia integer DEFAULT NULL,
  p_limite_texto text DEFAULT NULL,
  p_limite_origem text DEFAULT NULL,
  p_usa_proxy boolean DEFAULT NULL,
  p_observacao text DEFAULT NULL,
  p_explicacoes jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  s jsonb;
  v_atual public.admin_fontes%ROWTYPE;
BEGIN
  s := public.admin_sessao(p_token);
  IF NOT coalesce((s ->> 'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', s ->> 'motivo');
  END IF;
  IF p_id IS NULL OR length(p_id) < 1 OR length(p_id) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'fonte invalida');
  END IF;
  SELECT * INTO v_atual FROM public.admin_fontes WHERE id = p_id;
  INSERT INTO public.admin_fontes
    (id, titulo, tipos, custo, ttl, proveniencia, requer_env, requer_tipo,
     limite_minuto, limite_dia, limite_texto, limite_origem, usa_proxy, observacao, explicacoes)
  VALUES
    (p_id,
     coalesce(p_titulo, v_atual.titulo, p_id),
     coalesce(p_tipos, v_atual.tipos, '{}'::text[]),
     coalesce(p_custo, v_atual.custo, 0),
     coalesce(p_ttl, v_atual.ttl, 0),
     coalesce(p_proveniencia, v_atual.proveniencia),
     coalesce(p_requer_env, v_atual.requer_env),
     coalesce(p_requer_tipo, v_atual.requer_tipo),
     p_limite_minuto,
     p_limite_dia,
     p_limite_texto,
     coalesce(p_limite_origem, v_atual.limite_origem, 'nao_publicado'),
     coalesce(p_usa_proxy, v_atual.usa_proxy, false),
     p_observacao,
     coalesce(p_explicacoes, v_atual.explicacoes, '{}'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    titulo = EXCLUDED.titulo,
    tipos = EXCLUDED.tipos,
    custo = EXCLUDED.custo,
    ttl = EXCLUDED.ttl,
    proveniencia = EXCLUDED.proveniencia,
    requer_env = EXCLUDED.requer_env,
    requer_tipo = EXCLUDED.requer_tipo,
    limite_minuto = EXCLUDED.limite_minuto,
    limite_dia = EXCLUDED.limite_dia,
    limite_texto = EXCLUDED.limite_texto,
    limite_origem = EXCLUDED.limite_origem,
    usa_proxy = EXCLUDED.usa_proxy,
    observacao = EXCLUDED.observacao,
    explicacoes = EXCLUDED.explicacoes;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_fontes_leitura(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_mestre_ok(p_hash) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'chave mestra nao confere', 'fontes', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'fontes', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT id, titulo, tipos, custo, ttl, proveniencia, requer_env, requer_tipo,
               limite_minuto, limite_dia, limite_texto, limite_origem, usa_proxy, observacao, explicacoes
          FROM public.admin_fontes
         ORDER BY id) t
    ), '[]'::jsonb)
  );
END;
$$;
