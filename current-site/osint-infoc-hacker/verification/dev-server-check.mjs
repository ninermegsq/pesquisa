// Verificacao local do servidor de desenvolvimento (scripts/dev-server.mjs).
//
// Escopo: LOCAL ONLY. Sobe o servidor em porta efemera, exercita as rotas
// (UI estatica, emissao de token e /api/scan) e encerra. As fontes externas
// sao simuladas com um fixture offline, portanto o teste nao depende de rede
// nem comprova disponibilidade dos provedores.

import assert from 'node:assert/strict';
import { assinarTokenCalor } from '../src/lib/warm.mjs';

// O segredo do token de operacao tem que existir antes de o servidor local
// ser carregado: o modulo le o ambiente uma unica vez, no import.
const SEGREDO_OPERACAO = 'segredo-de-teste-0123456789';
process.env.WARM_SECRET = SEGREDO_OPERACAO;

const { createDevServer } = await import('../scripts/dev-server.mjs');

const server = createDevServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
const origin = base;

// Fixture offline: apenas as chamadas locais usam a rede real.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith(base)) return realFetch(url, options);
  throw new Error('offline verification fixture');
};

const checks = {};

try {
  // 1. UI estatica servida de public/index.html
  const index = await realFetch(`${base}/`, { headers: { origin } });
  const html = await index.text();
  assert.equal(index.status, 200);
  assert.ok(html.includes('osint-page'), 'index.html nao contem a raiz da interface');
  assert.ok(html.includes('window.turnstile'), 'shim local do Turnstile nao injetado');
  assert.ok(html.includes('/app.js'), 'index.html nao referencia /app.js');
  const scanLog = html.match(/<div id="scan-log"[^>]*>/);
  assert.ok(scanLog, 'elemento #scan-log ausente no HTML servido');
  assert.ok(scanLog[0].includes('role="log"'), '#scan-log sem role=log');
  assert.ok(scanLog[0].includes('aria-live="polite"'), '#scan-log sem aria-live=polite');
  const trustTag = html.match(/<div class="trust-row"[^>]*>/);
  assert.ok(trustTag, 'tag .trust-row ausente no HTML servido');
  const dataStats = trustTag[0].match(/data-stats="([^"]*)"/);
  assert.ok(dataStats, `atributo data-stats ausente ou sem JSON valido. Trecho: ${JSON.stringify(trustTag[0])}`);
  const decodeAttr = v => v.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const stats = JSON.parse(decodeAttr(dataStats[1]));
  assert.equal(stats.total, 32, 'stats.total deveria ser 32');
  assert.equal(stats.email, 13, 'stats.email deveria ser 13');
  assert.equal(stats.categorias, 8, 'stats.categorias deveria ser 8');
  assert.equal(stats.keys, 0, 'stats.keys deveria ser 0');
  assert.ok(!html.includes('{{STATS_'), 'placeholder {{STATS_*}} nao substituido no HTML servido');
  const statIds = ['stat-total', 'stat-auto', 'stat-cats', 'stat-keys'];
  for (const id of statIds) {
    const m = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
    assert.ok(m, `#${id} ausente`);
    assert.ok(/^\d+$/.test(m[1].trim()), `#${id} sem valor numerico: ${JSON.stringify(m[1])}`);
  }
  assert.ok(html.includes('AMBIENTE LOCAL · Turnstile simulado'), 'faixa de Turnstile simulado ausente');
  checks.ui = { status: index.status, bytes: html.length, shimInjetado: true, scanLog: true, dataStats: stats, contadoresNumericos: true, turnstileSimulado: true };

  // 2. app.js servido
  const app = await realFetch(`${base}/app.js`);
  const appJs = await app.text();
  assert.equal(app.status, 200);
  assert.ok(appJs.includes('scan-form'), 'app.js nao contem o formulario de scan');
  checks.appJs = { status: app.status, bytes: appJs.length };

  // 2b. Ativos estaticos servidos de public/ (favicon, robots, sitemap,
  // security.txt e obrigado.html) e guarda de travessia de caminho.
  const estaticos = {};
  for (const [rota, tipoEsperado] of [
    ['/favicon.svg', 'image/svg+xml'],
    ['/robots.txt', 'text/plain'],
    ['/sitemap.xml', 'application/xml'],
    ['/.well-known/security.txt', 'text/plain'],
    ['/obrigado.html', 'text/html']
  ]) {
    const resposta = await realFetch(`${base}${rota}`);
    const corpo = await resposta.text();
    assert.equal(resposta.status, 200, `${rota} deveria responder 200`);
    assert.ok((resposta.headers.get('content-type') || '').includes(tipoEsperado), `${rota} com content-type inesperado`);
    assert.ok(corpo.length > 0, `${rota} servido vazio`);
    estaticos[rota] = { status: resposta.status, bytes: corpo.length };
  }
  // Caminho codificado que sairia de public/ tem de ser recusado com 404.
  const travessia = await realFetch(`${base}/%2e%2e%2f%2e%2e%2fpackage.json`);
  assert.equal(travessia.status, 404, 'travessia de caminho deveria responder 404');
  estaticos.travessia = { status: travessia.status };
  checks.estaticos = estaticos;

  // 3. GET /.netlify/functions/token expoe a site key publica
  const siteKeyRes = await realFetch(`${base}/.netlify/functions/token`, { headers: { origin } });
  const siteKey = await siteKeyRes.json();
  assert.equal(siteKeyRes.status, 200);
  assert.equal(typeof siteKey.siteKey, 'string');
  checks.tokenGet = { status: siteKeyRes.status, siteKeyPresente: Boolean(siteKey.siteKey) };

  // 4. POST /.netlify/functions/token emite token de uso unico
  const tokenRes = await realFetch(`${base}/.netlify/functions/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ alvo: 'smoke-check@example.invalid', cfToken: 'local-dev-turnstile-token' })
  });
  const issued = await tokenRes.json();
  assert.equal(tokenRes.status, 200);
  assert.equal(typeof issued.token, 'string');
  checks.tokenPost = { status: tokenRes.status, tokenEmitido: true };

  // 5. Primeiro uso do token e aceito e devolve o relatorio do motor real
  const first = await realFetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ alvo: 'smoke-check@example.invalid', token: issued.token })
  });
  assert.equal(first.status, 200, 'o primeiro uso do token deveria ser aceito');
  const report = await first.json();
  assert.equal(report.alvo.tipo, 'email');
  assert.ok(Array.isArray(report.fontes) && report.fontes.length > 0, 'relatorio sem fontes');
  assert.equal(typeof report.html, 'string');
  assert.equal(typeof report.score.valor, 'number');
  checks.scan = { status: first.status, fontes: report.fontes.length, score: report.score.valor };

  // 6. Reuso do mesmo token e recusado
  const replay = await realFetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ alvo: 'smoke-check@example.invalid', token: issued.token })
  });
  assert.equal(replay.status, 429, 'replay do token deveria ser recusado com 429');
  checks.replay = { status: replay.status };

  // 7. Token invalido e recusado
  const invalid = await realFetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ alvo: 'smoke-check@example.invalid', token: 'invalido.invalido' })
  });
  assert.equal(invalid.status, 429);
  checks.tokenInvalido = { status: invalid.status };

  // 8. Origem nao autorizada e recusada
  const foreign = await realFetch(`${base}/.netlify/functions/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://ostnt.online' },
    body: JSON.stringify({ alvo: 'smoke-check@example.invalid', cfToken: 'local-dev-turnstile-token' })
  });
  assert.equal(foreign.status, 403);
  const foreignBody = await foreign.json();
  assert.equal(foreignBody.origem_recebida, 'https://ostnt.online', '403 sem origem_recebida');
  assert.ok(Array.isArray(foreignBody.origens_liberadas) && foreignBody.origens_liberadas.includes('localhost'), '403 sem origens_liberadas');
  checks.origemEstranha = { status: foreign.status, origem_recebida: foreignBody.origem_recebida, origens_liberadas: foreignBody.origens_liberadas };

  // 9. Alvo invalido responde 400
  const badTarget = await realFetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ alvo: '@@@' })
  });
  assert.equal(badTarget.status, 400);
  checks.alvoInvalido = { status: badTarget.status };

  // 10. O painel de saude exige token de operador
  const saudeSemToken = await realFetch(`${base}/api/saude`, { headers: { origin } });
  assert.equal(saudeSemToken.status, 401, 'saude sem token deveria responder 401');
  checks.saudeSemToken = { status: saudeSemToken.status };

  // 11. Token de operador abre o painel de saude
  const tokenOperador = assinarTokenCalor({ segredo: SEGREDO_OPERACAO, escopo: 'operador', ttlSegundos: 600 }).token;
  const saude = await realFetch(`${base}/api/saude`, { headers: { origin, 'x-warm-token': tokenOperador } });
  assert.equal(saude.status, 200, 'saude com token de operador deveria responder 200');
  const painel = await saude.json();
  assert.ok(painel.jobs && typeof painel.jobs.total === 'number', 'painel sem contagem de jobs');
  assert.ok(Array.isArray(painel.fontes), 'painel sem saude por fonte');
  checks.saude = { status: saude.status, jobs: painel.jobs.total, fontes: painel.fontes.length };

  // 12. Token de aquecimento consulta as fontes sem token de uso unico
  const alvoCalor = 'aquecimento@example.invalid';
  const tokenCalor = assinarTokenCalor({ alvo: alvoCalor, segredo: SEGREDO_OPERACAO, escopo: 'aquecimento', ttlSegundos: 600 }).token;
  const aquecimento = await realFetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-warm-token': tokenCalor },
    body: JSON.stringify({ alvo: alvoCalor })
  });
  assert.equal(aquecimento.status, 200, 'scan com token de aquecimento deveria ser aceito');
  const relatorioCalor = await aquecimento.json();
  assert.ok(relatorioCalor.meta?.job_id, 'scan sem job_id');
  assert.equal(aquecimento.headers.get('x-job-id'), relatorioCalor.meta.job_id, 'header x-job-id diferente do meta.job_id');
  assert.ok(relatorioCalor.saude && typeof relatorioCalor.saude.parcial === 'boolean', 'relatorio sem resumo de saude');
  assert.ok(Array.isArray(relatorioCalor.fonte_saude) && relatorioCalor.fonte_saude.length > 0, 'relatorio sem saude por fonte');
  checks.aquecimento = { status: aquecimento.status, job_id: relatorioCalor.meta.job_id, fontes: relatorioCalor.fontes.length };

  // 13. Token de aquecimento amarrado a outro alvo e recusado
  const tokenOutro = assinarTokenCalor({ alvo: 'outro@example.invalid', segredo: SEGREDO_OPERACAO, escopo: 'aquecimento', ttlSegundos: 600 }).token;
  const errado = await realFetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-warm-token': tokenOutro },
    body: JSON.stringify({ alvo: alvoCalor })
  });
  assert.equal(errado.status, 429, 'token de aquecimento de outro alvo deveria ser recusado');
  checks.aquecimentoAlvoDivergente = { status: errado.status };

  // 14. Aviso do funil de visitas: a exportacao acontece no navegador e o
  // aviso chega ao Worker. Localmente a chamada e aceita e descartada.
  const evento = await realFetch(`${base}/api/evento`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ etapa: 'exportacao', formato: 'json' })
  });
  assert.equal(evento.status, 200, '/api/evento deveria aceitar o aviso de exportacao');
  const eventoBody = await evento.json();
  assert.equal(eventoBody.ok, true, '/api/evento sem ok:true');
  checks.evento = { status: evento.status };

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; servidor de desenvolvimento, fontes externas simuladas offline',
    porta: port,
    ...checks
  }));
} finally {
  globalThis.fetch = realFetch;
  server.close();
}
