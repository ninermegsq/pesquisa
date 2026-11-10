// Token de operacao (aquecimento e saude) assinado com HMAC-SHA256.
//
// O token de uso unico do visitante (ver /.netlify/functions/token) resolve o
// desafio do Turnstile e vale por 60 segundos. O token de operacao e outra
// coisa: e um credencial do operador, assinado com o mesmo segredo do Worker
// (HMAC_SECRET), usado para
//   - `aquecimento`: consultar as fontes sem consumir o token do visitante e
//     com o token amarrado a um alvo especifico;
//   - `operador`: ler o painel de saude em GET /api/saude.
//
// Regras de seguranca aplicadas aqui:
//   - comparacao em tempo constante (timingSafeEqual);
//   - expiracao obrigatoria e limitada a 24 horas;
//   - escopo fixo: um token de aquecimento nao abre o painel de saude;
//   - alvo amarrado por hash no escopo de aquecimento.
//
// Formato do token: w1.<payload base64url>.<mac base64url>
// O payload e um JSON {escopo, exp, alvo_hash}. Nada de e-mail, IP ou alvo em
// texto claro: o alvo entra apenas como hash SHA-256.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const ESCOPOS = Object.freeze(['aquecimento', 'operador']);
export const MAX_TTL_SEGUNDOS = 24 * 60 * 60;
export const PREFIXO = 'w1';

const base64url = valor => Buffer.from(valor).toString('base64url');
const sha256 = valor => createHash('sha256').update(String(valor)).digest('hex');
const regexBase64url = /^[\w-]+$/;

// Segredo do operador: HMAC_SECRET e o segredo ja configurado no Worker para
// os tokens de uso unico; WARM_SECRET, quando existir, tem precedencia.
export function segredoDe(env) {
  const segredo = env?.WARM_SECRET || env?.HMAC_SECRET;
  return typeof segredo === 'string' && segredo.length >= 16 ? segredo : null;
}

// Assina um token de operacao. `alvo` e obrigatorio no escopo de aquecimento.
export function assinarTokenCalor({ alvo, segredo, escopo = 'aquecimento', ttlSegundos = 900, agora = Date.now() }) {
  if (!ESCOPOS.includes(escopo)) throw new Error(`escopo invalido: ${escopo}`);
  if (typeof segredo !== 'string' || segredo.length < 16) throw new Error('segredo ausente ou curto demais');
  const ttl = Math.min(Math.max(1, Math.floor(ttlSegundos)), MAX_TTL_SEGUNDOS);
  const exp = Math.floor(agora / 1000) + ttl;
  const payload = { escopo, exp };
  if (escopo === 'aquecimento') {
    if (typeof alvo !== 'string' || !alvo.trim()) throw new Error('alvo obrigatorio no escopo de aquecimento');
    payload.alvo_hash = sha256(alvo.trim().toLowerCase());
  }
  const corpo = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const mac = createHmac('sha256', segredo).update(corpo).digest('base64url');
  return { token: `${PREFIXO}.${corpo}.${mac}`, payload, expira_em: new Date(exp * 1000).toISOString() };
}

// Verifica um token de operacao.
// Devolve {ok:true,escopo,exp} ou {ok:false,motivo}. Nunca lanca.
export function verificarTokenCalor(token, { env, escopo = 'aquecimento', alvo = null, agora = Date.now() } = {}) {
  const segredo = segredoDe(env);
  if (!segredo) return { ok: false, motivo: 'segredo ausente' };
  if (typeof token !== 'string' || !token || token.length > 2000) return { ok: false, motivo: 'token ausente' };
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== PREFIXO) return { ok: false, motivo: 'formato invalido' };
  if (!regexBase64url.test(partes[1]) || !regexBase64url.test(partes[2])) return { ok: false, motivo: 'formato invalido' };
  const esperado = createHmac('sha256', segredo).update(partes[1]).digest();
  const recebido = Buffer.from(partes[2], 'base64url');
  if (recebido.length !== esperado.length || !timingSafeEqual(esperado, recebido)) return { ok: false, motivo: 'assinatura invalida' };
  let payload;
  try { payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')); } catch { return { ok: false, motivo: 'payload invalido' }; }
  if (!payload || typeof payload !== 'object') return { ok: false, motivo: 'payload invalido' };
  if (!ESCOPOS.includes(payload.escopo)) return { ok: false, motivo: 'escopo desconhecido' };
  if (payload.escopo !== escopo) return { ok: false, motivo: 'escopo nao autorizado' };
  const agoraSegundos = Math.floor(agora / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= agoraSegundos) return { ok: false, motivo: 'token expirado' };
  if (payload.exp - agoraSegundos > MAX_TTL_SEGUNDOS) return { ok: false, motivo: 'validade acima do limite' };
  if (escopo === 'aquecimento') {
    if (typeof alvo !== 'string' || !alvo.trim()) return { ok: false, motivo: 'alvo ausente' };
    if (payload.alvo_hash !== sha256(alvo.trim().toLowerCase())) return { ok: false, motivo: 'alvo diferente' };
  }
  return { ok: true, escopo: payload.escopo, exp: payload.exp, expira_em: new Date(payload.exp * 1000).toISOString() };
}
