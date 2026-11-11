// Verificacao do contrato de resultado das fontes (src/contract.mjs).
//
// Cobre a taxonomia de erros, a normalizacao do resultado de uma fonte, a
// regra "falha de configuracao nao e relatorio parcial" e os invariantes do
// registro de fontes (manifesto x implementacao).
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede.

import assert from 'node:assert/strict';
import {
  CODIGOS_ERRO,
  CODIGOS_DE_CONFIGURACAO,
  STATUS_VALIDOS,
  FaltaChaveError,
  FaltaTokenError,
  classificarErro,
  statusDeCodigo,
  ehConfiguracao,
  normalizarFonte,
  saudeDe
} from '../src/contract.mjs';
import { pontuar } from '../src/lib/score.mjs';
import { REGISTRY } from '../src/sources/registry.mjs';
import { REGISTRY_META } from '../src/sources/registry.meta.mjs';
import { statsDe } from '../scripts/stats.mjs';

// --- taxonomia -------------------------------------------------------------
for (const codigo of ['sem_chave', 'sem_token', 'erro_rede', 'timeout', 'http', 'formato', 'erro']) {
  assert.ok(CODIGOS_ERRO.includes(codigo), `codigo ausente na taxonomia: ${codigo}`);
}
assert.deepEqual([...CODIGOS_DE_CONFIGURACAO].sort(), ['sem_chave', 'sem_token']);
for (const codigo of CODIGOS_DE_CONFIGURACAO) {
  assert.ok(CODIGOS_ERRO.includes(codigo), `codigo de configuracao fora da taxonomia: ${codigo}`);
}
assert.deepEqual([...STATUS_VALIDOS].sort(), ['erro', 'ok', 'timeout']);

// --- classificacao de excecoes --------------------------------------------
assert.equal(classificarErro(new FaltaChaveError('EMAILREP_KEY')).codigo, 'sem_chave');
assert.equal(classificarErro(new FaltaTokenError('sem token: GITHUB_TOKEN')).codigo, 'sem_token');
assert.equal(classificarErro(Object.assign(new Error('deadline'), { name: 'TimeoutError' })).codigo, 'timeout');
assert.equal(classificarErro(Object.assign(new Error('HTTP 500'), { status: 500 })).codigo, 'http');
assert.equal(classificarErro(new Error('fetch failed')).codigo, 'erro_rede');
assert.equal(classificarErro(new Error('resposta não-JSON (HTTP 200)')).codigo, 'formato');
assert.equal(classificarErro(new Error('qualquer outra coisa')).codigo, 'erro');
assert.equal(classificarErro(null).codigo, 'erro');
assert.equal(statusDeCodigo('timeout'), 'timeout');
assert.equal(statusDeCodigo('sem_chave'), 'erro');
assert.equal(statusDeCodigo('erro_rede'), 'erro');
assert.equal(ehConfiguracao('sem_chave'), true);
assert.equal(ehConfiguracao('sem_token'), true);
assert.equal(ehConfiguracao('erro_rede'), false);
assert.equal(ehConfiguracao(null), false);

// --- normalizacao ----------------------------------------------------------
const ok = normalizarFonte({
  id: 'gravatar',
  status: 'ok',
  dados: { existe: true },
  pivos: [{ tipo: 'dominio', valor: 'a.com' }, { tipo: 'dominio', valor: '' }, { valor: 'b.com' }]
});
assert.equal(ok.status, 'ok');
assert.equal(ok.erro_codigo, null, 'sucesso nao pode ter codigo de erro');
assert.deepEqual(ok.dados, { existe: true });
assert.deepEqual(ok.pivos, [{ tipo: 'dominio', valor: 'a.com' }, { tipo: 'nome', valor: 'b.com' }]);
assert.equal(ok.cache, 'miss');
assert.equal(ok.ms, 0);
assert.ok(ok.provenance === '' || typeof ok.provenance === 'string');

const falha = normalizarFonte({ id: 'emailrep', status: 'erro', erro: 'sem chave: EMAILREP_KEY', erro_codigo: 'sem_chave' });
assert.equal(falha.erro_codigo, 'sem_chave');
assert.equal(falha.dados, null, 'falha nao pode carregar dados');
assert.equal(falha.status, 'erro');
assert.throws(() => normalizarFonte({ status: 'ok' }), /sem id/);
assert.throws(() => normalizarFonte(null), /sem id/);
assert.equal(normalizarFonte({ id: 'x', status: 'estranho' }).status, 'erro');
assert.equal(normalizarFonte({ id: 'x', status: 'ok', erro_codigo: 'codigo-inexistente' }).erro_codigo, null);

