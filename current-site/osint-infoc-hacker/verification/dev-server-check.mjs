// Verificacao local do servidor de desenvolvimento (scripts/dev-server.mjs).
//
// Escopo: LOCAL ONLY. Sobe o servidor em porta efemera, exercita as rotas
// (UI estatica, emissao de token e /api/scan) e encerra. As fontes externas
// sao simuladas com um fixture offline, portanto o teste nao depende de rede
// nem comprova disponibilidade dos provedores.

import assert from 'node:assert/strict';
import { createDevServer } from '../scripts/dev-server.mjs';

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
  checks.ui = { status: index.status, bytes: html.length, shimInjetado: true };

  // 2. app.js servido
  const app = await realFetch(`${base}/app.js`);
  const appJs = await app.text();
  assert.equal(app.status, 200);
  assert.ok(appJs.includes('scan-form'), 'app.js nao contem o formulario de scan');
  checks.appJs = { status: app.status, bytes: appJs.length };

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
  checks.origemEstranha = { status: foreign.status };

  // 9. Alvo invalido responde 400
  const badTarget = await realFetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ alvo: '@@@' })
  });
  assert.equal(badTarget.status, 400);
  checks.alvoInvalido = { status: badTarget.status };

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; servidor de desenvolvimento, fontes externas simuladas offline',
    porta: port,
    ...checks
  }));
} finally {
  globalThis.fetch = realFetch;
  server.close();
}
