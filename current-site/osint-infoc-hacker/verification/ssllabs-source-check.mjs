// Verificacao da fonte de TLS (Qualys SSL Labs).
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede: as respostas vem de fixtures
// offline copiadas do formato real da API v3 do SSL Labs.
//
// O check existe porque a fonte anterior (Mozilla Observatory) respondia 404
// em todas as rotas /api/*: a API publica foi descontinuada. A fonte nova
// precisa tratar tres estados sem quebrar o scan: avaliacao pronta (READY),
// avaliacao recem-iniciada sem nota (IN_PROGRESS) e dominio que nao resolve
// (DNS). IN_PROGRESS nao e erro: e o provedor dizendo que ainda nao ha nota.
//
// O check tambem trava a URL chamada (api.ssllabs.com, fromCache=on,
// maxAge=24) e a proveniencia declarada no manifesto.

import assert from 'node:assert/strict';

const { REGISTRY } = await import('../src/sources/registry.mjs');
const { ctx } = await import('../src/lib/http.mjs');
const { rodar } = await import('../src/scan.mjs');

// --- a fonte existe no registro ---------------------------------------------
const fonte = REGISTRY.find(f => f.id === 'ssllabs');
assert.ok(fonte, 'fonte ssllabs ausente no registro');
assert.deepEqual(fonte.tipos, ['dominio']);
assert.equal(fonte.custo, 1);
assert.equal(fonte.provenance, 'qualys-ssllabs');
assert.equal(REGISTRY.find(f => f.id === 'observatory'), undefined, 'a fonte observatory nao deve mais existir');

// --- fixtures offline do SSL Labs --------------------------------------------
// Formato real da resposta v3 (copiado da chamada ao vivo): a nota vem por
// endpoint (`endpoints[].grade`), nao no nivel do host, e os tempos sao epoch.
const PRONTO = {
  host: 'ostnt.online',
  port: 443,
  protocol: 'http',
  status: 'READY',
  startTime: 1794313722569,
  testTime: 1794314077029,
  engineVersion: '2.4.3',
  criteriaVersion: '2009q',
  endpoints: [
    { ipAddress: '2606:4700:3031:0:0:0:ac43:d199', statusMessage: 'Ready', grade: 'A+', hasWarnings: false, progress: 100 },
    { ipAddress: '104.21.61.112', statusMessage: 'Ready', grade: 'A', hasWarnings: true, progress: 100 }
  ]
};
const EM_ANDAMENTO = { status: 'IN_PROGRESS', statusMessage: 'Assessment in progress.' };
const SEM_DNS = { status: 'DNS', statusMessage: 'Unable to resolve host name.' };

const realFetch = globalThis.fetch;
const chamadas = [];
let respostaAtual = PRONTO;
let statusHttp = 200;
globalThis.fetch = async url => {
  chamadas.push(String(url));
  const corpo = statusHttp === 200 ? JSON.stringify(respostaAtual) : 'upstream busy';
  return new Response(corpo, { status: statusHttp, headers: { 'content-type': 'application/json' } });
};

try {
  const c = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0' }, 'https://validation.example');
  const alvo = { tipo: 'dominio', valor: 'ostnt.online' };

  // 1. Avaliacao pronta.
  let saida = await fonte.run(alvo, c);
  assert.equal(chamadas[0], 'https://api.ssllabs.com/api/v3/analyze?host=ostnt.online&fromCache=on&maxAge=24',
    `URL do SSL Labs inesperada: ${chamadas[0]}`);
  assert.equal(saida.dados.situacao, 'pronta');
  assert.equal(saida.dados.nota, 'A', 'a nota exibida deve ser a pior entre os endpoints');
  assert.equal(saida.dados.servidores, 2);
  assert.equal(saida.dados.avaliadoEm, new Date(1794314077029).toISOString());
  assert.equal(saida.dados.avaliacaoIniciadaEm, new Date(1794313722569).toISOString());
  assert.equal(saida.dados.avisos.length, 1);
  assert.equal(saida.dados.avisos[0].ip, '104.21.61.112');
  assert.match(saida.dados.observacao, /SSL Labs/);

  // 2. Avaliacao em andamento: nao e erro e nao tem nota.
  respostaAtual = EM_ANDAMENTO;
  saida = await fonte.run(alvo, c);
  assert.equal(saida.dados.situacao, 'em_andamento');
  assert.equal(saida.dados.nota, null);
  assert.match(saida.dados.observacao, /ainda nao publicou a nota/);
  // TTL proprio: o estado "sem nota" vale por pouco tempo, para que a
  // proxima consulta encontre a avaliacao ja publicada pelo provedor.
  assert.equal(saida.ttl, 300, 'o estado em andamento deveria ter TTL proprio de 300s');

  // 3. Dominio sem resolucao: tambem nao e erro.
  respostaAtual = SEM_DNS;
  saida = await fonte.run(alvo, c);
  assert.equal(saida.dados.situacao, 'dns');
  assert.equal(saida.dados.nota, null);

  // 4. Erro do provedor: vira excecao (falha real).
  respostaAtual = { status: 'ERROR', statusMessage: 'Unable to determine the TLS configuration.' };
  await assert.rejects(() => fonte.run(alvo, c), /Unable to determine the TLS configuration/);

  // 5. Limite de requisicoes do provedor tambem e falha real.
  respostaAtual = { status: 'RATE_LIMIT', statusMessage: 'Too many requests.' };
  await assert.rejects(() => fonte.run(alvo, c), /limite de requisicoes do SSL Labs/);

  // 6. HTTP diferente de 200: a fonte propaga o erro com status e corpo.
  statusHttp = 503;
  await assert.rejects(() => fonte.run(alvo, c), e => /HTTP 503/.test(e.message) && /upstream busy/.test(e.message));
  statusHttp = 200;

  // 7. TTL do cache: a fonte usa o TTL proprio quando devolve um estado
  // temporario e o TTL da fonte quando a avaliacao esta pronta.
  const entries = new Map();
  globalThis.caches = { default: { async match(k) { return entries.get(k.url)?.clone(); }, async put(k, r) { entries.set(k.url, r.clone()); } } };
  const cacheCtx = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0' }, 'https://local.test');
  respostaAtual = EM_ANDAMENTO;
  await rodar(fonte, alvo, cacheCtx);
  const chave = `https://local.test/__cache/ssllabs/ostnt.online`;
  assert.equal(entries.get(chave)?.headers.get('cache-control'), 'public, max-age=300',
    'o cache do estado em andamento deveria durar 300s');
  entries.clear();
  respostaAtual = PRONTO;
  await rodar(fonte, alvo, cacheCtx);
  assert.equal(entries.get(chave)?.headers.get('cache-control'), 'public, max-age=3600',
    'o cache da avaliacao pronta deveria durar o TTL da fonte (3600s)');

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; fixtures offline do SSL Labs',
    fonte: 'ssllabs',
    url: chamadas[0],
    ready: { situacao: 'pronta', nota: 'A (pior entre 2 endpoints)', servidores: 2, avisos: 1 },
    inProgress: 'em_andamento (sem nota, sem erro)',
    dns: 'dns (sem avaliacao TLS)',
    erros: 'ERROR, RATE_LIMIT e HTTP 503 falham de verdade',
    cache: { emAndamento: 300, pronta: 3600 }
  }));
} finally {
  globalThis.fetch = realFetch;
}
