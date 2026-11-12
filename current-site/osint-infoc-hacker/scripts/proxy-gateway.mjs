// Gateway de proxy: o transporte que falta ao Worker.
//
// Por que existe: o `fetch` do Cloudflare Worker nao fala HTTP CONNECT nem
// SOCKS5. O Worker escolhe e rotaciona o proxy (src/admin/proxies.mjs), mas
// a conexao de verdade precisa de um processo que fale esses protocolos.
// Este arquivo e esse processo: um servidor Node puro, sem dependencias.
//
// O Worker chama:
//   POST {PROXY_GATEWAY_URL}/fetch
//   { proxy: "http://user:pass@host:porta" | "socks5://..." | null,
//     url, method, headers, body, timeout }
//
// E recebe:
//   { status, headers, body, encoding: "base64" }
// ou, em caso de falha:
//   { erro: "mensagem", status: 502 }
//
// Seguranca:
//   - o gateway escuta em 127.0.0.1 por padrao: ele e um utilitario local do
//     operador, nao um servico publico;
//   - quando PROXY_GATEWAY_TOKEN existe, toda chamada precisa do cabecalho
//     x-gateway-token com o mesmo valor.
//   - a URL alvo e validada (http/https apenas); o proxy nunca e usado para
//     Reaching enderecos internos do gateway.
//
// Uso:
//   node scripts/proxy-gateway.mjs            # porta 8788
//   PORT=9000 node scripts/proxy-gateway.mjs

import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

const PORTA = Number(process.env.PORT || process.env.PROXY_GATEWAY_PORT || 8788);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = String(process.env.PROXY_GATEWAY_TOKEN || '').trim();
const TIMEOUT_PADRAO = Number(process.env.PROXY_GATEWAY_TIMEOUT || 15000);

const log = (...partes) => console.error('[gateway]', ...partes);

function cabecalhosDe(node) {
  const saida = {};
  for (const [nome, valor] of Object.entries(node || {})) {
    if (valor === undefined || valor === null) continue;
    saida[String(nome).toLowerCase()] = Array.isArray(valor) ? valor.join(', ') : String(valor);
  }
  return saida;
}

function base64(buf) {
  return Buffer.from(buf || Buffer.alloc(0)).toString('base64');
}

function erroStatus(mensagem, status = 502) {
  return { erro: String(mensagem), status };
}

// ---------------------------------------------------------------------------
// HTTP CONNECT (proxy http/https)
// ---------------------------------------------------------------------------

function credencialBasica(url) {
  if (!url.username && !url.password) return null;
  const bruto = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  return `Basic ${Buffer.from(bruto).toString('base64')}`;
}

function abrirTunnelHttp(proxy, host, porta) {
  return new Promise((resolve, reject) => {
    const chave = credencialBasica(proxy);
    const socket = netConnect({ host: proxy.hostname, port: Number(proxy.port || 80) });
    socket.setTimeout(TIMEOUT_PADRAO, () => {
      socket.destroy();
      reject(new Error('tempo esgotado na conexao com o proxy'));
    });
    socket.once('error', (e) => reject(e));
    socket.once('connect', () => {
      const linhas = [
        `CONNECT ${host}:${porta} HTTP/1.1`,
        `Host: ${host}:${porta}`,
        'Proxy-Connection: keep-alive'
      ];
      if (chave) linhas.push(`Proxy-Authorization: ${chave}`);
      socket.write(`${linhas.join('\r\n')}\r\n\r\n`);
      let buffer = Buffer.alloc(0);
      const aoReceber = chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        const fim = buffer.indexOf('\r\n\r\n');
        if (fim < 0) return;
        socket.removeListener('data', aoReceber);
        const cabecalho = buffer.slice(0, fim).toString('latin1');
        const status = Number((cabecalho.split('\r\n')[0] || '').split(' ')[1] || 0);
        const resto = buffer.slice(fim + 4);
        if (status !== 200) {
          socket.destroy();
          reject(new Error(`proxy recusou o CONNECT (${status})`));
          return;
        }
        if (resto.length) socket.unshift(resto);
        socket.setTimeout(0);
        resolve(socket);
      };
      socket.on('data', aoReceber);
    });
  });
}

// ---------------------------------------------------------------------------
// SOCKS5
// ---------------------------------------------------------------------------

