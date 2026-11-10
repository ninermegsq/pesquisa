// Servidor de desenvolvimento local do scanner OSINT.
//
// Substitui o `wrangler dev` quando o Wrangler nao esta instalado na maquina:
// sobe um servidor HTTP em Node puro, sem dependencias, sem conta Cloudflare e
// sem segredos de producao. A maquina precisa apenas de Node 20+.
//
// O que e real (mesmo codigo de producao):
//   - motor de fontes: src/scan.mjs + src/sources/registry.mjs
//   - deteccao de alvo, cache com TTL, rate limit e relatorio HTML
//   - public/index.html e public/app.js servidos a partir de public/
//
// O que e local (somente para desenvolvimento):
//   - Turnstile: substituido por um shim injetado no HTML servido
//   - token de uso unico: HMAC com segredo efemero por execucao
//   - Allowed Origins: aceita apenas origens locais
//   - Cache API, KV e Durable Object: simulados em memoria
//
// Nada aqui altera o Worker de producao: public/ e cloudflare-worker.mjs
// permanecem intactos.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleScan } from '../src/scan.mjs';
import { detectar } from '../src/lib/alvo.mjs';
import { aplicarStats } from './stats.mjs';
import { REGISTRY } from '../src/sources/registry.mjs';
import { verificarTokenCalor } from '../src/lib/warm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicDir = path.join(root, 'public');

// Argumentos de linha de comando: --port <numero> e --host <endereco>.
// O preview do editor abre a URL automaticamente, por isso a porta pode ser
// fixada e o endereco pode ser restringido a uma interface.
const argumentos = process.argv.slice(2);
const opcaoCli = nome => {
  for (let i = 0; i < argumentos.length; i++) {
    const arg = argumentos[i];
    if (arg === `--${nome}`) return argumentos[i + 1] ?? '';
    if (arg.startsWith(`--${nome}=`)) return arg.slice(nome.length + 3);
  }
  return '';
};
const portaCli = Number(opcaoCli('port')) || null;
const hostCli = opcaoCli('host').trim();
// --sem-fallback: nao cair para outra porta quando a pedida esta ocupada.
// Sem a flag, o servidor tenta outras portas livres para que a previa do
// editor abra mesmo com a porta preferida ja em uso.
const semFallback = argumentos.includes('--sem-fallback');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

// ---------------------------------------------------------------------------
// Simulacao das APIs do runtime Cloudflare
// ---------------------------------------------------------------------------

const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      const key = typeof request === 'string' ? request : request.url;
      const hit = cacheStore.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(request, response) {
      const key = typeof request === 'string' ? request : request.url;
      cacheStore.set(key, response.clone());
    },
    async delete(request) {
      const key = typeof request === 'string' ? request : request.url;
      return cacheStore.delete(key);
    }
  }
};

// HTMLRewriter minimo: espelha a API do runtime Cloudflare, em que transform()
// devolve a Response de imediato e os handlers disparam na leitura do corpo.
// Suficiente para o seletor de classe usado pela fonte telegram (registry.mjs).
// Qualquer seletor nao suportado e ignorado.
class LocalHTMLRewriter {
  constructor() { this.handlers = []; }
  on(selector, handlers) { this.handlers.push({ selector, handlers }); return this; }
  transform(response) {
    const registered = this.handlers;
    const parse = async () => {
      const type = response.headers.get('content-type') || '';
      if (!type.includes('text/html')) return response.text();
      let html = await response.text();
      for (const { selector, handlers } of registered) {
        if (!selector.startsWith('.')) continue;
        const cls = selector.slice(1);
        const pattern = new RegExp(
          `<([a-zA-Z][\\w-]*)\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>`,
          'g'
        );
        html = html.replace(pattern, (match, tag, inner) => {
          const content = inner.replace(/<[^>]+>/g, '');
          for (const [type_, fn] of Object.entries(handlers || {})) {
            if (type_ === 'text' && typeof fn === 'function') fn({ text: content });
          }
          return match;
        });
      }
      return html;
    };
    // No Cloudflare, transform() e sincrono e devolve a Response; aqui o parse
    // acontece em .text(), que e o unico metodo usado pela fonte.
    return {
      async text() { return parse(); },
      get ok() { return response.ok; },
      get status() { return response.status; },
      get headers() { return response.headers; }
    };
  }
}
if (!globalThis.HTMLRewriter) globalThis.HTMLRewriter = LocalHTMLRewriter;

