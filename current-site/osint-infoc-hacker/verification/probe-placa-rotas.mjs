// Sonda das rotas REAIS de placa descobertas no codigo de repositorios
// publicos (ver probe-placa-github.mjs). Mede o que cada rota responde
// hoje: a API do FIPE esta fora (404 em todas as rotas) e o host
// apicarros.com virou dominio estacionado, entao as rotas testadas aqui
// sao as de terceiros/SINESP.
//
//   node verification/probe-placa-rotas.mjs
//
// Nao grava nada no projeto: e medicao.

import { createHmac, createHash } from 'node:crypto';
import { resolve } from 'node:dns/promises';

const UA = 'ostnt.online scanner (+https://ostnt.online)';
const PLACA = 'AAA0000'; // placa de teste documentada pelos proprios provedores
const SECRET = '#8.1.0#g8LzUadkEHs7mbRqbX5l'; // constante publica do app SINESP

// Token do app (HMAC-SHA1 com a placa como chave e como mensagem).
const tokenHmac = p => createHmac('sha1', p + SECRET).update(p).digest('hex');
// Token do app 3.0.2.1 (SHA1 simples de placa+data+segredo).
const tokenSha1 = (p, data) => createHash('sha1').update(p + data + SECRET).digest('hex');

const envelope = (placa, lat, lon, data) => `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
<v:Envelope xmlns:v="http://schemas.xmlsoap.org/soap/envelope/">
<v:Header>
<b>Samsung GT-I9192</b>
<c>ANDROID</c>
<d>8.1.0</d>
<i>${lat}</i>
<e>4.1.5</e>
<f>10.0.0.1</f>
<g>${tokenHmac(placa)}</g>
<k></k>
<h>${lon}</h>
<l>${data}</l>
<m>8797e74f0d6eb7b1ff3dc114d4aa12d3</m>
</v:Header>
<v:Body>
<n0:getStatus xmlns:n0="http://soap.ws.placa.service.sinesp.serpro.gov.br/">
<a>${placa}</a>
</n0:getStatus>
</v:Body>
</v:Envelope>`;

async function medir(nome, url, opcoes = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: opcoes.method || 'GET',
      body: opcoes.body ?? null,
      headers: { 'user-agent': opcoes.ua || UA, ...(opcoes.headers || {}) },
      signal: AbortSignal.timeout(opcoes.timeout || 20000),
      redirect: 'follow'
    });
    const corpo = await r.text();
    console.log(JSON.stringify({
      nome,
      status: r.status,
      ms: Date.now() - t0,
      cookies: r.headers.getSetCookie ? r.headers.getSetCookie().map(c => c.split(';')[0]) : null,
      corpo: corpo.slice(0, 600).replace(/\s+/g, ' ')
    }));
    return { r, corpo };
  } catch (e) {
    console.log(JSON.stringify({ nome, status: 0, ms: Date.now() - t0, erro: String(e?.message || e).slice(0, 160) }));
    return { r: null, corpo: '' };
  }
}

