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
import { detectar } from '../src/lib/alvo.mjs';
import { aplicarStats } from './stats.mjs';
import { verificarTokenCalor } from '../src/lib/warm.mjs';
import { sincronizarManifesto, sincronizarCatalogo } from './garantir-manifesto.mjs';
import {
  liberarPortasCanicas,
  portasCanonicas,
  registrarInstancia,
  removerInstancia
} from './dev-instancia.mjs';

// ---------------------------------------------------------------------------
// Manifesto sincronizado ANTES do motor de fontes
// ---------------------------------------------------------------------------
//
// O manifesto (src/sources/registry.json) e a fonte da verdade dos
// metadados das fontes; o modulo gerado (src/sources/registry.meta.mjs) e o
// que o runtime consome. Quando o manifesto muda sem o build rodar, o
// modulo gerado fica velho e o carregamento falha com "fonte sem manifesto:
// <id>" (ou "credencial divergente do manifesto: <id>"). O erro acontece no
// import: o processo morre antes de abrir a porta e a previa do editor abre
// com "o servidor terminou antes de abrir a previa".
//
// Por isso o servidor sincroniza o modulo gerado antes de carregar o motor.
// O carregamento e dinamico de proposito: em ESM o modulo e lido (linked)
// antes de qualquer avaliacao, entao reescrever o arquivo durante a
// avaliacao nao mudaria o modulo ja carregado.
let handleScan = null;
let REGISTRY = [];
try {
  await sincronizarManifesto();
  await sincronizarCatalogo();
  ({ handleScan } = await import('../src/scan.mjs'));
  ({ REGISTRY } = await import('../src/sources/registry.mjs'));
} catch (erro) {
  // Falha aqui nao pode derrubar o servidor: sem motor de fontes a interface
  // ainda abre e o motivo exato fica no log do processo.
  console.error(`[dev] o motor de fontes nao carregou: ${erro.message}`);
}

