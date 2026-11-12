// Rotas HTTP do painel admin.
//
// Autenticacao: login devolve um token de sessao (bearer). Nao ha cookie,
// portanto nao ha CSRF: o token fica na memoria da pagina e vai no cabecalho
// Authorization. Todas as rotas que mexem em dados exigem esse token.
//
// Permissao: o painel e do operador. As rotas nao ficam na allow-list de
// origem publica do site: quem nao tem sessao nao passa da tela de login.

import { rpc, rpcSegura, modoDoBanco, MODO_DESLIGADO } from './db.mjs';
import { listarCredenciais, salvarCredencial, removerCredencial, chaveMestreDeEnv } from './credenciais.mjs';
import { listarProxies, salvarProxy, removerProxy, gatewayDisponivel } from './proxies.mjs';
import { CATALOGO } from './catalogo.meta.mjs';
import { fontesEfetivas, listarFontesDoBanco, mesclarFontes, invalidarFontes } from './fontes.mjs';

const CAB = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (dados, status = 200, extra = {}) =>
  new Response(JSON.stringify(dados), { status, headers: { ...CAB, ...extra } });

// ---------------------------------------------------------------------------
// Limite de tentativas de login (por IP, em memoria do isolate).
// ---------------------------------------------------------------------------

const tentativas = new Map();
const MAX_TENTATIVAS = 10;
const JANELA_MS = 15 * 60 * 1000;

function bloqueioDe(ip) {
  const agora = Date.now();
  const registro = tentativas.get(ip) || { n: 0, ate: 0 };
  if (registro.ate <= agora) {
    registro.n = 0;
    registro.ate = 0;
  }
  return registro;
}

function registrarTentativa(ip) {
  const registro = bloqueioDe(ip);
  registro.n += 1;
  registro.ate = Date.now() + JANELA_MS;
  tentativas.set(ip, registro);
  if (tentativas.size > 5000) {
    for (const [chave, item] of tentativas) if (item.ate <= Date.now()) tentativas.delete(chave);
  }
  return registro;
}

// ---------------------------------------------------------------------------
// Sessao
// ---------------------------------------------------------------------------

export async function sessaoDe(env, token) {
  if (!token) return null;
  const r = await rpcSegura(env, 'admin_sessao', { p_token: String(token) });
  return r?.ok ? r : null;
}

function tokenDo(request) {
  const cab = request.headers.get('authorization') || '';
  if (/^bearer\s+/i.test(cab)) return cab.replace(/^bearer\s+/i, '').trim();
  const alt = request.headers.get('x-admin-token');
  return alt ? String(alt).trim() : null;
}

async function exigeSessao(request, env) {
  const token = tokenDo(request);
  const sessao = await sessaoDe(env, token);
  if (!sessao) return { erro: json({ ok: false, motivo: 'sessao invalida ou expirada' }, 401) };
  return { token, sessao };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function login(request, env, opcoes) {
  if (modoDoBanco(env) === MODO_DESLIGADO) {
    return json({ ok: false, motivo: 'Banco do painel nao configurado (SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY).' }, 503);
  }
  const ip = opcoes?.ip || 'desconhecido';
  const bloqueio = bloqueioDe(ip);
  if (bloqueio.n >= MAX_TENTATIVAS) {
    return json({ ok: false, motivo: 'Muitas tentativas. Tente de novo em alguns minutos.' }, 429);
  }
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, motivo: 'JSON invalido' }, 400); }
  const usuario = String(body?.usuario || '').trim();
  const senha = String(body?.senha || '');
  if (!usuario || !senha) return json({ ok: false, motivo: 'usuario e senha obrigatorios' }, 400);
  const r = await rpcSegura(env, 'admin_login', {
    p_usuario: usuario,
    p_senha: senha,
    p_agente: request.headers.get('user-agent') || null,
    p_ip: ip
  });
  if (!r?.ok) {
    registrarTentativa(ip);
    return json({ ok: false, motivo: r?.motivo || 'credencial invalida' }, 401);
  }
  tentativas.delete(ip);
  return json({
    ok: true,
    token: r.token,
    usuario: r.usuario,
    nome: r.nome,
    papel: r.papel,
    expira_em: r.expira_em
  });
}

async function logout(request, env) {
  const token = tokenDo(request);
  if (token) await rpcSegura(env, 'admin_logout', { p_token: token });
  return json({ ok: true });
}

