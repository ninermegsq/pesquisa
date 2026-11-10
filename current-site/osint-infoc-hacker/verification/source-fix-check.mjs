// Verificacao das fontes corrigidas depois da sonda de rede real.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede: as respostas vem de fixtures
// offline copiadas do formato real dos provedores.
//
// O check existe porque a sonda de rede (verification/live-source-probe.mjs)
// encontrou tres fontes quebradas e um bug de ruido no npm:
//
//   gitlab  - a rota GET /api/v4/users?search= responde 403 sem autenticacao
//             e o GraphQL de `users` exige permissao. A fonte passou a usar a
//             busca publica de projetos pelo GraphQL.
//   npm     - a busca textual devolvia o total cru do provedor (dezenas de
//             milhares de pacotes para qualquer e-mail). A fonte passou a
//             contar so os pacotes cujo mantenedor usa este e-mail.
//   wayback - a listagem de URLs (CDX) responde 503 ou nao termina. A fonte
//             passou a cair na API de disponibilidade quando a listagem falha.
//
// As fixtures nao provam disponibilidade: provam o contrato de parsing, o
// tratamento de falha e o fallback.

import assert from 'node:assert/strict';

const { REGISTRY } = await import('../src/sources/registry.mjs');
const { ctx } = await import('../src/lib/http.mjs');
const { rodar } = await import('../src/scan.mjs');

const gitlab = REGISTRY.find(f => f.id === 'gitlab');
const npm = REGISTRY.find(f => f.id === 'npm');
const wayback = REGISTRY.find(f => f.id === 'wayback');
const crtsh = REGISTRY.find(f => f.id === 'crtsh');
assert.ok(gitlab && npm && wayback && crtsh, 'fonte do registro ausente');

// --- proveniencia: o manifesto e a fonte da verdade --------------------------
assert.equal(gitlab.provenance, 'gitlab-graphql-search');
assert.equal(npm.provenance, 'npm-registry');
assert.equal(wayback.provenance, 'wayback-cdx');
assert.equal(crtsh.provenance, 'subdomain-center');

// --- fixtures offline ---------------------------------------------------------
const GITLAB_OK = {
  data: {
    projects: {
      nodes: [
        { name: 'site-pessoal', nameWithNamespace: 'pessoa / site-pessoal', description: 'Contato: pessoa@example.com', webUrl: 'https://gitlab.com/pessoa/site-pessoal' },
        { name: 'notas', nameWithNamespace: 'pessoa / notas', description: null, webUrl: 'https://gitlab.com/pessoa/notas' }
      ]
    }
  }
};
const GITLAB_ERRO = { errors: [{ message: "The resource that you are attempting to access does not exist or you don't have permission to perform this action" }] };

const NPM_OK = {
  total: 18577,
  objects: [
    { package: { name: 'got', author: { name: 'Sindre Sorhus' }, description: 'HTTP request', maintainers: [{ username: 'sindresorhus', email: 'sindresorhus@gmail.com' }] } },
    { package: { name: 'type-fest', author: { name: 'Sindre Sorhus' }, description: 'types', maintainers: [{ username: 'sindresorhus', email: 'sindresorhus@gmail.com' }] } },
    { package: { name: 'ruido', author: { name: 'Outro' }, description: 'nao e do alvo', maintainers: [{ username: 'outro', email: 'outro@example.org' }] } }
  ]
};

const CDX_OK = [
  ['original', 'timestamp'],
  ['http://ostnt.online/contato?email=a@b.c', '20240101000000'],
  ['http://ostnt.online/painel', '20240102000000']
];
const DISPONIVEL = {
  url: 'ostnt.online',
  archived_snapshots: { closest: { status: '200', available: true, url: 'http://web.archive.org/web/20240101000000/http://ostnt.online/?ref=1' } }
};