// ---------------------------------------------------------------------------
// Painel admin: import dinamico, com degradacao explicita
// ---------------------------------------------------------------------------
//
// O painel admin depende de um modulo GERADO (src/admin/catalogo.meta.mjs).
// Em ESM os imports estaticos sao resolvidos (linked) ANTES de qualquer
// codigo do modulo rodar: se o modulo gerado ainda nao existe no disco —
// clone novo, build nao rodado, arquivo apagado — um `import` estatico de
// src/admin/rotas.mjs mata o processo ANTES de abrir a porta. E o editor
// mostra "o servidor terminou antes de abrir a previa".
//
// O mesmo problema ja existia com o manifesto das fontes (ver bloco acima) e
// foi resolvido do mesmo jeito: sincronizar antes e carregar dinamico.
//
// Se o painel nao carregar, o servidor continua no ar e /api/admin/*
// responde 503 com o motivo exato, em vez de derrubar a previa.
let tratarAdmin = async () => new Response(
  JSON.stringify({ ok: false, motivo: 'painel admin indisponivel no servidor local' }),
  { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } }
);
try {
  ({ tratarAdmin } = await import('../src/admin/rotas.mjs'));
} catch (erro) {
  console.error(`[dev] o painel admin nao carregou: ${erro.message}`);
  tratarAdmin = async () => new Response(
    JSON.stringify({ ok: false, motivo: `painel admin indisponivel no servidor local: ${erro.message}` }),
    { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
}

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
// O editor passa HOST e PORT no ambiente do processo filho. A flag --host tem
// precedencia; HOST vale quando e um endereco de loopback.
const HOSTS_DE_LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const hostDoEnv = String(process.env.HOST || '').trim();
const hostCli = opcaoCli('host').trim() || (HOSTS_DE_LOOPBACK.has(hostDoEnv) ? hostDoEnv : '');
// --efemera: pedir uma porta efemera ao sistema, fora da lista de portas
// que a previa do editor usa. O servidor de fundo (`dev:restart`) sobe
// assim, para nunca disputar a porta com a previa em andamento.
const efemeraCli = argumentos.includes('--efemera');
// --sem-fallback: nao cair para outra porta quando a pedida esta ocupada.
// Sem a flag, o servidor tenta outras portas livres para que a previa do
// editor abra mesmo com a porta preferida ja em uso.
const semFallback = argumentos.includes('--sem-fallback');
// --assumir: assumir a porta pedida mesmo que o dono registrado esteja VIVO
// (encerra o dono). Por padrao o servidor so assume a porta de um orfao
// (processo que o iniciou ja morreu): derrubar uma previa viva do editor
// e o que produzia "o servidor terminou antes de abrir a previa".
const assumirCli = argumentos.includes('--assumir');

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

// Painel admin: com SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no ambiente o
// servidor local conversa com o mesmo banco do Worker; sem eles, entra o
// banco em memoria (ADMIN_MODO_LOCAL=1). A chave mestra e efemera por
// execucao: as credenciais gravadas no modo local somem ao reiniciar.
env.SUPABASE_URL = process.env.SUPABASE_URL || '';
env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
env.ADMIN_MODO_LOCAL = (env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY) ? '' : '1';
env.CREDENCIAIS_MASTER_KEY = process.env.CREDENCIAIS_MASTER_KEY ||
  createHash('sha256').update(`osint-local-master:${randomUUID()}`).digest('hex');
env.PROXY_GATEWAY_URL = process.env.PROXY_GATEWAY_URL || '';
env.ADMIN_SENHA = process.env.ADMIN_SENHA || '';

// Credenciais do operador declaradas no manifesto (GITHUB_TOKEN,
// EMAILREP_KEY, TRANSPARENCIA_KEY, NUMVERIFY_API_KEY, DATAJUD_API_KEY,
// CONSULTARPLACA_CREDENCIAL). O valor vem do ambiente do processo e nunca e
// gravado no projeto. Sem a variavel, a fonte responde com o codigo de
// configuracao (sem_chave/sem_token) e o restante do relatorio continua
// valendo.
for (const fonte of REGISTRY) {
  const nome = fonte?.requer?.env;
  if (!nome || env[nome]) continue;
  const valor = process.env[nome];
  if (typeof valor === 'string' && valor.trim()) env[nome] = valor.trim();
}

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
  const cfToken = typeof body?.cfToken === 'string' ? body.cfToken : '';
  if (cfToken.length < 5 || cfToken.length > 4096) return sendJson(res, 400, { error: 'Verificacao obrigatoria.' });
  // O siteverify real exige TURNSTILE_SECRET; localmente o token do shim e aceito.
  return sendJson(res, 200, { token: issueToken(alvo.valor, clientIp(req)) });
}

async function devScan(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Metodo nao permitido.' });
  if (!handleScan) {
    return sendJson(res, 503, { error: 'O motor de fontes nao carregou. Veja o log do servidor.' });
  }
  if (!originAllowed(req.headers.origin || '')) return sendJson(res, 403, { error: 'Origem nao permitida.', origem_recebida: req.headers.origin || null, origens_liberadas: ['localhost', '127.0.0.1', '[::1]'].concat([...allowedOrigins]) });
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'JSON invalido.' }); }
  let alvo;
  try { alvo = detectar(body?.alvo); } catch (e) { return sendJson(res, 400, { error: e.message }); }
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

// Painel admin local: a mesma API do Worker, sobre o mesmo objeto env.
async function devAdmin(req, res) {
  const host = req.headers.host || 'localhost';
  const bruto = (req.method === 'GET' || req.method === 'HEAD') ? null : await readBody(req);
  const cabecalhos = Object.entries(req.headers)
    .filter(([nome]) => !['host', 'connection', 'content-length'].includes(nome))
    .map(([nome, valor]) => [nome, valor]);
  const request = new Request(`http://${host}${req.url || '/'}`, {
    method: req.method,
    headers: cabecalhos,
    body: bruto && bruto.length ? bruto : undefined
  });
  const response = await tratarAdmin(request, env, { ip: clientIp(req) });
  const payload = await response.text();
  const headers = Object.fromEntries(response.headers.entries());
  res.writeHead(response.status, { ...headers, 'cache-control': 'no-store' });
  res.end(payload);
}