function conectarSocks5(proxy, host, porta) {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: proxy.hostname, port: Number(proxy.port || 1080) });
    socket.setTimeout(TIMEOUT_PADRAO, () => {
      socket.destroy();
      reject(new Error('tempo esgotado na conexao com o proxy socks5'));
    });
    socket.once('error', (e) => reject(e));
    socket.once('connect', () => {
      const etapas = [];
      const passo = () => {
        const atual = etapas.shift();
        if (!atual) return;
        atual()
          .then(passo)
          .catch((e) => {
            socket.destroy();
            reject(e);
          });
      };
      const ler = (n) => new Promise((ok, fail) => {
        let buffer = Buffer.alloc(0);
        const onData = chunk => {
          buffer = Buffer.concat([buffer, chunk]);
          if (buffer.length < n) return;
          socket.removeListener('data', onData);
          ok(buffer.slice(0, n));
          if (buffer.length > n) socket.unshift(buffer.slice(n));
        };
        socket.on('data', onData);
        socket.once('error', fail);
      });
      const temSenha = Boolean(proxy.username || proxy.password);
      etapas.push(async () => {
        socket.write(temSenha ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
        const resposta = await ler(2);
        if (resposta[0] !== 0x05) throw new Error('resposta socks5 invalida');
        if (resposta[1] === 0x02) {
          const usuario = Buffer.from(decodeURIComponent(proxy.username || ''), 'utf8');
          const senha = Buffer.from(decodeURIComponent(proxy.password || ''), 'utf8');
          socket.write(Buffer.concat([Buffer.from([0x01, usuario.length]), usuario, Buffer.from([senha.length]), senha]));
          const okAuth = await ler(2);
          if (okAuth[1] !== 0x00) throw new Error('credencial recusada pelo proxy socks5');
          return;
        }
        if (resposta[1] !== 0x00) throw new Error(`metodo de autenticacao socks5 nao suportado: ${resposta[1]}`);
      });
      etapas.push(async () => {
        const destino = Buffer.from(host, 'utf8');
        socket.write(Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, destino.length]),
          destino,
          Buffer.from([(porta >> 8) & 0xff, porta & 0xff])
        ]));
        const cabecalho = await ler(4);
        if (cabecalho[0] !== 0x05) throw new Error('resposta socks5 invalida');
        if (cabecalho[1] !== 0x00) throw new Error(`proxy socks5 recusou a conexao (${cabecalho[1]})`);
        const tipo = cabecalho[3];
        if (tipo === 0x01) await ler(4);
        else if (tipo === 0x03) { const n = (await ler(1))[0]; await ler(n); }
        else if (tipo === 0x04) await ler(16);
        else throw new Error('tipo de endereco socks5 desconhecido');
        await ler(2);
      });
      etapas.push(async () => {
        socket.setTimeout(0);
        resolve(socket);
      });
      passo();
    });
  });
}

// ---------------------------------------------------------------------------
// Requisicao
// ---------------------------------------------------------------------------

async function requisicaoDireta(url, opcoes) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), opcoes.timeout);
  try {
    const resposta = await fetch(url, {
      method: opcoes.method,
      headers: opcoes.headers,
      body: opcoes.body ?? undefined,
      signal: controlador.signal,
      redirect: 'follow'
    });
    const buffer = Buffer.from(await resposta.arrayBuffer());
    return {
      status: resposta.status,
      headers: Object.fromEntries(resposta.headers.entries()),
      body: base64(buffer)
    };
  } finally {
    clearTimeout(temporizador);
  }
}

function requisicaoPorSocket(socket, url, opcoes, tlsSocket = null) {
  return new Promise((resolve, reject) => {
    const metodo = opcoes.method || 'GET';
    const headers = { ...(opcoes.headers || {}) };
    if (!headers.host && !headers.Host) headers.host = url.host;
    const caminho = `${url.pathname || '/'}${url.search || ''}`;
    const modulo = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const opcoesReq = {
      method: metodo,
      path: caminho,
      headers,
      agent: false,
      createConnection: () => (tlsSocket || socket),
      servername: url.protocol === 'https:' ? url.hostname : undefined
    };
    const req = modulo(opcoesReq, resposta => {
      const partes = [];
      resposta.on('data', parte => partes.push(parte));
      resposta.on('end', () => resolve({
        status: resposta.statusCode || 0,
        headers: cabecalhosDe(resposta.headers),
        body: base64(Buffer.concat(partes))
      }));
      resposta.on('error', reject);
    });
    req.setTimeout(opcoes.timeout, () => {
      req.destroy(new Error('tempo esgotado na requisicao'));
    });
    req.on('error', reject);
    if (opcoes.body !== null && opcoes.body !== undefined && metodo !== 'GET' && metodo !== 'HEAD') {
      req.write(typeof opcoes.body === 'string' ? opcoes.body : JSON.stringify(opcoes.body));
    }
    req.end();
  });
}

