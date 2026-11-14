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
import { hashIp } from './telemetria.mjs';
import { JANELA_MS, calcularReserva } from '../lib/login-limite.mjs';

const CAB = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (dados, status = 200, extra = {}) =>
  new Response(JSON.stringify(dados), { status, headers: { ...CAB, ...extra } });

// ---------------------------------------------------------------------------
// Limite de tentativas de login (por origem).
//
// Por que o Durable Object e obrigatorio: o limite precisa valer para TODOS os
// isolates do Worker. Um `Map` em memoria vive so dentro de um isolate: o
// Cloudflare espalha as requisicoes por maquinas e reinicia os isolates o tempo
// todo, entao o contador se zera a cada troca de isolate. Na pratica o limite
// de 10 tentativas por 15 minutos nao existia: um atacante so precisava cair em
// isolates diferentes.
//
// Por que nao e mais o KV: o KV tem consistencia eventual, uma gravacao pode
// levar ate um minuto para aparecer em outra regiao. Com "ler o total e depois
// somar" o contador voltava a zero por baixo do limite. O Durable Object tem
// armazenamento forte e executa um objeto por vez: a reserva acontece dentro
// do objeto, entao duas requisicoes simultaneas nao conseguem ler o mesmo
// total e passar as duas.
//
// A tentativa e reservada ANTES da checagem da credencial, nao depois. O
// codigo antigo lia o contador, conferia a senha e so entao somava: esse era
// um vao entre a leitura e a escrita por onde varias requisicoes passavam
// juntas. Somar depois tambem contava duas vezes (o `Map` local ja tinha sido
// incrementado antes da escrita no KV), e por isso a producao bloqueava na
// tentativa 9, e nao na 10.
//
// A chave nunca e o endereco de origem em claro: e o HMAC dele, que identifica
// a origem sem guardar o endereco.
//
// O modo local (sem Durable Object) cai no limite em memoria: e um servidor
// unico, sem isolates, entao o `Map` e suficiente ali.
// ---------------------------------------------------------------------------

// Nome do objeto que guarda o contador. E um objeto unico com uma linha por
// origem (a coluna `chave`), e nao um objeto por origem: assim o numero de
// objetos nao cresce com o numero de tentativas.
const OBJETO_LOGIN = 'osint-login';

const memoria = new Map();

// Chave opaca da origem: HMAC do endereco. Estavel entre deploys porque o
// segredo (HMAC_SECRET) e o mesmo, entao o contador sobrevive a publicacao.
function chaveLogin(ip, env) {
  const bruto = String(ip || '').trim() || 'desconhecido';
  return hashIp(bruto, env) || 'origem-desconhecida';
}

// Stub do Durable Object do limite, ou null quando ele nao esta disponivel.
function stubDoLogin(env) {
  const guard = env?.TOKEN_GUARD;
  if (!guard || typeof guard.getByName !== 'function') return null;
  try {
    const stub = guard.getByName(OBJETO_LOGIN);
    if (!stub || typeof stub.reservaTentativa !== 'function') return null;
    return stub;
  } catch {
    return null;
  }
}

function limparMemoria() {
  if (memoria.size <= 5000) return;
  const agora = Date.now();
  for (const [chave, item] of memoria) if (Number(item?.ate) <= agora) memoria.delete(chave);
}

// Reserva uma tentativa e devolve o total gasto. Bloqueado quando o total
// passou do limite; a partir dai a resposta e 429.
async function reservarTentativa(env, ip) {
  const chave = chaveLogin(ip, env);
  const stub = stubDoLogin(env);
  if (stub) {
    try {
      const r = await stub.reservaTentativa(chave);
      if (r && Number.isFinite(Number(r.tentativas))) {
        return {
          ok: true,
          chave,
          tentativas: Number(r.tentativas),
          bloqueado: !!r.bloqueado,
          origem: 'durable-object'
        };
      }
    } catch (e) {
      console.error(JSON.stringify({ event: 'admin_limite_login', status: 'erro', message: String(e?.message || e) }));
    }
  }
  // Sem Durable Object: contador em memoria, com a mesma politica.
  const agora = Date.now();
  const calc = calcularReserva(memoria.get(chave) || null, agora, JANELA_MS);
  memoria.set(chave, { tentativas: calc.tentativas, ate: calc.ate });
  limparMemoria();
  return {
    ok: true,
    chave,
    tentativas: calc.tentativas,
    bloqueado: calc.bloqueado,
    origem: 'memoria'
  };
}