async function route(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/api/scan') return devScan(req, res);
  if (pathname === '/api/saude') return devSaude(req, res);
  if (pathname.startsWith('/api/admin')) return devAdmin(req, res);
  if (pathname === '/.netlify/functions/token') return devToken(req, res);
  if (pathname === '/' || pathname === '/index.html') return sendIndex(res);
  if (pathname === '/app.js') return sendFile(res, path.join(publicDir, 'app.js'));
  if (pathname === '/admin' || pathname === '/admin.html') return sendFile(res, path.join(publicDir, 'admin.html'));
  if (pathname === '/admin.js') return sendFile(res, path.join(publicDir, 'admin.js'));
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

// Abre a porta que o editor reservou para a previa.
//
// O editor consulta SOMENTE a porta que reservou: se o servidor cair para
// outra porta, a previa nunca abre ("a previa nao ficou pronta em 2
// minutos"). Por isso a porta e perseguida: enquanto ela estiver ocupada, as
// instancias anteriores DESTE projeto que a seguram sao encerradas e a
// tentativa e refeita. Um dono orfao (o processo que o iniciou ja morreu) e
// um dono vivo de uma previa anterior sao os dois casos que precisam cair:
// enquanto um deles segura a porta, a previa do editor nao abre.
async function abrirPortaReservada(port, bindings, { tentativasMs = 45000 } = {}) {
  // A previa e consultada no endereco principal (127.0.0.1). Abrir apenas o
  // outro loopback nao serve: e o endereco principal que precisa estar no ar.
  const abrir = async () => {
    const abertos = await openPort(port, bindings);
    const principal = abertos.find(o => o.host === bindings[0]);
    if (principal) return abertos;
    for (const aberto of abertos) { try { aberto.server.close(); } catch { /* nao estava ouvindo */ } }
    return [];
  };
  const fim = Date.now() + tentativasMs;
  let tentativa = 0;
  while (Date.now() < fim) {
    tentativa += 1;
    const abertos = await abrir();
    if (abertos.length) return abertos;
    const assumidas = await liberarPortasCanicas({
      portas: [port],
      excetoPid: process.pid,
      apenasOrfas: false
    });
    for (const assumida of assumidas) {
      console.error(`[dev] porta ${assumida.porta} liberada: instancia anterior (pid ${assumida.pid}) encerrada.`);
    }
    if (assumidas.length) {
      const abertos = await abrir();
      if (abertos.length) return abertos;
    }
    if (tentativa === 1) {
      console.error(`[dev] porta ${port} ocupada; tentando de novo por ${Math.round(tentativasMs / 1000)}s.`);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return [];
}

// Quando a porta reservada nao pode ser aberta, o servidor continua no ar em
// outra porta e fica de olho na reservada: se ela for liberada (um preview
// antigo que ainda segurava a porta, por exemplo), ela e aberta e a previa do
// editor passa a responder.
function vigiarPortaReservada(port, bindings) {
  let vigiando = false;
  const timer = setInterval(async () => {
    if (vigiando) return;
    vigiando = true;
    try {
      const abertos = await openPort(port, bindings);
      const principal = abertos.find(o => o.host === bindings[0]);
      if (!principal) {
        for (const aberto of abertos) { try { aberto.server.close(); } catch { /* nao estava ouvindo */ } }
        return;
      }
      clearInterval(timer);
      console.error(`[dev] porta reservada ${port} liberada; a previa do editor passa a responder nela.`);
    } catch { /* nova tentativa no proximo ciclo */ } finally { vigiando = false; }
  }, 2000);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

async function main() {
  // A porta que o editor reservou vem no ambiente (PORT). Ela e obrigatoria:
  // cair para outra porta significa previa que nunca abre.
  const portaDoEditor = !portaCli && process.env.PORT ? Number(process.env.PORT) : null;
  const explicit = portaCli || (Number.isFinite(portaDoEditor) && portaDoEditor > 0 ? portaDoEditor : null);
  // O endereco pedido vem primeiro, mas o outro loopback continua em lista:
  // "localhost" pode resolver para IPv6 ou IPv4, e a previa precisa abrir nos
  // dois casos.
  const bindings = hostCli ? [...new Set([hostCli, ...BINDINGS])] : BINDINGS;
  const candidatas = portasCanonicas();
  // Com porta explicita e sem --sem-fallback, as portas livres alternatives
  // entram na lista: a previa abre em vez de o processo terminar.
  const candidates = explicit
    ? (semFallback ? [explicit] : [explicit, ...candidatas.filter(p => p !== explicit)])
    : candidatas;
  const groups = [];
  // --efemera: porta escolhida pelo sistema, sem disputa com a previa.
  if (efemeraCli) {
    const efemera = await openEphemeral(bindings);
    if (!efemera.length) {
      console.error('[dev] nao foi possivel abrir uma porta efemera para o servidor local.');
      process.exitCode = 1;
      return;
    }
    groups.push({ port: efemera[0].port, opened: efemera, efemera: true });
    console.error(`[dev] porta efemera ${efemera[0].port} (pedido: --efemera).`);
  } else if (explicit && explicit === portaDoEditor) {
    // Porta reservada pelo editor (PORT no ambiente): o servidor precisa
    // abrir EXATAMENTE nessa porta. A tentativa e perseguida e as instancias
    // antigas deste projeto que a seguram sao encerradas.
    const opened = await abrirPortaReservada(explicit, bindings);
    if (opened.length) {
      groups.push({ port: explicit, opened });
    } else if (semFallback) {
      console.error(`[dev] a porta reservada ${explicit} nao pode ser aberta. Defina PORT=<numero> ou use --port <numero> para escolher outra e tente novamente.`);
      process.exitCode = 1;
      return;
    } else {
      // Nao foi possivel abrir a porta reservada. O servidor continua no ar em
      // uma porta efemera: encerrar aqui produziria "o servidor terminou
      // antes de abrir a previa" no editor.
      const efemera = await openEphemeral(bindings);
      if (!efemera.length) {
        console.error(`[dev] nenhuma porta disponivel para o servidor local. Porta reservada: ${explicit}.`);
        process.exitCode = 1;
        return;
      }
      groups.push({ port: efemera[0].port, opened: efemera, efemera: true });
      console.error(`[dev] porta reservada ${explicit} indisponivel; abrindo na porta efemera ${efemera[0].port}.`);
      // Fica de olho na porta reservada: se ela for liberada, a previa do
      // editor passa a responder nela.
      vigiarPortaReservada(explicit, bindings);
    }
  } else {
    // Uma porta so: a primeira que abre. Antes o servidor segurava todas as
    // portas da lista ao mesmo tempo, o que deixava a proxima previa sem porta
    // livre e fazia o processo terminar.
    //
    // Politica de posse da porta: a porta so e ASSUMIDA quando o dono
    // registrado e um orfao (o processo que o iniciou ja morreu) ou quando
    // o operador pediu explicitamente (`--assumir`). Uma previa viva do
    // editor nunca e derrubada por outro servidor: e exatamente isso que
    // produzia "o servidor terminou antes de abrir a previa" (qualquer
    // `npm test` derrubava a previa ao subir o proprio servidor).
    for (const port of candidates) {
      let opened = await openPort(port, bindings);
      if (!opened.length) {
        // A porta esta ocupada. Se o dono registrado for um orfao (ou se o
        // operador mandou assumir), ele e encerrado e a porta e liberada.
        const assumidas = await liberarPortasCanicas({
          portas: [port],
          excetoPid: process.pid,
          apenasOrfas: !assumirCli
        });
        for (const assumida of assumidas) {
          console.error(`[dev] porta ${assumida.porta} liberada: instancia anterior (pid ${assumida.pid}) encerrada.`);
        }
        if (assumidas.length) opened = await openPort(port, bindings);
      }
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
  // Registro da instancia: permite que o proximo servidor assuma a porta
  // canonica e que o `dev:stop` limpe os orfaos sem derrubar a previa viva.
  const papel = efemeraCli ? 'fundo' : 'previa';
  registrarInstancia({
    pid: process.pid,
    porta: groups[0].port,
    papel,
    url: `http://localhost:${groups[0].port}`
  });
  process.on('exit', () => removerInstancia(process.pid));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      removerInstancia(process.pid);
      for (const s of servers) s.close(() => {});
      process.exit(0);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
