// Medicao decisiva do DataJud no indice coberto pela credencial.
//
// Contexto: a fonte `datajud` consulta o indice `api_publica_stj` com
// `default_field:'partes.nome'` e devolveu HTTP 200 com total 0, enquanto a
// mesma chamada com a chave levou 26-40 s (a fonte abortava em 9 s: timeout).
// A chave tambem responde 401 em `api_publica_cnj`: a credencial e do STJ e
// so vale para o indice do STJ.
//
// Este probe mede, com a credencial real:
//   1) a estrutura do documento do indice (quais campos existem);
//   2) se `partes.nome` existe no indice do STJ;
//   3) se `movimentos.orgaoJulgador.nome` existe e devolve hits para um nome;
//   4) quanto tempo cada forma de consulta leva.
//
// A credencial vem do ambiente (DATAJUD_API_KEY ou DATAJUD_API_KEY_B64, que
// e o valor em base64 decodificado aqui). Nada e gravado em arquivo e o
// valor nunca e impresso: so o comprimento.
//
//   node verification/probe-datajud-medicao.mjs [nome]
import { Buffer } from 'node:buffer';

const bruto = process.env.DATAJUD_API_KEY_B64
  ? Buffer.from(process.env.DATAJUD_API_KEY_B64, 'base64').toString('utf8')
  : (process.env.DATAJUD_API_KEY || '');
const CHAVE = bruto.trim();
if (!CHAVE) {
  console.error('sem credencial no ambiente (DATAJUD_API_KEY ou DATAJUD_API_KEY_B64)');
  process.exit(2);
}
console.error(`[probe] chave carregada (${CHAVE.length} caracteres); o valor nao sera impresso.`);

const BASE = 'https://api-publica.datajud.cnj.jus.br';
const HEAD = { authorization: `APIKey ${CHAVE}`, 'content-type': 'application/json' };
const NOME = process.argv[2] || 'Maria Silva';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(indice, body, timeout = 75000) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${BASE}/${indice}/_search`, {
      method: 'POST', headers: HEAD, body: JSON.stringify(body), signal: ctrl.signal,
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch {}
    return { status: r.status, ok: r.ok, ms: Date.now() - t0, j, tipo: j?.error?.type || null };
  } catch (e) {
    return { status: 0, ok: false, ms: Date.now() - t0, j: null, tipo: e?.name || 'erro' };
  }
}

async function medir(caso, indice, body, tentativas = 3) {
  let r = null;
  for (let i = 0; i < tentativas; i++) {
    if (i) await espera(12000);
    r = await post(indice, body);
    if (r.ok || r.status !== 429) break;
  }
  const hits = r.j?.hits?.hits || [];
  console.log(JSON.stringify({
    caso, indice, status: r.status, ok: r.ok, ms: r.ms, tipo: r.tipo,
    total: r.j?.hits?.total?.value ?? null, relacao: r.j?.hits?.total?.relation ?? null,
    amostra: hits.slice(0, 3).map((h) => h?._source?.numeroProcesso ?? null),
  }));
  await espera(6000);
  return r;
}

const STJ = 'api_publica_stj';

// 1) estrutura do documento: um unico documento revela os campos do indice
const doc = await medir('match_all (estrutura do documento)', STJ, {
  size: 1, query: { match_all: {} },
});
const src = doc.j?.hits?.hits?.[0]?._source || null;
if (src) {
  const forma = (o, prefixo = '', saida = [], profundidade = 0) => {
    if (!o || typeof o !== 'object' || profundidade > 2) return saida;
    for (const [k, v] of Object.entries(o)) {
      const caminho = prefixo ? `${prefixo}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) forma(v, caminho, saida, profundidade + 1);
      else saida.push(caminho);
    }
    return saida;
  };
  console.log(JSON.stringify({ caso: 'campos do documento', campos: forma(src) }));
}

// 2) o campo de nome das partes existe no indice do STJ?
await medir('exists partes.nome (stj)', STJ, {
  size: 1, query: { exists: { field: 'partes.nome' } }, _source: ['numeroProcesso'],
});

// 3) o campo do orgao julgador existe e responde por nome?
await medir('exists movimentos.orgaoJulgador.nome (stj)', STJ, {
  size: 1, query: { exists: { field: 'movimentos.orgaoJulgador.nome' } }, _source: ['numeroProcesso'],
});

// 4) consulta por nome no campo do orgao julgador
await medir('match_phrase movimentos.orgaoJulgador.nome (stj)', STJ, {
  size: 5, query: { match_phrase: { 'movimentos.orgaoJulgador.nome': { query: NOME } } },
  _source: ['numeroProcesso', 'classe.nome', 'movimentos.orgaoJulgador.nome'],
});

// 5) mesma consulta, barata para o cluster compartilhado: sem contar hits,
//    com corte de execucao e filtro de data
await medir('match_phrase + track_total_hits:false + terminate_after (stj)', STJ, {
  size: 5, track_total_hits: false, terminate_after: 20000,
  query: { match_phrase: { 'movimentos.orgaoJulgador.nome': { query: NOME } } },
  _source: ['numeroProcesso', 'classe.nome'],
});