// Zera o contador depois de um login bem-sucedido.
async function zerarTentativas(env, ip) {
  const chave = chaveLogin(ip, env);
  memoria.delete(chave);
  const stub = stubDoLogin(env);
  if (!stub) return;
  try {
    await stub.zeraTentativa(chave);
  } catch (e) {
    console.error(JSON.stringify({ event: 'admin_limite_login_reset', status: 'erro', message: String(e?.message || e) }));
  }
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
  // A tentativa e reservada ANTES da checagem da credencial. Como a reserva
  // acontece dentro do Durable Object, ela e atomica: requisicoes simultaneas
  // nao conseguem passar as duas pelo mesmo total.
  const reserva = await reservarTentativa(env, ip);
  if (reserva.bloqueado) {
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
    // O banco recebe o identificador opaco da origem, nunca o endereco.
    p_ip: reserva.chave
  });
  if (!r?.ok) {
    return json({ ok: false, motivo: r?.motivo || 'credencial invalida' }, 401);
  }
  await zerarTentativas(env, ip);
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
  // Somente POST encerra a sessao. Um GET em /api/admin/logout pode vir de
  // um prefetch, de um link clicado por engano ou de um scanner: encerrar a
  // sessao do operador por um GET e um desvio de REST. O logout e idempotente
  // (apagar a propria sessao de novo nao faz mal), entao responder 405 para
  // GET/HEAD mantem o cliente honesto sem efeito colateral.
  if (request.method !== 'POST') {
    return json({ ok: false, motivo: 'metodo nao permitido' }, 405);
  }
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
  // O resumo do limite de login vai junto do painel: e o unico jeito de o
  // operador confirmar que a protecao esta viva sem ficar tentando entrar.
  // Sao contagens, sem identificar origem nenhuma. A leitura do contador
  // nao e parte do painel: se falhar, o painel abre normal.
  let limite = null;
  try {
    const stub = env.TOKEN_GUARD && env.TOKEN_GUARD.getByName('osint-login');
    if (stub) limite = await stub.resumoLimite();
  } catch { limite = null; }
  return json({
    ...r,
    fontes,
    limite_login: limite,
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

// Troca da senha do operador.
//
// O painel promete que as credenciais sao trocaveis em qualquer momento.
// Antes desta rota o promessa nao tinha por tras nenhum codigo: nao havia
// funcao no banco, nem rota, nem tela. A funcao `admin_senha_trocar` pode
// ainda nao existir no banco de producao (a migracao e aplicada no
// Supabase SQL Editor); nesse caso a resposta diz isso com clareza, em vez
// de fingir que a troca foi feita.
async function senha(request, env) {
  const guard = await exigeSessao(request, env);
  if (guard.erro) return guard.erro;
  if (request.method !== 'POST') {
    return json({ ok: false, motivo: 'metodo nao permitido' }, 405);
  }
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const atual = String(body?.senha_atual ?? '');
  const nova = String(body?.senha_nova ?? '');
  if (!atual || !nova) {
    return json({ ok: false, motivo: 'informe a senha atual e a nova' }, 400);
  }
  const r = await rpcSegura(env, 'admin_senha_trocar', {
    p_token: guard.token,
    p_senha_atual: atual,
    p_senha_nova: nova
  });
  if (r?.ok) return json({ ok: true, motivo: r.motivo || 'senha trocada' });
  // A RPC pode nao existir no banco ainda: o PostgREST responde 404 com
  // "Could not find the function". Nesse caso a mensagem precisa dizer o
  // que fazer, e nao "banco recusou ...".
  const motivo = String(r?.motivo || '');
  if (motivo.includes('Could not find the function') || motivo.includes('404')) {
    return json({
      ok: false,
      motivo: 'a funcao de troca de senha ainda nao foi aplicada no banco (admin_senha_trocar). Aplique db/migrations/0001_admin.sql no Supabase SQL Editor.'
    }, 501);
  }
  return json({ ok: false, motivo: motivo || 'troca recusada' }, 400);
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
    if (caminho === '/api/admin/senha') return await senha(request, env);
    return json({ ok: false, motivo: 'rota desconhecida' }, 404);
  } catch (e) {
    console.error(JSON.stringify({ event: 'admin_erro', rota: caminho, message: String(e?.message || e) }));
    return json({ ok: false, motivo: 'falha interna do painel' }, 500);
  }
}

export { rpc };
