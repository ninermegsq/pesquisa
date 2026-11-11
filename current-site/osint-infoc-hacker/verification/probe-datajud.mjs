// Sondagem FOCADA na fonte `datajud` (DataJud/CNJ).
//
//   node verification/probe-datajud.mjs [alvo] [modo]
//
// Escopo: REDE REAL. A fonte exige a credencial `DATAJUD_API_KEY`; sem ela
// ela responde `sem_chave` e o probe nao tem o que medir. O valor vem do
// ambiente do processo (nunca de um arquivo do projeto) e NAO e impresso.
//
// Modos:
//   completo  - cabecalhos aceitos + formatos de consulta + documento de
//               exemplo + tentativa de mapeamento (lento: muitas chamadas);
//   rapido    - so a consulta no formato usado pela fonte no registro;
//   documento - so um documento de exemplo (revela o formato do registro);
//   campos    - diagnostico de campos: testa onde os nomes estao indexados.
//
// Quando invocado por probe-live-credencial.mjs, o alvo e o modo chegam
// como argv[5] e argv[6].
//
// Observacao de medicao: a API publica do CNJ e compartilhada e responde
// entre 7 s e 30 s por consulta; o cluster rejeita execucoes com 429
// (es_rejected_execution_exception) quando a carga e alta. Por isso os
// prazos aqui sao largos e cada resultado traz o tempo decorrido.
//
// Alvo: nome generico e publico. Nenhum dado de pessoa e consultado.

process.env.WARM_SECRET = process.env.WARM_SECRET || 'segredo-de-teste-0123456789';
await import('../scripts/dev-server.mjs'); // instala o shim local de HTMLRewriter
const { REGISTRY } = await import('../src/sources/registry.mjs');
const { ctx } = await import('../src/lib/http.mjs');
const { classificarErro } = await import('../src/contract.mjs');

const fonte = REGISTRY.find(f => f.id === 'datajud');
if (!fonte) {
  console.error('[probe-datajud] a fonte datajud nao esta no registro');
  process.exit(1);
}

const chave = String(process.env.DATAJUD_API_KEY || '').trim();
const ALVO = process.argv[5] || 'São Paulo';
const MODO = process.argv[6] || 'completo';
const URL_BUSCA = 'https://api-publica.datajud.cnj.jus.br/api_publica_stj/_search';

const base = ctx({
  UA_MODE: 'identificado',
  UA: 'ostnt.online scanner (+https://local.test)',
  ...(chave ? { DATAJUD_API_KEY: chave } : {})
}, 'https://local.test');

const http = [];
const c = {
  ...base,
  get: async (url, opts) => {
    const r = await base.get(url, opts);
    try { http.push({ host: new URL(url).hostname, status: r.status }); } catch {}
    return r;
  }
};

const resultado = {
  fonte: 'datajud',
  alvo: ALVO,
  modo: MODO,
  credencial: chave ? `presente (${chave.length} caracteres)` : 'ausente'
};

// 1) a fonte como esta no registro
try {
  const saida = await fonte.run({ tipo: 'nome', valor: ALVO }, c);
  resultado.status = 'ok';
  resultado.dados = saida?.dados || null;
} catch (e) {
  resultado.status = 'erro';
  resultado.erro_codigo = classificarErro(e).codigo;
  resultado.erro = String(e?.message || e).slice(0, 300);
}
resultado.http = http;

const chamar = async (corpo, cabecalho, ms = 45000) => {
  const inicio = Date.now();
  try {
    const r = await fetch(URL_BUSCA, {
      method: 'POST',
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(ms),
      headers: { 'content-type': 'application/json', accept: 'application/json', ...cabecalho }
    });
    const texto = await r.text().catch(() => '');
    let total = null;
    try { total = JSON.parse(texto)?.hits?.total?.value ?? null; } catch {}
    return {
      status: r.status,
      ok: r.ok,
      ms: Date.now() - inicio,
      total,
      resposta: texto.slice(0, 400).replace(/\s+/g, ' ')
    };
  } catch (e) {
    return { status: 'erro', ms: Date.now() - inicio, erro: String(e?.message || e).slice(0, 160) };
  }
};

const CONSULTA = {
  size: 1,
  query: { query_string: { query: ALVO, default_field: 'partes.nome' } }
};
const CABECALHOS = [
  { nome: 'APIKey (grafia do projeto)', cabecalho: { authorization: `APIKey ${chave}` } },
  { nome: 'ApiKey (grafia da documentacao do CNJ)', cabecalho: { authorization: `ApiKey ${chave}` } },
  { nome: 'sem autorizacao (referencia)', cabecalho: {} }
];

