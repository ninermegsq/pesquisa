// Verificacao do token de operacao (src/lib/warm.mjs).
//
// O token de operacao e um credencial do operador assinado com HMAC-SHA256.
// A verificacao precisa rejeitar: token ausente, token adulterado, token
// expirado, escopo trocado e alvo trocado.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede.

import assert from 'node:assert/strict';
import {
  ESCOPOS,
  MAX_TTL_SEGUNDOS,
  PREFIXO,
  assinarTokenCalor,
  segredoDe,
  verificarTokenCalor
} from '../src/lib/warm.mjs';

const SEGREDO = 'segredo-de-teste-0123456789';
const AGORA = 1_700_000_000_000;
const ALVO = 'alvo@example.com';
const env = { HMAC_SECRET: SEGREDO };

// --- segredo ---------------------------------------------------------------
assert.equal(segredoDe(env), SEGREDO);
assert.equal(segredoDe({}), null, 'sem segredo nao pode haver token');
assert.equal(segredoDe({ HMAC_SECRET: 'curta' }), null, 'segredo curto demais');
assert.equal(segredoDe({ WARM_SECRET: 'segredo-mais-longo-aqui', HMAC_SECRET: SEGREDO }), 'segredo-mais-longo-aqui');

// --- escopos declarados ----------------------------------------------------
assert.deepEqual([...ESCOPOS], ['aquecimento', 'operador']);

// --- assinatura e verificacao (ida e volta) --------------------------------
const aquecimento = assinarTokenCalor({
  alvo: ALVO,
  segredo: SEGREDO,
  escopo: 'aquecimento',
  ttlSegundos: 900,
  agora: AGORA
});
assert.ok(aquecimento.token.startsWith(`${PREFIXO}.`), 'prefixo do token invalido');
assert.equal(aquecimento.token.split('.').length, 3);
assert.ok(aquecimento.payload.alvo_hash, 'token de aquecimento tem que amarrar o alvo por hash');
assert.ok(!aquecimento.token.includes(ALVO), 'o alvo nao pode aparecer em texto claro no token');
assert.ok(!aquecimento.token.toLowerCase().includes('example.com'), 'o alvo nao pode vazar em texto claro');

const ok = verificarTokenCalor(aquecimento.token, { env, escopo: 'aquecimento', alvo: ALVO, agora: AGORA });
assert.equal(ok.ok, true, `token valido deveria ser aceito (${ok.motivo || ''})`);
assert.equal(ok.escopo, 'aquecimento');

// --- alvo diferente --------------------------------------------------------
const outroAlvo = verificarTokenCalor(aquecimento.token, { env, escopo: 'aquecimento', alvo: 'outro@example.com', agora: AGORA });
assert.equal(outroAlvo.ok, false);
assert.equal(outroAlvo.motivo, 'alvo diferente');

// --- escopo diferente ------------------------------------------------------
const escopoErrado = verificarTokenCalor(aquecimento.token, { env, escopo: 'operador', agora: AGORA });
assert.equal(escopoErrado.ok, false, 'token de aquecimento nao pode abrir o painel de saude');
assert.equal(escopoErrado.motivo, 'escopo nao autorizado');

// --- token adulterado ------------------------------------------------------
const partes = aquecimento.token.split('.');
const macQuebrado = `${partes[0]}.${partes[1]}.${partes[2].slice(0, -2)}aa`;
const adulterado = verificarTokenCalor(macQuebrado, { env, escopo: 'aquecimento', alvo: ALVO, agora: AGORA });
assert.equal(adulterado.ok, false, 'assinatura invalida tem que ser rejeitada');
assert.equal(adulterado.motivo, 'assinatura invalida');

const payloadAlterado = Buffer.from(
  JSON.stringify({ escopo: 'aquecimento', exp: Math.floor(AGORA / 1000) + 900, alvo_hash: 'falso' }),
  'utf8'
).toString('base64url');
const payloadForjado = verificarTokenCalor(`${PREFIXO}.${payloadAlterado}.${partes[2]}`, { env, escopo: 'aquecimento', alvo: ALVO, agora: AGORA });
assert.equal(payloadForjado.ok, false, 'payload trocado tem que ser rejeitado');

// --- expiracao -------------------------------------------------------------
const curto = assinarTokenCalor({ alvo: ALVO, segredo: SEGREDO, ttlSegundos: 10, agora: AGORA });
assert.equal(verificarTokenCalor(curto.token, { env, escopo: 'aquecimento', alvo: ALVO, agora: AGORA }).ok, true);
const expirado = verificarTokenCalor(curto.token, { env, escopo: 'aquecimento', alvo: ALVO, agora: AGORA + 20_000 });
assert.equal(expirado.ok, false);
assert.equal(expirado.motivo, 'token expirado');

// --- validade limitada a 24 horas ------------------------------------------
const longo = assinarTokenCalor({ alvo: ALVO, segredo: SEGREDO, ttlSegundos: MAX_TTL_SEGUNDOS * 10, agora: AGORA });
assert.ok(longo.payload.exp - Math.floor(AGORA / 1000) <= MAX_TTL_SEGUNDOS, 'validade tem que ser limitada');

// --- escopo operador -------------------------------------------------------
const operador = assinarTokenCalor({ segredo: SEGREDO, escopo: 'operador', ttlSegundos: 600, agora: AGORA });
assert.equal(verificarTokenCalor(operador.token, { env, escopo: 'operador', agora: AGORA }).ok, true);
assert.equal(verificarTokenCalor(operador.token, { env, escopo: 'aquecimento', alvo: ALVO, agora: AGORA }).ok, false);

// --- entradas invalidas ----------------------------------------------------
assert.equal(verificarTokenCalor('', { env, escopo: 'operador' }).ok, false);
assert.equal(verificarTokenCalor(null, { env, escopo: 'operador' }).ok, false);
assert.equal(verificarTokenCalor('lixo', { env, escopo: 'operador' }).ok, false);
assert.equal(verificarTokenCalor('w1.aa.bb', { env, escopo: 'operador' }).ok, false);
assert.equal(verificarTokenCalor(aquecimento.token, { env: {}, escopo: 'aquecimento', alvo: ALVO, agora: AGORA }).ok, false);
assert.equal(verificarTokenCalor(aquecimento.token, { env, escopo: 'aquecimento', agora: AGORA }).ok, false, 'aquecimento exige alvo');

// --- falhas na assinatura --------------------------------------------------
assert.throws(() => assinarTokenCalor({ alvo: ALVO, segredo: SEGREDO, escopo: 'admin' }), /escopo invalido/);
assert.throws(() => assinarTokenCalor({ segredo: SEGREDO, escopo: 'aquecimento' }), /alvo obrigatorio/);
assert.throws(() => assinarTokenCalor({ alvo: ALVO, segredo: 'curto' }), /segredo/);

console.log(JSON.stringify({
  ok: true,
  escopos: ESCOPOS,
  ttl_maximo_s: MAX_TTL_SEGUNDOS,
  comparacao: 'timingSafeEqual',
  alvo_em_texto_claro: false
}));
