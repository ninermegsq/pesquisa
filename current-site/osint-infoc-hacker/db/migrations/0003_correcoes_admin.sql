-- Correcoes pendentes no banco de producao (Supabase SQL Editor).
--
-- Este arquivo NAO e uma migracao do projeto: e o passo manual que o
-- operador precisa rodar no painel do Supabase, porque o CLI nao esta
-- autenticado e nao existe chave de service-role no repositorio.
--
-- As tres correcoes vivem em db/migrations/0001_admin.sql (ja corrigidas
-- no codigo do repositorio) e na limpeza dos dados de teste que sobraram
-- no funil. Rodar 0001_admin.sql inteiro JA resolve as correcoes de
-- codigo; o que este arquivo acrescenta e a limpeza das linhas de teste
-- e uma checagem que comprova o resultado.
--
-- Como rodar: abrir o projeto no Supabase -> SQL Editor -> colar este
-- arquivo -> Run. A execucao pode ser repetida: as correcoes de codigo
-- usam CREATE OR REPLACE, e a limpeza apaga so linhas de teste.
--
-- O corpo das funcoes abaixo e IDENTICO ao de 0001_admin.sql: o check
-- verification/sql-admin-check.mjs compara os dois e falha se divergirem.
-- Se voce mudar uma funcao aqui, mude tambem em 0001_admin.sql.

-- ===========================================================================
-- Correcao A: a senha nao aceita '@' inicial.
--
-- O USUARIO aceita '@' inicial como ruido de digitacao (o valor comparado
-- e sempre o "nucleo", sem o '@'), mas a SENHA e comparada exatamente como
-- veio. Aceitar '@' inicial na senha ampliava o espaco de credenciais
-- aceito sem nenhuma necessidade: a conta do operador tinha duas senhas
-- validas (a senha e a senha com '@' na frente).
--
-- Ja esta no repositorio em db/migrations/0001_admin.sql. Este bloco
-- reescreve a funcao para tornar a correcao aplicavel sozinha, sem
-- depender de rodar o arquivo inteiro.
-- ===========================================================================
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
  IF NOT coalesce(u.senha_hash = extensions.crypt(coalesce(p_senha, ''), u.senha_hash), false) THEN
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

CREATE OR REPLACE FUNCTION public.admin_senha_trocar(p_token text, p_senha_atual text, p_senha_nova text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  u    public.admin_usuarios%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT u.id, u.senha_hash INTO u
    FROM public.admin_sessoes ses
    JOIN public.admin_usuarios u ON u.id = ses.usuario_id
   WHERE ses.token = p_token AND ses.expira_em > now() AND u.ativo;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sessao invalida ou expirada');
  END IF;
  v_id := u.id;
  IF p_senha_nova IS NULL OR length(p_senha_nova) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'a senha nova precisa de ao menos 8 caracteres');
  END IF;
  IF p_senha_nova = coalesce(p_senha_atual, '') THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'a senha nova e igual a atual');
  END IF;
  IF NOT coalesce(u.senha_hash = extensions.crypt(coalesce(p_senha_atual, ''), u.senha_hash), false) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'senha atual invalida');
  END IF;
  UPDATE public.admin_usuarios
     SET senha_hash = extensions.crypt(p_senha_nova, extensions.gen_salt('bf', 10))
   WHERE id = v_id;
  DELETE FROM public.admin_sessoes WHERE usuario_id = v_id;
  RETURN jsonb_build_object('ok', true, 'motivo', 'senha trocada; entre de novo');
END;
$$;

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
  -- Lista fechada de etapas. A mesma lista existe no Worker
  -- (src/admin/telemetria.mjs), mas a validacao de la e so em JavaScript:
  -- qualquer chamada direta a RPC gravava o que quisesse na coluna `etapa`.
  -- Isso encheu o funil com linhas de teste (etapas como 'AUDITORIA_TESTE'),
  -- que apareceriam no painel como etapas desconhecidas. O banco agora
  -- recusa o que nao for uma etapa do funil.
  IF p_etapa NOT IN ('visita', 'scan', 'scan_concluido', 'falha', 'exportacao') THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'etapa invalida');
  END IF;
  INSERT INTO public.admin_visitas (etapa, alvo_tipo, fonte, codigo, ok, ms, job_id, ip_hash, agente)
    VALUES (p_etapa, left(coalesce(p_alvo_tipo, ''), 40), left(coalesce(p_fonte, ''), 64), left(coalesce(p_codigo, ''), 40), p_ok, p_ms, p_job_id, left(coalesce(p_ip_hash, ''), 64), left(coalesce(p_agente, ''), 200));
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_senha_trocar(text, text, text) TO anon, authenticated;

-- ===========================================================================
-- Correcao E: lista fechada de etapas do funil.
--
-- A validacao vivia so em JavaScript (src/admin/telemetria.mjs): qualquer
-- chamada direta a RPC gravava o que quisesse na coluna `etapa`. Isso
-- encheu o funil do painel com linhas de teste (etapas como
-- 'AUDITORIA_TESTE', 'ETAPA_ARBITRARIA_TESTE'), que apareceriam como
-- etapas desconhecidas no painel.
--
-- O banco agora recusa o que nao for uma etapa do funil.
-- ===========================================================================

-- ===========================================================================
-- Limpeza: linhas de teste que sobraram no funil.
--
-- Sao 41 linhas de etapas que NUNCA deveriam ter existido (medidas no
-- banco de producao em 2026-11-14, depois das correcoes de catalogo):
-- 36 com nome de teste (AUDITORIA_TESTE, ETAPA_ARBITRARIA_TESTE,
-- ZZ_*, QUALQUER_COISA_*, ...), 3 com etapa vazia ou nula e 2 com nomes
-- que nao sao etapa do funil (inicio, abertura). As 388 linhas do funil
-- real (visita, scan, scan_concluido, falha, exportacao) NAO sao tocadas.
--
-- A limpeza e por LISTA FECHADA: o filtro `etapa NOT IN (...)` apaga
-- tudo que nao for etapa do funil, e por construcao o conjunto que sobra
-- e o conjunto do funil. Nenhum DELETE aqui tem DELETE sem WHERE.
-- ===========================================================================
DELETE FROM public.admin_visitas
 WHERE etapa NOT IN ('visita', 'scan', 'scan_concluido', 'falha', 'exportacao')
   AND etapa IS NOT NULL;

-- As visitas com etapa vazia ou NULA sao lixo de probes anteriores.
-- A etapa real nunca e vazia: o Worker sempre manda uma etapa da lista.
DELETE FROM public.admin_visitas
 WHERE coalesce(etapa, '') = '';

-- ===========================================================================
-- Checagem: o resultado esperado depois de rodar tudo acima.
--
-- 1. A etapa inventada tem que ser RECUSADA:
--      SELECT public.admin_registrar_visita(
--        '<hash da chave mestra>', 'ETAPA_TESTE_QUALQUER', NULL, NULL, NULL,
--        NULL, NULL, NULL, NULL, NULL);
--    -> {"ok":false,"motivo":"etapa invalida"}
--
-- 2. As etapas que sobraram no funil tem que ser exatamente as cinco:
--      SELECT etapa, count(*) FROM public.admin_visitas GROUP BY etapa;
--
-- 3. A troca de senha tem que existir:
--      SELECT public.admin_senha_trocar('x', 'a', 'bbbbbbbb');
--    -> {"ok":false,"motivo":"sessao invalida ou expirada"}
--    (a funcao responde; antes respondia 404 PGRST202)
-- ===========================================================================