const FORMATOS = [
  { nome: 'query_string em partes.nome (formato do registro)', corpo: { size: 10, query: { query_string: { query: ALVO, default_field: 'partes.nome' } } } },
  { nome: 'query_string em partes.nome, size 1', corpo: { size: 1, query: { query_string: { query: ALVO, default_field: 'partes.nome' } } } },
  { nome: 'query_string em partes.nome.keyword, size 1', corpo: { size: 1, query: { query_string: { query: `"${ALVO}"`, default_field: 'partes.nome.keyword' } } } },
  { nome: 'match_phrase em partes.nome, size 1', corpo: { size: 1, query: { match_phrase: { 'partes.nome': ALVO } } } },
  { nome: 'match em partes.nome, size 1', corpo: { size: 1, query: { match: { 'partes.nome': ALVO } } } },
  { nome: 'query_string com terminate_after', corpo: { size: 1, terminate_after: 50000, query: { query_string: { query: ALVO, default_field: 'partes.nome' } } } },
  { nome: 'multi_match em partes.nome, size 1', corpo: { size: 1, query: { multi_match: { query: ALVO, fields: ['partes.nome'] } } } }
];

// Diagnostico de campos: onde os nomes das partes estao indexados.
const CAMPOS = [
  { nome: 'match_all, size 1', corpo: { size: 1, query: { match_all: {} } } },
  { nome: 'exists em partes.nome', corpo: { size: 1, query: { exists: { field: 'partes.nome' } } } },
  { nome: 'match em classe.nome (campo de controle)', corpo: { size: 1, query: { match: { 'classe.nome': 'Apelação' } } } },
  { nome: 'match em partes.nome (sem acentos, maiusculo)', corpo: { size: 1, query: { match: { 'partes.nome': ALVO.toUpperCase() } } } },
  { nome: 'wildcard em partes.nome', corpo: { size: 1, query: { wildcard: { 'partes.nome': `${ALVO.toUpperCase()}*` } } } },
  { nome: 'prefix em partes.nome.keyword', corpo: { size: 1, query: { prefix: { 'partes.nome.keyword': ALVO.toUpperCase() } } } }
];

// 2) cabecalhos aceitos pela API
resultado.cabecalhos = [];
if (MODO === 'completo') {
  for (const v of CABECALHOS) {
    if (!chave && v.cabecalho.authorization) { resultado.cabecalhos.push({ nome: v.nome, status: 'pulado (sem credencial)' }); continue; }
    resultado.cabecalhos.push({ nome: v.nome, ...(await chamar(CONSULTA, v.cabecalho)) });
  }
}

// 3) formatos de consulta
resultado.formatos = [];
const listaFormatos = MODO === 'rapido'
  ? FORMATOS.filter(f => f.nome.startsWith('query_string em partes.nome (formato'))
  : (MODO === 'completo' ? FORMATOS : []);
if (chave && listaFormatos.length) {
  const cabecalho = { authorization: `ApiKey ${chave}` };
  for (const f of listaFormatos) {
    resultado.formatos.push({ nome: f.nome, ...(await chamar(f.corpo, cabecalho)) });
  }
}

// 4) diagnostico de campos
resultado.campos = [];
if (chave && MODO === 'campos') {
  const cabecalho = { authorization: `ApiKey ${chave}` };
  for (const f of CAMPOS) {
    resultado.campos.push({ nome: f.nome, ...(await chamar(f.corpo, cabecalho)) });
  }
}

// 5) documento de exemplo e mapeamento
resultado.diagnostico = null;
if (chave && (MODO === 'completo' || MODO === 'documento')) {
  const cabecalho = { authorization: `ApiKey ${chave}` };
  const doc = await (async () => {
    const inicio = Date.now();
    try {
      const r = await fetch(URL_BUSCA, {
        method: 'POST',
        body: JSON.stringify({ size: 1, query: { match_all: {} } }),
        signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json', accept: 'application/json', ...cabecalho }
      });
      const texto = await r.text().catch(() => '');
      let documento = null;
      try { documento = JSON.parse(texto)?.hits?.hits?.[0]?._source ?? null; } catch {}
      return { status: r.status, ms: Date.now() - inicio, documento };
    } catch (e) {
      return { status: 'erro', ms: Date.now() - inicio, erro: String(e?.message || e).slice(0, 160) };
    }
  })();
  const mapa = await (async () => {
    const inicio = Date.now();
    try {
      const r = await fetch('https://api-publica.datajud.cnj.jus.br/api_publica_stj/_mapping', {
        method: 'GET',
        signal: AbortSignal.timeout(30000),
        headers: { accept: 'application/json', ...cabecalho }
      });
      const texto = await r.text().catch(() => '');
      let propriedades = null;
      try {
        const idx = Object.values(JSON.parse(texto))[0]?.mappings?.properties ?? null;
        propriedades = idx ? Object.fromEntries(Object.entries(idx).map(([k, v]) => [k, v?.type || 'objeto'])) : null;
        if (idx?.partes?.properties) {
          propriedades.partes = Object.fromEntries(Object.entries(idx.partes.properties).map(([k, v]) => [k, v?.type || 'objeto']));
        }
      } catch {}
      return { status: r.status, ms: Date.now() - inicio, propriedades };
    } catch (e) {
      return { status: 'erro', ms: Date.now() - inicio, erro: String(e?.message || e).slice(0, 160) };
    }
  })();
  resultado.diagnostico = { documento: doc, mapeamento: mapa };
}

console.log(JSON.stringify(resultado, null, 2));
