// Pool de proxies rotativos.
//
// Limitacao real do runtime: o `fetch` de um Worker nao fala HTTP CONNECT
// nem SOCKS5, entao o Worker nao consegue sair por um proxy sozinho. O que
// existe aqui e o par completo:
//
//   - a POOL (este arquivo): escolhe, rotaciona, pesa e coloca em cooldown
//     o proxy da vez, tudo com estado no banco;
//   - o TRANSPORTE: um gateway em Node (scripts/proxy-gateway.mjs) que faz a
//     conexao de verdade. O Worker chama POST {PROXY_GATEWAY_URL}/fetch e o
//     gateway responde com status, cabecalhos e corpo.
//
// Sem gateway configurado, a fonte que exige proxy volta a consulta direta
// e o painel mostra o aviso: e melhor uma consulta sem proxy do que uma
// fonte que nem responde.

import { rpc, rpcSegura, modoDoBanco, MODO_DESLIGADO } from './db.mjs';
import { hashDoEnv } from './credenciais.mjs';

// Contador de rotacao por pool (memoria do isolate).
let cursor = 0;
// Cache curto do pool: cada fonte que exige proxy nao deve fazer uma leitura
// de banco por requisicao. 30 segundos e o prazo; o painel grava com
// `forcar`, entao a mudanca aparece na hora.
let cachePool = { expira: 0, lista: [] };

export function invalidarPool() {
  cachePool = { expira: 0, lista: [] };
}

export function gatewayDisponivel(env) {
  const url = String(env?.PROXY_GATEWAY_URL || '').trim();
  return url.startsWith('http://') || url.startsWith('https://');
}

export async function listarProxies(env, opcoes = {}) {
  const modo = modoDoBanco(env);
  const hash = hashDoEnv(env);
  if (modo === MODO_DESLIGADO || !hash) return { proxies: [], erro: 'banco nao configurado' };
  if (!opcoes.forcar && cachePool.expira > Date.now()) return { proxies: cachePool.lista, erro: null };
  const r = await rpcSegura(env, 'admin_proxies_leitura', { p_hash: hash });
  if (!r?.ok) return { proxies: [], erro: r?.motivo || 'leitura recusada' };
  const lista = Array.isArray(r.proxies) ? r.proxies : [];
  cachePool = { expira: Date.now() + 30000, lista };
  return { proxies: lista, erro: null };
}

export async function salvarProxy(env, token, dados) {
  const id = dados?.id ? String(dados.id) : null;
  const r = await rpcSegura(env, 'admin_proxies_salvar', {
    p_token: token,
    p_id: id,
    p_rotulo: String(dados?.rotulo || '').trim(),
    p_url: String(dados?.url || '').trim(),
    p_esquema: String(dados?.esquema || 'http').trim(),
    p_ativo: dados?.ativo === undefined ? true : !!dados.ativo,
    p_peso: Number.isFinite(Number(dados?.peso)) ? Number(dados.peso) : 1
  });
  if (!r?.ok) return { ok: false, motivo: r?.motivo || 'gravacao recusada' };
  invalidarPool();
  return { ok: true, id: r.id || id };
}

export async function removerProxy(env, token, id) {
  const r = await rpcSegura(env, 'admin_proxies_apagar', { p_token: token, p_id: String(id || '') });
  if (!r?.ok) return { ok: false, motivo: r?.motivo || 'exclusao recusada' };
  invalidarPool();
  return { ok: true };
}

