-- 0001_admin.sql — Painel admin do scanner OSINT.
--
-- Cria a base do painel: usuarios do operador, sessoes, credenciais de API
-- cifradas, pool de proxies rotativos, telemetria de visitas/falhas e o
-- catalogo operacional das fontes.
--
-- Seguranca (por que o desenho e este):
--   - RLS ligado em todas as tabelas e SEM politica para anon/authenticated:
--     o papel anon nao le nem escreve tabela nenhuma;
--   - a unica porta de entrada sao funcoes SECURITY DEFINER, que validam a
--     sessao (ou o hash da chave mestra) por dentro, com search_path fixo;
--   - a senha do usuario e bcrypt (pgcrypto) e nunca volta em claro;
--   - as credenciais de API sao cifradas no Worker (AES-256-GCM) e o banco
--     guarda apenas o texto cifrado;
--   - a chave mestra nunca viaja: o Worker manda so o SHA-256 dela.
--
-- Uso: aplicar no projeto Supabase (SQL Editor ou psql).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_usuarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario       text NOT NULL UNIQUE,
  senha_hash    text NOT NULL,
  papel         text NOT NULL DEFAULT 'admin',
  nome          text,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso timestamptz
);

CREATE TABLE IF NOT EXISTS public.admin_sessoes (
  token      text PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES public.admin_usuarios(id) ON DELETE CASCADE,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  expira_em  timestamptz NOT NULL,
  ip         text,
  agente     text
);

