// Diagnostico da credencial DataJud: o status 401/security_exception pode ser
// de grafia do cabecalho, de escopo do indice ou de chave revogada.
//
// Este probe so faz requisicoes barata (size 0) e imprime status e tipo de
// erro. A credencial vem do ambiente; o valor nunca e impresso.
//
//   node verification/probe-datajud-credencial.mjs
import { Buffer } from 'node:buffer';

const bruto = process.env.DATAJUD_API_KEY_B64
  ? Buffer.from(process.env.DATAJUD_API_KEY_B64, 'base64').toString('utf8')
  : (process.env.DATAJUD_API_KEY || '');
const CHAVE = bruto.trim();
const BASE = 'https://api-publica.datajud.cnj.jus.br';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function tentar(indice, cabecalho, corpo = { size: 0, query: { match_all: {} } }) {
  const t0 = Date.now();
  const headers = { 'content-type': 'application/json' };
  if (cabecalho) headers.authorization = cabecalho;
  try {
    const r = await fetch(`${BASE}/${indice}/_search`, { method: 'POST', headers, body: JSON.stringify(corpo) });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch {}
    return { indice, cabecalho: cabecalho ? cabecalho.split(' ')[0] : '(sem autorizacao)', status: r.status, ok: r.ok, ms: Date.now() - t0, tipo: j?.error?.type || null, motivo: String(j?.error?.reason || j?.error?.type || '').slice(0, 90) };
  } catch (e) {
    return { indice, cabecalho: cabecalho ? cabecalho.split(' ')[0] : '(sem autorizacao)', status: 0, ok: false, ms: Date.now() - t0, tipo: e?.name || 'erro', motivo: String(e?.message || '').slice(0, 90) };
  }
}

if (!CHAVE) {
  console.error('sem credencial no ambiente');
  process.exit(2);
}
console.error(`[probe] chave carregada (${CHAVE.length} caracteres); o valor nao sera impresso.`);

const casos = [
  ['api_publica_stj', null],
  ['api_publica_stj', `APIKey ${CHAVE}`],
  ['api_publica_stj', `Apikey ${CHAVE}`],
  ['api_publica_stj', `apiKey ${CHAVE}`],
  ['api_publica_stj', `ApiKey ${CHAVE}`],
  ['api_publica_stj', `Bearer ${CHAVE}`],
  ['api_publica_tjsp', `APIKey ${CHAVE}`],
  ['api_publica_cnj', `APIKey ${CHAVE}`],
];

for (const [indice, cabecalho] of casos) {
  console.log(JSON.stringify(await tentar(indice, cabecalho)));
  await espera(2500);
}
