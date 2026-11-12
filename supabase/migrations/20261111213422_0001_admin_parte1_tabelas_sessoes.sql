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

ALTER TABLE public.admin_usuarios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessoes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_credenciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_proxies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_visitas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_eventos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_fontes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_config      ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_mestre_hash()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT coalesce((SELECT valor ->> 'hash' FROM public.admin_config WHERE chave = 'mestre'), '');
$$;

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