// KV em memoria (apenas rate limit).
const kvStore = new Map();
const kv = {
  async get(key) { return kvStore.has(key) ? kvStore.get(key) : null; },
  async put(key, value) { kvStore.set(key, value); },
  async delete(key) { return kvStore.delete(key); }
};

const env = {
  OSINT_KV: kv,
  CACHE: null,
  UA_MODE: 'identificado',
  UA: 'ostnt.online scanner (+https://ostnt.online)',
  UA_NAVEGADOR: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
  BUDGET_SUBREQ: '38',
  TURNSTILE_SITEKEY: '1x00000000000000000000AA'
};

// Token de operacao no ambiente local: so funciona quando o operador define
// WARM_SECRET (ou HMAC_SECRET) e usa o mesmo valor em scripts/warm-token.mjs.
const WARM_ENV = {
  WARM_SECRET: process.env.WARM_SECRET || process.env.HMAC_SECRET || '',
  HMAC_SECRET: process.env.HMAC_SECRET || ''
};

// Historico local de scans (o Durable Object nao existe fora do Cloudflare).
const historicoJobs = [];
const CODES_DE_CONFIGURACAO = ['sem_chave', 'sem_token'];
function registrarJobLocal(payload, escopo) {
  const jobId = payload?.meta?.job_id;
  if (!jobId) return;
  const fontes = Array.isArray(payload?.fontes) ? payload.fontes : [];
  historicoJobs.push({
    job_id: jobId,
    criado_em: Date.now(),
    escopo: escopo || 'visitante',
    total: fontes.length,
    ok: fontes.filter(f => f.status === 'ok').length,
    falhas: fontes.filter(f => f.status !== 'ok' && !CODES_DE_CONFIGURACAO.includes(f.erro_codigo)).length,
    fontes: Array.isArray(payload?.fonte_saude) ? payload.fonte_saude : []
  });
  if (historicoJobs.length > 200) historicoJobs.shift();
}
function saudeLocal() {
  const porFonte = {};
  for (const job of historicoJobs) {
    for (const fonte of job.fontes || []) {
      const item = porFonte[fonte.id] || (porFonte[fonte.id] = { id: fonte.id, ok: 0, falhas: 0, codigos: {} });
      if (fonte.status === 'ok') { item.ok++; continue; }
      item.falhas++;
      const codigo = fonte.erro_codigo || 'erro';
      item.codigos[codigo] = (item.codigos[codigo] || 0) + 1;
    }
  }
  const total = historicoJobs.length;
  const parciais = historicoJobs.filter(j => j.falhas > 0).length;
  return {
    gerado_em: new Date().toISOString(),
    escopo: 'local',
    aviso: 'Saude local em memoria: reiniciar o servidor apaga o historico.',
    schema: [],
    versao_migracoes: null,
    jobs: { total, parciais, completos: total - parciais },
    fontes: Object.values(porFonte).sort((a, b) => a.id.localeCompare(b.id))
  };
}

// ---------------------------------------------------------------------------
// Token de uso unico (HMAC local)
// ---------------------------------------------------------------------------

const HMAC_SECRET = createHash('sha256').update(`osint-local-dev:${randomUUID()}`).digest('hex');
const usedNonces = new Map();
const sha256 = value => createHash('sha256').update(value).digest('hex');

const issueToken = (alvoValor, ip) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ exp: now + 60, ip, emailHash: sha256(alvoValor), nonce: randomUUID() }),
    'utf8'
  ).toString('base64url');
  const mac = createHmac('sha256', HMAC_SECRET).update(payload).digest('base64url');
  return `${payload}.${mac}`;
};

const consumeToken = (token, alvoValor, ip) => {
  if (typeof token !== 'string' || !token || token.length > 2000) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[\w-]+$/.test(parts[0]) || !/^[\w-]+$/.test(parts[1])) return false;
  const expected = createHmac('sha256', HMAC_SECRET).update(parts[0]).digest();
  const received = Buffer.from(parts[1], 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(expected, received)) return false;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return false; }
  if (payload.ip !== ip || payload.emailHash !== sha256(alvoValor)) return false;
  if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return false;
  if (typeof payload.nonce !== 'string') return false;
  const now = Date.now();
  for (const [nonce, expira] of usedNonces) if (expira <= now) usedNonces.delete(nonce);
  if (usedNonces.has(payload.nonce)) return false;
  usedNonces.set(payload.nonce, (payload.exp + 1) * 1000);
  return true;
};

