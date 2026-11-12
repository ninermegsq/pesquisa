// Cliente do banco do painel.
//
// O painel fala com o Supabase pelo PostgREST (HTTPS + chave publicavel),
// sem SDK e sem chave de servico: a unica porta de entrada sao funcoes
// SECURITY DEFINER que validam a sessao por dentro (db/migrations/0001_admin.sql).
//
// Tres modos:
//   - supabase: SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY configurados;
//   - local:    ADMIN_MODO_LOCAL=1, banco em memoria (so desenvolvimento);
//   - desligado: sem banco, o painel responde 503 em vez de fingir que
//     salvou alguma coisa.

import { iniciarBancoLocal, chamarLocal } from './local-db.mjs';

export const MODO_SUPABASE = 'supabase';
export const MODO_LOCAL = 'local';
export const MODO_DESLIGADO = 'desligado';

export function modoDoBanco(env) {
  const local = String(env?.ADMIN_MODO_LOCAL ?? '').trim();
  if (local === '1' || local === 'true') return MODO_LOCAL;
  if (env?.SUPABASE_URL && env?.SUPABASE_PUBLISHABLE_KEY) return MODO_SUPABASE;
  return MODO_DESLIGADO;
}

export function baseSupabase(env) {
  return String(env?.SUPABASE_URL || '').replace(/\/+$/, '');
}

// Chamada de RPC. Lanca em erro de rede ou de rejeicao do banco.
export async function rpc(env, nome, parametros = {}) {
  const modo = modoDoBanco(env);
  if (modo === MODO_LOCAL) {
    iniciarBancoLocal(env);
    return chamarLocal(nome, parametros);
  }
  if (modo === MODO_DESLIGADO) throw new Error('banco nao configurado');
  const chave = String(env.SUPABASE_PUBLISHABLE_KEY);
  const url = `${baseSupabase(env)}/rest/v1/rpc/${nome}`;
  let resposta;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: chave,
        authorization: `Bearer ${chave}`
      },
      body: JSON.stringify(parametros || {})
    });
  } catch (e) {
    throw new Error(`banco indisponivel: ${String(e?.message || e)}`);
  }
  const texto = await resposta.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = null; }
  if (!resposta.ok) {
    const motivo = dados?.message || dados?.msg || dados?.error || `HTTP ${resposta.status}`;
    throw new Error(`banco recusou ${nome} (${resposta.status}): ${motivo}`);
  }
  return dados;
}

// Mesma chamada, mas sem lancar: devolve {ok:false, motivo} no lugar.
export async function rpcSegura(env, nome, parametros = {}) {
  try {
    const dados = await rpc(env, nome, parametros);
    return dados && typeof dados === 'object' ? dados : { ok: true, valor: dados };
  } catch (e) {
    return { ok: false, motivo: String(e?.message || e) };
  }
}