// Escolhe o proximo proxy do pool.
//   - ignora proxies inativos e os que estao em cooldown (5 minutos apos uma
//     falha);
//   - respeita o peso (um proxy com peso 3 entra tres vezes mais vezes);
//   - a rotacao e por ponteiro, entao duas fontes seguidas nao usam o mesmo
//     proxy so por sorte.
export function escolherProxy(lista, { fonte = null } = {}) {
  const agora = Date.now();
  const aptos = (lista || []).filter(p => {
    if (p.ativo === false) return false;
    if (p.cooldown_ate && new Date(p.cooldown_ate).getTime() > agora) return false;
    return true;
  });
  if (!aptos.length) return null;
  const pesos = aptos.map(p => Math.max(1, Number(p.peso) || 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  cursor = (cursor + 1) % total;
  let alvo = cursor;
  for (let i = 0; i < aptos.length; i++) {
    alvo -= pesos[i];
    if (alvo < 0) return { ...aptos[i], fonte };
  }
  return { ...aptos[aptos.length - 1], fonte };
}

// Consulta a fonte pelo gateway, usando o proxy escolhido.
// Devolve uma Response equivalente (ok, status, headers, text/json).
export async function getViaProxy(env, url, opcoes = {}) {
  const gateway = String(env?.PROXY_GATEWAY_URL || '').replace(/\/+$/, '');
  if (!gateway) throw new Error('PROXY_GATEWAY_URL ausente');
  const { proxy, timeout = 8000, method = 'GET', headers = {}, body = null, accept = 'application/json' } = opcoes;
  const alvo = `${gateway}/fetch`;
  const cabecalhoRequisicao = { 'content-type': 'application/json' };
  // O gateway pode exigir um token proprio (PROXY_GATEWAY_TOKEN), para que
  // ele nao seja um proxy aberto na rede.
  const token = String(env?.PROXY_GATEWAY_TOKEN || '').trim();
  if (token) cabecalhoRequisicao['x-gateway-token'] = token;
  const resposta = await fetch(alvo, {
    method: 'POST',
    headers: cabecalhoRequisicao,
    body: JSON.stringify({
      proxy: proxy?.url || null,
      url: String(url),
      method,
      headers: { accept, ...headers },
      body: body ?? null,
      timeout
    }),
    signal: AbortSignal.timeout(Math.max(2000, timeout + 2000))
  });
  const texto = await resposta.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
  if (!resposta.ok || !dados || typeof dados !== 'object') {
    const erro = new Error(`gateway respondeu ${resposta.status}`);
    erro.status = resposta.status;
    throw erro;
  }
  if (dados.erro) {
    const erro = new Error(String(dados.erro));
    erro.status = Number(dados.status) || 502;
    throw erro;
  }
  const cabecalhos = new Headers(dados.headers || {});
  // Decodifica sem Buffer: o runtime do Worker nao garante o global Buffer,
  // e atob existe nos dois lados (Node e Worker).
  const bruto = dados.encoding === 'base64'
    ? Uint8Array.from(atob(String(dados.body || '')), c => c.charCodeAt(0))
    : new TextEncoder().encode(String(dados.body || ''));
  return new Response(bruto, {
    status: Number(dados.status) || 200,
    headers: cabecalhos
  });
}

// Registra o uso do proxy (sucesso ou falha). Best effort.
export async function registrarUsoProxy(env, id, falhou) {
  if (!id) return;
  const hash = hashDoEnv(env);
  if (!hash) return;
  await rpcSegura(env, 'admin_proxies_uso', { p_hash: hash, p_id: String(id), p_falhou: !!falhou });
}

// Escolhe o proxy da vez para uma fonte (com cache curto do pool).
export async function buscarProxy(env, fonte) {
  if (!gatewayDisponivel(env)) return null;
  const { proxies, erro } = await listarProxies(env);
  if (erro || !proxies || !proxies.length) return null;
  return escolherProxy(proxies, { fonte });
}

// Monta o contexto de proxy para uma fonte: escolhe o proxy e devolve o que
// o chamador precisa para registrar o uso depois.
export async function contextoProxy(env, fonte) {
  if (!gatewayDisponivel(env)) return { disponivel: false, proxy: null };
  const { proxies } = await listarProxies(env);
  const proxy = escolherProxy(proxies, { fonte });
  if (!proxy) return { disponivel: true, proxy: null };
  return { disponivel: true, proxy };
}

// Leitura direta do pool para a interface (sem depender do painel).
export async function poolDe(env) {
  return rpc(env, 'admin_proxies_leitura', { p_hash: hashDoEnv(env) || '' });
}