// ---------------------------------------------------------------------------
// Rotas locais
// ---------------------------------------------------------------------------

const allowedOrigins = new Set(
  String(env.ALLOWED_ORIGINS).split(',').map(v => v.trim()).filter(Boolean)
);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const originAllowed = origin => {
  if (!origin) return false;
  if (LOCAL_ORIGIN.test(origin)) return true;
  return allowedOrigins.has(origin);
};

const clientIp = req => {
  const raw = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!raw || raw === '::1') return '127.0.0.1';
  return raw;
};

// O rate limit real (10 scans/hora e 60/dia por IP) vale para producao.
// Em desenvolvimento local o bucket recebe um sufixo de sessao, para que
// testar repetidamente no preview nao esgote a cota do proprio operador.
// O vinculo do token continua usando o IP puro, como em producao.
const SESSION_ID = randomUUID();
const rateLimitIp = ip => `${ip}#${SESSION_ID}`;

const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > 1024 * 1024) { reject(new Error('corpo grande demais')); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const sendBuffer = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
};

// Shim do Turnstile injetado somente no HTML servido pelo servidor local.
const DEV_SHIM = `<script data-osint-dev="local">
/* AVISO: shim de desenvolvimento local.
   Injetado apenas pelo servidor de dev (scripts/dev-server.mjs).
   Simula o widget do Cloudflare Turnstile para que a previa funcione sem
   segredos de producao. O Worker real continua exigindo Turnstile. */
window.__OSINT_DEV__ = true;
(function () {
  var style = document.createElement('style');
  style.textContent = '.osint-dev-note{position:fixed;right:10px;bottom:10px;z-index:9999;max-width:250px;padding:8px 10px;border:1px dashed #4a3410;border-radius:8px;background:#17120a;color:#fbbf24;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.4}';
  document.head.appendChild(style);
  function mountNote() {
    if (!document.body || document.querySelector('.osint-dev-note')) return;
    var note = document.createElement('div');
    note.className = 'osint-dev-note';
    note.textContent = 'AMBIENTE LOCAL · Turnstile simulado · sem dados de producao';
    document.body.appendChild(note);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountNote);
  else mountNote();
  window.turnstile = {
    render: function (box, options) {
      if (box) box.setAttribute('data-turnstile-local', '1');
      var token = 'local-dev-turnstile-token';
      if (options && typeof options.callback === 'function') setTimeout(function () { options.callback(token); }, 0);
      return 'local-dev-widget';
    },
    remove: function () {},
    reset: function () {},
    getResponse: function () { return 'local-dev-turnstile-token'; }
  };
})();
</script>`;

const injectShim = html => {
  const marker = '<script src="/app.js';
  const at = html.indexOf(marker);
  if (at === -1) return html.replace('</head>', `${DEV_SHIM}\n</head>`);
  return html.slice(0, at) + DEV_SHIM + '\n' + html.slice(at);
};

async function sendIndex(res) {
  let html;
  try { html = await readFile(path.join(publicDir, 'index.html'), 'utf8'); }
  catch { return sendJson(res, 500, { error: 'public/index.html nao encontrado.' }); }
  sendBuffer(res, 200, injectShim(aplicarStats(html, REGISTRY)), { 'content-type': MIME['.html'] });
}