const realFetch = globalThis.fetch;
const chamadas = [];
let respostas = [];
globalThis.fetch = async (url, opts) => {
  chamadas.push({ url: String(url), metodo: opts?.method || 'GET', corpo: opts?.body || null });
  const r = respostas.shift();
  if (!r) throw new Error(`fetch sem resposta preparada: ${url}`);
  if (r.excecao) throw r.excecao;
  return new Response(r.corpo ?? '', { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
};

const c = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0' }, 'https://local.test');
const email = { tipo: 'email', valor: 'pessoa@example.com' };

try {
  // --- gitlab: GraphQL de projetos -----------------------------------------
  respostas = [{ corpo: JSON.stringify(GITLAB_OK) }];
  let saida = await gitlab.run(email, c);
  assert.equal(chamadas.at(-1).url, 'https://gitlab.com/api/graphql', 'o GitLab deve ser consultado pelo GraphQL');
  assert.equal(chamadas.at(-1).metodo, 'POST');
  const consulta = JSON.parse(chamadas.at(-1).corpo).query;
  assert.match(consulta, /projects\(search: "pessoa@example\.com"/, 'a consulta deve levar o e-mail alvo');
  assert.equal(saida.dados.total, 2);
  assert.equal(saida.dados.projetos[0].nome, 'site-pessoal');
  assert.equal(saida.dados.projetos[0].caminho, 'pessoa / site-pessoal');
  assert.equal(saida.dados.projetos[0].url, 'https://gitlab.com/pessoa/site-pessoal');
  assert.match(saida.dados.observacao, /nao expoe busca publica de usuarios/);

  // Erro do GraphQL (permissao negada) e falha real.
  respostas = [{ corpo: JSON.stringify(GITLAB_ERRO) }];
  await assert.rejects(() => gitlab.run(email, c), /GitLab recusou a consulta/);
  respostas = [{ status: 500, corpo: '{"message":"500 Internal Server Error"}' }];
  await assert.rejects(() => gitlab.run(email, c), e => /HTTP 500/.test(e.message));

  // --- npm: so os pacotes do mantenedor com este e-mail --------------------
  respostas = [{ corpo: JSON.stringify(NPM_OK) }];
  saida = await npm.run({ tipo: 'email', valor: 'sindresorhus@gmail.com' }, c);
  assert.match(chamadas.at(-1).url, /registry\.npmjs\.org\/-\/v1\/search\?text=sindresorhus%40gmail\.com&size=50/);
  assert.equal(saida.dados.total, 2, 'apenas os pacotes mantidos pelo e-mail alvo contam');
  assert.deepEqual(saida.dados.pacotes.map(p => p.nome), ['got', 'type-fest']);
  assert.match(saida.dados.observacao, /mantenedor/);

  // E-mail sem pacotes: o total cru do provedor e ignorado.
  respostas = [{ corpo: JSON.stringify({ total: 34489, objects: NPM_OK.objects }) }];
  saida = await npm.run({ tipo: 'email', valor: 'ninguem@example.com' }, c);
  assert.equal(saida.dados.total, 0, 'o total cru da busca textual nao pode virar o resultado');

  // --- wayback: listagem CDX ----------------------------------------------
  respostas = [{ corpo: JSON.stringify(CDX_OK) }];
  saida = await wayback.run({ tipo: 'dominio', valor: 'ostnt.online' }, c);
  assert.match(chamadas.at(-1).url, /web\.archive\.org\/cdx\/search\/cdx\?url=ostnt\.online/);
  assert.equal(saida.dados.total, 2);
  assert.deepEqual(saida.dados.parametros, ['email']);
  assert.equal(saida.dados.origem, 'cdx');

  // Dominio sem capturas: resposta vazia do CDX, zero URLs.
  respostas = [{ corpo: '[]' }];
  saida = await wayback.run({ tipo: 'dominio', valor: 'ostnt.online' }, c);
  assert.equal(saida.dados.total, 0);
  assert.equal(saida.dados.origem, 'cdx');

  // --- wayback: CDX indisponivel cai na API de disponibilidade -------------
  respostas = [{ status: 503, corpo: 'Internet Archive: Temporarily Offline' }, { corpo: JSON.stringify(DISPONIVEL) }];
  saida = await wayback.run({ tipo: 'dominio', valor: 'ostnt.online' }, c);
  assert.match(chamadas.at(-1).url, /archive\.org\/wayback\/available\?url=ostnt\.online/);
  assert.equal(saida.dados.origem, 'disponibilidade');
  assert.equal(saida.dados.total, 1);
  assert.deepEqual(saida.dados.parametros, ['ref']);
  assert.match(saida.dados.observacao, /listagem de URLs do Internet Archive falhou/);
  assert.equal(saida.ttl, 900, 'o resultado do fallback deve ter TTL proprio menor');

  // Timeout do CDX tambem cai no fallback (o abort vira excecao).
  respostas = [{ excecao: Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }) }, { corpo: JSON.stringify(DISPONIVEL) }];
  saida = await wayback.run({ tipo: 'dominio', valor: 'ostnt.online' }, c);
  assert.equal(saida.dados.origem, 'disponibilidade');

  // Sem fallback tambem indisponivel: falha real.
  respostas = [{ status: 503, corpo: 'offline' }, { status: 500, corpo: 'erro' }];
  await assert.rejects(() => wayback.run({ tipo: 'dominio', valor: 'ostnt.online' }, c), e => /HTTP 500/.test(e.message));

  // --- crtsh: parsing dos subdominios e 503 do provedor --------------------
  respostas = [{ corpo: JSON.stringify(['www.ostnt.online', 'api.ostnt.online', 'www.ostnt.online.', 'outro.exemplo.com', 'ruim..ostnt.online']) }];
  saida = await crtsh.run({ tipo: 'dominio', valor: 'ostnt.online' }, c);
  assert.match(chamadas.at(-1).url, /api\.subdomain\.center\/\?domain=ostnt\.online/);
  assert.deepEqual(saida.dados.subdominios, ['www.ostnt.online', 'api.ostnt.online']);
  assert.equal(saida.dados.total, 2);

  respostas = [{ status: 503, corpo: '{"error": "server busy (64 queries in flight)"}' }];
  await assert.rejects(() => crtsh.run({ tipo: 'dominio', valor: 'ostnt.online' }, c),
    e => /HTTP 503/.test(e.message) && /server busy/.test(e.message));

  // --- TTL do cache usa o ttl devolvido pela fonte -------------------------
  const entries = new Map();
  globalThis.caches = { default: { async match(k) { return entries.get(k.url)?.clone(); }, async put(k, r) { entries.set(k.url, r.clone()); } } };
  const cacheCtx = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0' }, 'https://local.test');
  respostas = [{ status: 503, corpo: 'offline' }, { corpo: JSON.stringify(DISPONIVEL) }];
  await rodar(wayback, { tipo: 'dominio', valor: 'ostnt.online' }, cacheCtx);
  const chave = 'https://local.test/__cache/wayback/ostnt.online';
  assert.equal(entries.get(chave)?.headers.get('cache-control'), 'public, max-age=900',
    'o resultado do fallback do wayback deveria durar 900s');
  entries.clear();
  respostas = [{ corpo: JSON.stringify(CDX_OK) }];
  await rodar(wayback, { tipo: 'dominio', valor: 'ostnt.online' }, cacheCtx);
  assert.equal(entries.get(chave)?.headers.get('cache-control'), 'public, max-age=43200',
    'a listagem completa do wayback deveria durar o TTL da fonte (43200s)');

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; fixtures offline dos provedores',
    gitlab: { rota: 'graphql projects(search:)', encontrados: 2, erroDePermissao: 'falha real' },
    npm: { total: '2 pacotes do mantenedor (total cru do provedor ignorado)', ruido: '0' },
    wayback: { cdx: '2 URLs + parametros', fallback: 'disponibilidade, TTL 900s', semFallback: 'falha real' },
    crtsh: { subdominios: 2, servidorOcupado: 'HTTP 503 propagado' }
  }));
} finally {
  globalThis.fetch = realFetch;
}