// --- saude do scan ---------------------------------------------------------
const soConfiguracao = saudeDe([
  { id: 'a', status: 'ok' },
  { id: 'github', status: 'erro', erro_codigo: 'sem_token' },
  { id: 'emailrep', status: 'erro', erro_codigo: 'sem_chave' }
]);
assert.equal(soConfiguracao.ok, 1);
assert.equal(soConfiguracao.parcial, false, 'falha de configuracao nao pode marcar o relatorio como parcial');
assert.deepEqual(soConfiguracao.indisponiveis, []);
assert.deepEqual([...soConfiguracao.por_configuracao].sort(), ['emailrep', 'github']);
assert.equal(soConfiguracao.por_fonte.github, 'sem_token');

const comFalhaReal = saudeDe([
  { id: 'a', status: 'ok' },
  { id: 'dns', status: 'erro', erro_codigo: 'erro_rede' }
]);
assert.equal(comFalhaReal.parcial, true, 'falha real tem que marcar o relatorio como parcial');
assert.deepEqual(comFalhaReal.indisponiveis, ['dns']);

// --- score: configuracao nao e falha do relatorio -------------------------
const semCredencial = pontuar([
  { id: 'github', status: 'erro', erro_codigo: 'sem_token' },
  { id: 'emailrep', status: 'erro', erro_codigo: 'sem_chave' }
]);
assert.equal(semCredencial.parcial, false, 'score nao pode marcar parcial por falta de credencial');
const comErro = pontuar([{ id: 'dns', status: 'erro', erro_codigo: 'erro_rede' }]);
assert.equal(comErro.parcial, true, 'score tem que marcar parcial em falha real');

// --- invariantes do registro ------------------------------------------------
assert.equal(REGISTRY.length, 27);
const email = REGISTRY.filter(s => s.tipos.includes('email'));
assert.equal(email.length, 13);
assert.equal(email.reduce((n, s) => n + s.custo, 0), 24);
assert.deepEqual(statsDe(REGISTRY), { total: 27, email: 13, categorias: 6, keys: 0 });
assert.equal(REGISTRY.filter(s => s.chave === true).length, 0, 'o produto nao exige chave do visitante');

// --- manifesto x implementacao ---------------------------------------------
for (const fonte of REGISTRY) {
  const meta = REGISTRY_META.fontes[fonte.id];
  assert.ok(meta, `fonte sem manifesto: ${fonte.id}`);
  assert.deepEqual(fonte.tipos, meta.tipos, `tipos divergentes: ${fonte.id}`);
  assert.equal(fonte.custo, meta.custo, `custo divergente: ${fonte.id}`);
  assert.equal(fonte.ttl, meta.ttl, `ttl divergente: ${fonte.id}`);
  assert.equal(fonte.provenance, meta.provenance, `provenance divergente: ${fonte.id}`);
  assert.equal(fonte.chave, false, `chave de visitante indevida: ${fonte.id}`);
  assert.deepEqual(fonte.requer, meta.requer, `credencial divergente: ${fonte.id}`);
}
assert.equal(Object.keys(REGISTRY_META.fontes).length, REGISTRY.length);

// --- credencial opcional ausente vira erro de configuracao ------------------
const semRede = {
  env: {},
  get: async () => { throw new Error('a rede nao deveria ser chamada sem credencial'); }
};
const alvoEmail = { tipo: 'email', valor: 'teste@example.invalid' };
const alvoCnpj = { tipo: 'cnpj', valor: '00000000000191' };
const github = REGISTRY.find(s => s.id === 'github');
const emailrep = REGISTRY.find(s => s.id === 'emailrep');
const ceis = REGISTRY.find(s => s.id === 'ceis');

await assert.rejects(
  () => github.run(alvoEmail, semRede),
  e => e.codigo === 'sem_token' && /GITHUB_TOKEN/.test(e.message),
  'github sem token deveria falhar com sem_token'
);
await assert.rejects(
  () => emailrep.run(alvoEmail, semRede),
  e => e.codigo === 'sem_chave' && e.env === 'EMAILREP_KEY',
  'emailrep sem chave deveria falhar com sem_chave'
);
await assert.rejects(
  () => ceis.run(alvoCnpj, semRede),
  e => e.codigo === 'sem_chave' && e.env === 'TRANSPARENCIA_KEY',
  'ceis sem chave deveria falhar com sem_chave'
);

// Com a credencial presente, a fonte segue para a camada de rede.
const comCredencial = {
  env: { GITHUB_TOKEN: 'token-de-teste' },
  get: async () => { throw new Error('rede alcancada'); }
};
await assert.rejects(() => github.run(alvoEmail, comCredencial), /rede alcancada/);

console.log(JSON.stringify({
  ok: true,
  fontes: REGISTRY.length,
  email: email.length,
  custo_email: email.reduce((n, s) => n + s.custo, 0),
  categorias: statsDe(REGISTRY).categorias,
  chaves_visitante: statsDe(REGISTRY).keys,
  codigos: CODIGOS_ERRO.length,
  credenciais_opcionais: Object.values(REGISTRY_META.fontes).filter(f => f.requer).map(f => f.id)
}));