async function sendFile(res, file, type) {
  try {
    const body = await readFile(file);
    sendBuffer(res, 200, body, { 'content-type': type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  } catch {
    sendJson(res, 404, { error: 'Nao encontrado.' });
  }
}

async function sendStatic(res, pathname) {
  // Guarda de travessia de caminho: o alvo precisa continuar dentro de public/.
  // A comparacao usa path.relative, e nao startsWith, porque "public-seguro"
  // comeca com "public" mas esta fora de "public/".
  const alvo = path.resolve(publicDir, path.normalize(pathname).replace(/^([/\\])+/, ''));
  const relativo = path.relative(publicDir, alvo);
  if (!relativo || relativo.startsWith('..') || path.isAbsolute(relativo)) {
    return sendJson(res, 404, { error: 'Nao encontrado.' });
  }
  await sendFile(res, alvo);
}

async function devToken(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, { siteKey: '1x00000000000000000000AA', devMode: true });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Metodo nao permitido.' });
  if (!originAllowed(req.headers.origin || '')) return sendJson(res, 403, { error: 'Origem nao permitida.', origem_recebida: req.headers.origin || null, origens_liberadas: ['localhost', '127.0.0.1', '[::1]'].concat([...allowedOrigins]) });
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON invalido.' }); }
  let alvo;
  try { alvo = detectar(body?.alvo); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  if (alvo.tipo === 'cpf') return sendJson(res, 400, { error: 'Consulta de CPF fora do escopo.' });
  const cfToken = typeof body?.cfToken === 'string' ? body.cfToken : '';
  if (cfToken.length < 5 || cfToken.length > 4096) return sendJson(res, 400, { error: 'Verificacao obrigatoria.' });
  // O siteverify real exige TURNSTILE_SECRET; localmente o token do shim e aceito.
  return sendJson(res, 200, { token: issueToken(alvo.valor, clientIp(req)) });
}

async function devScan(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Metodo nao permitido.' });
  if (!originAllowed(req.headers.origin || '')) return sendJson(res, 403, { error: 'Origem nao permitida.', origem_recebida: req.headers.origin || null, origens_liberadas: ['localhost', '127.0.0.1', '[::1]'].concat([...allowedOrigins]) });
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON invalido.' }); }
  let alvo;
  try { alvo = detectar(body?.alvo); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  if (alvo.tipo === 'cpf') return sendJson(res, 400, { error: 'Consulta de CPF fora do escopo.' });
  const ip = clientIp(req);
  // Token de operacao (escopo aquecimento): mesma porta de entrada do Worker.
  const calor = verificarTokenCalor(req.headers['x-warm-token'], { env: WARM_ENV, escopo: 'aquecimento', alvo: alvo.valor });
  if (!calor.ok && !consumeToken(body?.token, alvo.valor, ip)) {
    return sendJson(res, 429, { error: 'Token ausente, expirado, reutilizado ou vinculado a outro alvo.' });
  }
  const host = req.headers.host || 'localhost';
  const request = new Request(`http://${host}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  // O token foi validado contra o IP real; o rate limit usa a chave de sessao
  // local para nao gastar a cota de producao durante o desenvolvimento.
  const response = await handleScan(request, env, calor.ok ? `${rateLimitIp(ip)}#aquecimento` : rateLimitIp(ip), { escopo: calor.ok ? 'aquecimento' : 'visitante' });
  const payload = await response.text();
  try { registrarJobLocal(JSON.parse(payload), calor.ok ? 'aquecimento' : 'visitante'); } catch { /* payload inesperado */ }
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, { ...headers, 'cache-control': 'no-store' });
  res.end(payload);
}

// Painel de saude do operador. Fora do Cloudflare o historico fica em
// memoria; a leitura exige um token de operador (escopo "operador").
async function devSaude(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Metodo nao permitido.' });
  const auth = verificarTokenCalor(req.headers['x-warm-token'], { env: WARM_ENV, escopo: 'operador' });
  if (!auth.ok) return sendJson(res, 401, { error: 'Token de operador ausente ou invalido.', motivo: auth.motivo });
  return sendJson(res, 200, saudeLocal());
}

async function route(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/api/scan') return devScan(req, res);
  if (pathname === '/api/saude') return devSaude(req, res);
  if (pathname === '/.netlify/functions/token') return devToken(req, res);
  if (pathname === '/' || pathname === '/index.html') return sendIndex(res);
  if (pathname === '/app.js') return sendFile(res, path.join(publicDir, 'app.js'));
  if (pathname === '/og.png') return sendFile(res, path.join(publicDir, 'og.png'));
  // favicon.svg, robots.txt, sitemap.xml, .well-known/security.txt e
  // obrigado.html sao servidos de public/ como os demais arquivos estaticos.
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Metodo nao permitido.' });
  return sendStatic(res, pathname);
}

export function createDevServer() {
  return createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (e) {
      console.error('[dev] erro interno:', e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Erro interno no servidor local.' });
      else res.end();
    }
  });
}

// Uma instancia por par (porta, endereco): o Node nao aceita dois `listen`
// na mesma instancia. 127.0.0.1 e ::1 sao tentados para que `localhost`
// funcione em maquinas que resolvem IPv4 ou IPv6 primeiro.
const BINDINGS = ['127.0.0.1', '::1'];

function listenOn(server, port, host) {
  return new Promise(resolve => {
    const onError = () => {
      server.removeListener('listening', onListening);
      resolve(null);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      server.on('error', error => console.error(`[dev] erro em ${host}:${port}:`, error.message));
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function openPort(port, bindings = BINDINGS) {
  const opened = [];
  for (const host of bindings) {
    const server = createDevServer();
    const address = await listenOn(server, port, host);
    if (!address) { try { server.close(); } catch { /* nao estava ouvindo */ } continue; }
    opened.push({ server, host, port: address.port });
  }
  return opened;
}

// Ultimo recurso: uma porta efemera escolhida pelo sistema. Mantem o mesmo
// numero de porta em IPv4 e IPv6 para que "localhost" funcione igual.
async function openEphemeral(bindings = BINDINGS) {
  const [primeiro, ...resto] = bindings;
  if (!primeiro) return [];
  const base = await openPort(0, [primeiro]);
  if (!base.length) return [];
  const opened = [...base];
  const port = base[0].port;
  for (const host of resto) {
    const server = createDevServer();
    const address = await listenOn(server, port, host);
    if (address) opened.push({ server, host, port: address.port });
    else { try { server.close(); } catch { /* nao estava ouvindo */ } }
  }
  return opened;
}

async function main() {
  const explicit = portaCli || (process.env.PORT ? Number(process.env.PORT) : null);
  const bindings = hostCli ? [hostCli] : BINDINGS;
  const candidatas = [3000, 5173, 8080, 4173, 5000, 3001, 5174, 8000, 8888];
  // Com porta explicita e sem --sem-fallback, as portas livres alternatives
  // entram na lista: a previa abre em vez de o processo terminar.
  const candidates = explicit
    ? (semFallback ? [explicit] : [explicit, ...candidatas.filter(p => p !== explicit)])
    : candidatas;
  const groups = [];
  // Uma porta so: a primeira que abre. Antes o servidor segurava todas as
  // portas da lista ao mesmo tempo, o que deixava a proxima previa sem porta
  // livre e fazia o processo terminar.
  for (const port of candidates) {
    const opened = await openPort(port, bindings);
    if (!opened.length) continue;
    groups.push({ port, opened });
    break;
  }
  if (!groups.length) {
    const attemptadas = candidates.join(', ');
    if (semFallback) {
      console.error(`[dev] nenhuma porta disponivel para o servidor local. Portas tentadas: ${attemptadas}. Defina PORT=<numero> ou use --port <numero> para escolher outra e tente novamente.`);
      process.exitCode = 1;
      return;
    }
    // Ultimo recurso: porta efemera do sistema. O servidor local nao pode
    // terminar por causa de porta ocupada, senao o preview do editor abre com
    // "o servidor terminou antes de abrir a previa".
    const efemera = await openEphemeral(bindings);
    if (!efemera.length) {
      console.error(`[dev] nenhuma porta disponivel para o servidor local. Portas tentadas: ${attemptadas}. Defina PORT=<numero> ou use --port <numero> para escolher outra e tente novamente.`);
      process.exitCode = 1;
      return;
    }
    groups.push({ port: efemera[0].port, opened: efemera, efemera: true });
    console.error(`[dev] portas fixas ocupadas (${attemptadas}); abrindo na porta efemera ${efemera[0].port}.`);
  }
  const servers = groups.flatMap(g => g.opened.map(o => o.server));
  console.log('');
  console.log('  OSINT // infoc.hacker — servidor local de desenvolvimento');
  console.log('  ------------------------------------------------------------');
  console.log('  UI e motor de fontes reais do projeto.');
  console.log('  Turnstile e token de uso unico sao simulados localmente.');
  console.log('  Sem Wrangler, sem conta Cloudflare, sem segredos de producao.');
  console.log('');
  for (const group of groups) {
    const hosts = [...new Set(group.opened.map(o => o.host))];
    console.log(`  previa: http://localhost:${group.port}   (${hosts.join(', ')})`);
  }
  console.log('');
  console.log(`  Server running on http://localhost:${groups[0].port}`);
  console.log(`  NEXUS_PREVIEW_URL=http://localhost:${groups[0].port}`);
  console.log('');
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { for (const s of servers) s.close(() => {}); process.exit(0); });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