CREATE TABLE IF NOT EXISTS public.admin_credenciais (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte         text NOT NULL UNIQUE,
  envname       text NOT NULL,
  ciphertext    text NOT NULL,
  status        text NOT NULL DEFAULT 'ativa',
  limite_minuto integer,
  limite_dia    integer,
  observacao    text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_uso    timestamptz,
  total_usos    bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.admin_proxies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rotulo       text NOT NULL,
  url          text NOT NULL,
  esquema      text NOT NULL DEFAULT 'http',
  ativo        boolean NOT NULL DEFAULT true,
  peso         integer NOT NULL DEFAULT 1,
  cooldown_ate timestamptz,
  falhas       integer NOT NULL DEFAULT 0,
  total_usos   bigint NOT NULL DEFAULT 0,
  ultimo_uso   timestamptz,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_visitas (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  etapa      text NOT NULL,
  alvo_tipo  text,
  fonte      text,
  codigo     text,
  ok         boolean,
  ms         integer,
  job_id     uuid,
  ip_hash    text,
  agente     text
);

CREATE INDEX IF NOT EXISTS admin_visitas_etapa_em_idx ON public.admin_visitas (etapa, criado_em DESC);
CREATE INDEX IF NOT EXISTS admin_visitas_fonte_em_idx ON public.admin_visitas (fonte, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.admin_eventos (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  tipo       text NOT NULL,
  fonte      text,
  codigo     text,
  mensagem   text,
  detalhe    jsonb
);

CREATE INDEX IF NOT EXISTS admin_eventos_em_idx ON public.admin_eventos (criado_em DESC);

CREATE TABLE IF NOT EXISTS public.admin_fontes (
  id             text PRIMARY KEY,
  titulo         text NOT NULL,
  tipos          text[] NOT NULL DEFAULT '{}',
  custo          integer NOT NULL DEFAULT 0,
  ttl            integer NOT NULL DEFAULT 0,
  proveniencia   text,
  requer_env     text,
  requer_tipo    text,
  limite_minuto  integer,
  limite_dia     integer,
  limite_texto   text,
  limite_origem  text NOT NULL DEFAULT 'nao_publicado',
  usa_proxy      boolean NOT NULL DEFAULT false,
  observacao     text,
  explicacoes    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.admin_config (
  chave         text PRIMARY KEY,
  valor         jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security: o papel anon nao encosta em tabela nenhuma.
-- A porta de entrada sao as funcoes SECURITY DEFINER abaixo.
-- ---------------------------------------------------------------------------

ALTER TABLE public.admin_usuarios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessoes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_credenciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_proxies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_visitas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_eventos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_fontes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_config      ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Chave mestra: o Worker guarda a chave e manda apenas o SHA-256 dela.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_mestre_hash()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT coalesce((SELECT valor ->> 'hash' FROM public.admin_config WHERE chave = 'mestre'), '');
$$;

-- Bootstrap: grava o hash da chave mestra quando ainda nao existe (uma vez
-- so). Depois disso, so devolve se o hash bate.
CREATE OR REPLACE FUNCTION public.admin_bootstrap(p_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_atual text;
BEGIN
  v_atual := public.admin_mestre_hash();
  IF v_atual = '' THEN
    IF p_hash IS NULL OR length(p_hash) < 32 THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'hash invalido');
    END IF;
    INSERT INTO public.admin_config (chave, valor, atualizado_em)
      VALUES ('mestre', jsonb_build_object('hash', p_hash), now())
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now();
    RETURN jsonb_build_object('ok', true, 'motivo', 'chave mestra registrada');
  END IF;
  RETURN jsonb_build_object('ok', v_atual = coalesce(p_hash, ''), 'motivo', 'chave mestra ja registrada');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mestre_ok(p_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT public.admin_mestre_hash() <> '' AND public.admin_mestre_hash() = coalesce(p_hash, '');
$$;

-- ---------------------------------------------------------------------------
-- Usuarios e sessoes
-- ---------------------------------------------------------------------------

-- Login: usuario sem '@' no comeco e senha sem '@' no comeco. O '@' inicial e
-- aceito como ruido de digitacao: o valor comparado e sempre o "nucleo".
CREATE OR REPLACE FUNCTION public.admin_login(p_usuario text, p_senha text, p_agente text DEFAULT NULL, p_ip text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  u    public.admin_usuarios%ROWTYPE;
  v_token text;
  v_exp   timestamptz;
BEGIN
  SELECT * INTO u FROM public.admin_usuarios
   WHERE lower(usuario) = lower(ltrim(coalesce(p_usuario, ''), '@'))
     AND ativo;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'credencial invalida');
  END IF;
  IF NOT coalesce(u.senha_hash = extensions.crypt(ltrim(coalesce(p_senha, ''), '@'), u.senha_hash), false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'credencial invalida');
  END IF;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_exp   := now() + interval '12 hours';
  INSERT INTO public.admin_sessoes (token, usuario_id, expira_em, ip, agente)
    VALUES (v_token, u.id, v_exp, left(coalesce(p_ip, ''), 64), left(coalesce(p_agente, ''), 200));
  UPDATE public.admin_usuarios SET ultimo_acesso = now() WHERE id = u.id;
  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,
    'usuario', u.usuario,
    'nome', u.nome,
    'papel', u.papel,
    'expira_em', v_exp
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_sessao(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  s record;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sessao ausente');
  END IF;
  SELECT ses.expira_em, u.usuario, u.nome, u.papel
    INTO s
    FROM public.admin_sessoes ses
    JOIN public.admin_usuarios u ON u.id = ses.usuario_id
   WHERE ses.token = p_token AND ses.expira_em > now() AND u.ativo;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sessao invalida ou expirada');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'usuario', s.usuario,
    'nome', s.nome,
    'papel', s.papel,
    'expira_em', s.expira_em
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_logout(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.admin_sessoes WHERE token = p_token;
  RETURN jsonb_build_object('ok', true);
END;
$$;

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
--
-- A funcao grava a linha INTEIRA da fonte (upsert): quem chama manda o
-- catalogo completo, com os campos que o operador mudou. Assim o banco e a
-- fonte da verdade do que vale em producao, e o catalogo do codigo continua
-- sendo a documentacao (ver src/admin/fontes.mjs, que sobrepoe o catalogo em
-- tempo de execucao sobre as linhas do banco).
--
-- Um campo NULL nos campos DESCRITIVOS (titulo, tipos, custo, ttl,
-- proveniencia, requer_env, requer_tipo, limite_origem, explicacoes)
-- significa "nao mexa neste campo". Nos campos OPERACIONAIS (limite_minuto,
-- limite_dia, limite_texto, usa_proxy, observacao) o valor e gravado
-- como veio: NULL significa "sem limite / sem anotacao", que e como o
-- operador limpa um limite. Por isso o painel sempre envia a linha
-- inteira.
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

-- Leitura das fontes pelo caminho do motor (sem sessao de painel): e o que o
-- scan usa para saber se a fonte sai pelo pool de proxies e quais limites
-- valem. A chave mestra e o unico credencial exigido, como no resto.
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

-- ---------------------------------------------------------------------------
-- Permissoes: o papel anon so executa as funcoes acima; nao le tabelas.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_mestre_hash() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_bootstrap(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_mestre_ok(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_login(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_sessao(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_logout(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_credenciais_leitura(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_credenciais_uso(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_credenciais_salvar(text, text, text, text, text, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_credenciais_apagar(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_proxies_leitura(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_proxies_uso(text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_proxies_salvar(text, uuid, text, text, text, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_proxies_apagar(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_registrar_visita(text, text, text, text, text, boolean, integer, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_registrar_evento(text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_painel(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_fontes_salvar(text, text, text, text[], integer, integer, text, text, text, integer, integer, text, text, boolean, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_fontes_leitura(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_mestre_hash() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bootstrap(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mestre_ok(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_login(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_sessao(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_logout(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credenciais_leitura(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credenciais_uso(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credenciais_salvar(text, text, text, text, text, integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credenciais_apagar(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_proxies_leitura(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_proxies_uso(text, uuid, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_proxies_salvar(text, uuid, text, text, text, boolean, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_proxies_apagar(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_registrar_visita(text, text, text, text, text, boolean, integer, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_registrar_evento(text, text, text, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_painel(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_fontes_salvar(text, text, text, text[], integer, integer, text, text, text, integer, integer, text, text, boolean, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_fontes_leitura(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Administrador do operador.
--
-- A conta do operador nasce aqui, mas SEM senha em claro no repositorio:
-- o hash abaixo e de uma senha aleatoria descartavel (gerada pelo proprio
-- banco), portanto o usuario existe e o painel sobe, mas ninguem consegue
-- entrar com esse hash. A senha real do operador e definida fora do
-- repositorio (no painel do Supabase, por comando SQL pontual), e o hash
-- bcrypt nunca aparece em claro aqui nem no codigo do site.
--
-- Usuario: GUI170pretty (o '@' inicial e aceito no login).
-- ---------------------------------------------------------------------------

INSERT INTO public.admin_usuarios (usuario, senha_hash, papel, nome)
VALUES (
  'Gui170pretty',
  extensions.crypt(extensions.gen_random_uuid()::text, extensions.gen_salt('bf', 10)),
  'admin',
  'Administrador (Gui170pretty)'
)
ON CONFLICT (usuario) DO NOTHING;