async function main() {
  console.log('--- 0. DNS dos hosts ---');
  for (const host of [
    'cidadao.sinesp.gov.br', 'sinespcidadao.sinesp.gov.br', 'apicarros.com',
    'soap.ws.placa.service.sinesp.serpro.gov.br', 'api.consultarplaca.com.br',
    'www.tabelafipebrasil.com', 'veiculos.fipe.org.br'
  ]) {
    let dns;
    try { dns = (await resolve(host)).slice(0, 2).join(','); } catch (e) { dns = `SEM DNS (${String(e?.code || e?.message || e).slice(0, 60)})`; }
    console.log(JSON.stringify({ host, dns }));
  }
  console.log('--- 1. cookie de captcha (JSESSIONID) ---');
  const cap = await medir('captchaMobile.png', 'https://sinespcidadao.sinesp.gov.br/sinesp-cidadao/captchaMobile.png', {
    headers: { accept: 'image/png,*/*' }
  });
  const jsession = (cap.r?.headers?.getSetCookie?.() || [])
    .map(c => c.split(';')[0]).find(c => c.startsWith('JSESSIONID=')) || '';

  console.log('--- 2. SINESP v4 (SOAP do app, com cookie) ---');
  const data1 = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await medir('sinesp-v4-com-cookie', 'https://cidadao.sinesp.gov.br/sinesp-cidadao/mobile/consultar-placa/v4', {
    method: 'POST',
    body: envelope(PLACA, '-23.5505199', '-46.6333094', data1),
    headers: {
      accept: 'text/plain, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      ...(jsession ? { cookie: jsession } : {})
    }
  });

  console.log('--- 3. SINESP v4 (SOAP do app, sem cookie) ---');
  await medir('sinesp-v4-sem-cookie', 'https://cidadao.sinesp.gov.br/sinesp-cidadao/mobile/consultar-placa/v4', {
    method: 'POST',
    body: envelope(PLACA, '-23.5505199', '-46.6333094', data1),
    headers: {
      accept: 'text/plain, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
    }
  });

  console.log('--- 4. SINESP mobile (form do app 3.0.2.1) ---');
  const data2 = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const form = new URLSearchParams({
    placa: PLACA,
    token: tokenSha1(PLACA, data2),
    data: data2,
    latitude: '0',
    longitude: '0',
    ip: '200.160.2.3'
  }).toString();
  await medir('sinesp-mobile-form', 'https://cidadao.sinesp.gov.br/sinesp-cidadao/mobile/consultar-placa', {
    method: 'POST',
    body: form,
    ua: 'SinespCidadao / 3.0.2.1 (guroo.com.br)',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }
  });

  console.log('--- 5. TABE FIPE (HTML) ---');
  await medir('tabelafipebrasil', `https://www.tabelafipebrasil.com/placa/${PLACA}`, {
    headers: { accept: 'text/html,*/*' }
  });

  console.log('--- 6. consultarplaca v2 (exige Basic Auth) ---');
  await medir('consultarplaca-v2', `https://api.consultarplaca.com.br/v2/consultarPlaca?placa=${PLACA}`, {
    headers: { accept: 'application/json' }
  });

  console.log('--- 7. SOAP publico do SERPRO (sem credencial) ---');
  await medir('serpro-soap-wsdl', 'http://soap.ws.placa.service.sinesp.serpro.gov.br/', {
    headers: { accept: 'text/xml,*/*' },
    timeout: 15000
  });

  console.log('--- 8. documentacao dos provedores vivos ---');
  const fipe = await medir('fipe-raiz', 'https://veiculos.fipe.org.br/', {
    headers: { accept: 'text/html,*/*' }
  });
  const ocorrencias = [...new Set((fipe.corpo.match(/[^"'<> ]{0,40}placa[^"'<> ]{0,60}/gi) || [])
    .map(s => s.replace(/\s+/g, ' ')))].slice(0, 12);
  console.log(JSON.stringify({ nome: 'fipe-ocorrencias-de-placa', ocorrencias }));

  await medir('consultarplaca-sitemap', 'https://docs.consultarplaca.com.br/sitemap.xml', {
    headers: { accept: 'text/xml,*/*' }
  });
  await medir('consultarplaca-doc-md', 'https://docs.consultarplaca.com.br/preco.md', {
    headers: { accept: 'text/markdown,text/plain,*/*' }
  });
  await medir('sinesp-api-npm', 'https://registry.npmjs.org/sinesp-api/latest', {
    headers: { accept: 'application/json' }
  });
  await medir('sinesp-api-codigo', 'https://raw.githubusercontent.com/Sorackb/sinesp-api/master/src/index.ts', {
    headers: { accept: 'text/plain,*/*' }
  });

  console.log('--- 9. documentacao do Consultar Placa (llms.txt) ---');
  await medir('consultarplaca-llms', 'https://docs.consultarplaca.com.br/llms.txt', {
    headers: { accept: 'text/plain,*/*' }
  });
  await medir('consultarplaca-sitemap-pages', 'https://docs.consultarplaca.com.br/sitemap-pages.xml', {
    headers: { accept: 'text/xml,*/*' }
  });

  console.log('--- 10. pacote npm sinesp-api (rota atual) ---');
  try {
    const r = await fetch('https://registry.npmjs.org/sinesp-api/-/sinesp-api-3.0.0.tgz', {
      headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000)
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const solto = (await import('node:zlib')).gunzipSync(buf).toString('latin1');
    const urls = [...new Set(solto.match(/https?:\/\/[^\s"'`)<>|]{6,140}/g) || [])];
    console.log(JSON.stringify({ nome: 'sinesp-api-3.0.0', urls }));
    const i = solto.search(/getStatus|consultar-pl|cidadao\.sinesp/i);
    if (i >= 0) console.log(solto.slice(Math.max(0, i - 1200), i + 1200).replace(/[^\x20-\x7e\n]/g, '.'));
  } catch (e) {
    console.log(JSON.stringify({ nome: 'sinesp-api-3.0.0', status: 0, erro: String(e?.message || e).slice(0, 140) }));
  }
}

await main();