// Alvo http через de proxy http: o proxy recebe a requisicao em forma
// absoluta (path com o esquema e o host do alvo).
function requisicaoAbsoluta(proxy, url, opcoes) {
  return new Promise((resolve, reject) => {
    const headers = { ...(opcoes.headers || {}) };
    if (!headers.host && !headers.Host) headers.host = url.host;
    const chave = credencialBasica(proxy);
    if (chave) headers['proxy-authorization'] = chave;
    const modulo = proxy.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = modulo({
      host: proxy.hostname,
      port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
      method: opcoes.method || 'GET',
      path: url.href,
      headers,
      agent: false,
      servername: proxy.protocol === 'https:' ? proxy.hostname : undefined
    }, resposta => {
      const partes = [];
      resposta.on('data', parte => partes.push(parte));
      resposta.on('end', () => resolve({
        status: resposta.statusCode || 0,
        headers: cabecalhosDe(resposta.headers),
        body: base64(Buffer.concat(partes))
      }));
      resposta.on('error', reject);
    });
    req.setTimeout(opcoes.timeout, () => req.destroy(new Error('tempo esgotado na requisicao')));
    req.on('error', reject);
    if (opcoes.body !== null && opcoes.body !== undefined && !['GET', 'HEAD'].includes(opcoes.method || 'GET')) {
      req.write(typeof opcoes.body === 'string' ? opcoes.body : JSON.stringify(opcoes.body));
    }
    req.end();
  });
}

async function requisicaoComProxy(url, proxy, opcoes) {
  const esquema = (proxy.protocol || 'http:').replace(':', '').toLowerCase();
  const destino = `${url.hostname}:${url.port || (url.protocol === 'https:' ? 443 : 80)}`;

  if (esquema === 'socks5' || esquema === 'socks5h' || esquema === 'socks') {
    const socket = await conectarSocks5(proxy, url.hostname, Number(url.port || (url.protocol === 'https:' ? 443 : 80)));
    if (url.protocol === 'https:') {
      const tls = tlsConnect({ socket, servername: url.hostname });
      await new Promise((ok, fail) => {
        tls.once('secureConnect', ok);
        tls.once('error', fail);
      });
      return requisicaoPorSocket(socket, url, opcoes, tls);
    }
    return requisicaoPorSocket(socket, url, opcoes);
  }

  if (esquema === 'http' || esquema === 'https') {
    if (url.protocol === 'https:') {
      const socket = await abrirTunnelHttp(proxy, url.hostname, Number(url.port || 443));
      const tls = tlsConnect({ socket, servername: url.hostname });
      await new Promise((ok, fail) => {
        tls.once('secureConnect', ok);
        tls.once('error', fail);
      });
      return requisicaoPorSocket(socket, url, opcoes, tls);
    }
    // Alvo http: o proxy recebe a requisicao em forma absoluta.
    return requisicaoAbsoluta(proxy, url, opcoes);
  }

  throw new Error(`esquema de proxy nao suportado: ${esquema}`);
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', parte => partes.push(parte));
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function responderJson(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(corpo);
}

const servidor = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      return responderJson(res, 200, { ok: true, servico: 'proxy-gateway', token: TOKEN ? 'obrigatorio' : 'livre' });
    }
    if (req.method !== 'POST' || !String(req.url).startsWith('/fetch')) {
      return responderJson(res, 404, { erro: 'rota desconhecida' });
    }
    if (TOKEN) {
      const recebido = String(req.headers['x-gateway-token'] || '');
      if (recebido !== TOKEN) return responderJson(res, 401, { erro: 'token do gateway invalido' });
    }
    let entrada;
    try {
      entrada = JSON.parse((await lerCorpo(req)) || '{}');
    } catch {
      return responderJson(res, 400, { erro: 'JSON invalido' });
    }
    let url;
    try {
      url = new URL(String(entrada.url || ''));
    } catch {
      return responderJson(res, 400, { erro: 'url alvo invalida' });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return responderJson(res, 400, { erro: 'apenas http e https sao aceitos' });
    }
    const opcoes = {
      method: String(entrada.method || 'GET').toUpperCase(),
      headers: entrada.headers && typeof entrada.headers === 'object' ? entrada.headers : {},
      body: entrada.body ?? null,
      timeout: Math.max(1000, Number(entrada.timeout) || TIMEOUT_PADRAO)
    };
    const proxyUrl = entrada.proxy ? String(entrada.proxy) : null;
    if (!proxyUrl) {
      const saida = await requisicaoDireta(url, opcoes);
      return responderJson(res, 200, { ...saida, encoding: 'base64' });
    }
    let proxy;
    try {
      proxy = new URL(proxyUrl);
    } catch {
      return responderJson(res, 400, { erro: 'url do proxy invalida' });
    }
    const saida = await requisicaoComProxy(url, proxy, opcoes);
    return responderJson(res, 200, { ...saida, encoding: 'base64' });
  } catch (e) {
    log('falha:', String(e?.message || e));
    return responderJson(res, 502, erroStatus(String(e?.message || e)));
  }
});

servidor.listen(PORTA, HOST, () => {
  log(`ouvindo em http://${HOST}:${PORTA} (token ${TOKEN ? 'obrigatorio' : 'livre'})`);
});

process.on('SIGINT', () => servidor.close(() => process.exit(0)));
process.on('SIGTERM', () => servidor.close(() => process.exit(0)));