async function painel(request, env) {
  const guard = await exigeSessao(request, env);
  if (guard.erro) return guard.erro;
  const dias = Number(new URL(request.url).searchParams.get('dias') || 30) || 30;
  const r = await rpcSegura(env, 'admin_painel', { p_token: guard.token, p_dias: dias });
  if (!r?.ok) return json({ ok: false, motivo: r?.motivo || 'leitura recusada' }, 403);
  // As fontes do painel sao as efetivas: o que o operador gravou no banco
  // por cima do catalogo. Se a leitura especifica falhar, o proprio painel
  // ja trouxe as linhas e elas servem de base.
  const leitura = await listarFontesDoBanco(env);
  const linhas = leitura.linhas?.length ? leitura.linhas : (Array.isArray(r.fontes) ? r.fontes : []);
  const fontes = mesclarFontes(CATALOGO, linhas);
  return json({
    ...r,
    fontes,
    ambiente: {
      banco: modoDoBanco(env),
      master_key: !!chaveMestreDeEnv(env),
      gateway_proxy: gatewayDisponivel(env),
      fontes_ajustadas: fontes.filter(f => f.ajustado).length
    }
  });
}

async function credenciais(request, env) {
  const guard = await exigeSessao(request, env);
  if (guard.erro) return guard.erro;
  if (request.method === 'GET') {
    const lista = await listarCredenciais(env);
    return json({ ok: true, ...lista });
  }
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, motivo: 'JSON invalido' }, 400); }
    const r = await salvarCredencial(env, guard.token, body);
    return json(r, r.ok ? 200 : 400);
  }
  if (request.method === 'DELETE') {
    const fonte = new URL(request.url).searchParams.get('fonte') || '';
    const r = await removerCredencial(env, guard.token, fonte);
    return json(r, r.ok ? 200 : 400);
  }
  return json({ ok: false, motivo: 'metodo nao permitido' }, 405);
}

async function proxies(request, env) {
  const guard = await exigeSessao(request, env);
  if (guard.erro) return guard.erro;
  if (request.method === 'GET') {
    const lista = await listarProxies(env);
    return json({ ok: true, ...lista, gateway: gatewayDisponivel(env) });
  }
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, motivo: 'JSON invalido' }, 400); }
    const r = await salvarProxy(env, guard.token, body);
    return json(r, r.ok ? 200 : 400);
  }
  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id') || '';
    const r = await removerProxy(env, guard.token, id);
    return json(r, r.ok ? 200 : 400);
  }
  return json({ ok: false, motivo: 'metodo nao permitido' }, 405);
}

async function fontes(request, env) {
  const guard = await exigeSessao(request, env);
  if (guard.erro) return guard.erro;
  if (request.method === 'GET') {
    const fontes = await fontesEfetivas(env, { comPadrao: true });
    return json({ ok: true, fontes });
  }
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, motivo: 'JSON invalido' }, 400); }
    const numero = v => (v === undefined || v === null || v === '' ? null : Number(v));
    const texto = v => (v === undefined || v === null ? null : String(v));
    const r = await rpcSegura(env, 'admin_fontes_salvar', {
      p_token: guard.token,
      p_id: String(body?.id || ''),
      p_titulo: texto(body?.titulo),
      p_tipos: Array.isArray(body?.tipos) ? body.tipos.map(String) : null,
      p_custo: numero(body?.custo),
      p_ttl: numero(body?.ttl),
      p_proveniencia: texto(body?.proveniencia),
      p_requer_env: texto(body?.requer_env),
      p_requer_tipo: texto(body?.requer_tipo),
      p_limite_minuto: numero(body?.limite_minuto),
      p_limite_dia: numero(body?.limite_dia),
      p_limite_texto: texto(body?.limite_texto),
      p_limite_origem: texto(body?.limite_origem),
      p_usa_proxy: body?.usa_proxy === undefined || body?.usa_proxy === null ? null : !!body.usa_proxy,
      p_observacao: texto(body?.observacao),
      p_explicacoes: body?.explicacoes && typeof body.explicacoes === 'object' ? body.explicacoes : null
    });
    if (r?.ok) invalidarFontes();
    return json(r, r?.ok ? 200 : 400);
  }
  return json({ ok: false, motivo: 'metodo nao permitido' }, 405);
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export async function tratarAdmin(request, env, opcoes = {}) {
  const url = new URL(request.url);
  const caminho = url.pathname.replace(/\/+$/, '') || '/api/admin';
  try {
    if (caminho === '/api/admin/login') return await login(request, env, opcoes);
    if (caminho === '/api/admin/logout') return await logout(request, env);
    if (caminho === '/api/admin/painel') return await painel(request, env);
    if (caminho === '/api/admin/credenciais') return await credenciais(request, env);
    if (caminho === '/api/admin/proxies') return await proxies(request, env);
    if (caminho === '/api/admin/fontes') return await fontes(request, env);
    return json({ ok: false, motivo: 'rota desconhecida' }, 404);
  } catch (e) {
    console.error(JSON.stringify({ event: 'admin_erro', rota: caminho, message: String(e?.message || e) }));
    return json({ ok: false, motivo: 'falha interna do painel' }, 500);
  }
}

export { rpc };
