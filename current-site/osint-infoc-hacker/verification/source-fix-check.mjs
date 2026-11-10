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
//   cnpj_br - a fonte de CNPJ passou a consultar o CNPJ.ws (cnpj-ws-publica)
//             como provedor primario, com o Minha Receita de reserva: o
//             endpoint publico do CNPJ.ws aceita 3 consultas por minuto/IP e
//             o fallback evita que o limite vire falha do relatorio.
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
const cnpj = REGISTRY.find(f => f.id === 'cnpj_br');
assert.ok(gitlab && npm && wayback && crtsh && cnpj, 'fonte do registro ausente');

// --- proveniencia: o manifesto e a fonte da verdade --------------------------
assert.equal(gitlab.provenance, 'gitlab-graphql-search');
assert.equal(npm.provenance, 'npm-registry');
assert.equal(wayback.provenance, 'wayback-cdx');
assert.equal(crtsh.provenance, 'subdomain-center');
assert.equal(cnpj.provenance, 'cnpj-ws-publica+minha-receita-cnpj');
assert.equal(cnpj.custo, 2, 'a fonte de CNPJ pode chegar a dois provedores');
assert.deepEqual(cnpj.requer, { tipo: 'token', env: 'CNPJWS_TOKEN', opcional: true });

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

// CNPJ.ws (endpoint publico). Formato copia da resposta real de
// GET https://publica.cnpj.ws/cnpj/00000000000191.
const CNPJ_WS_OK = {
  cnpj_raiz: '00000000',
  razao_social: 'BANCO DO BRASIL SA',
  capital_social: '120000000000.00',
  porte: { id: '05', descricao: 'Demais' },
  natureza_juridica: { id: '2038', descricao: 'Sociedade de Economia Mista' },
  atualizado_em: '2026-10-10T03:00:00.000Z',
  socios: [
    { nome: 'FULANO DE TAL', qualificacao_socio: { id: 16, descricao: 'Presidente' } },
    { nome: 'BELTRANO DE TAL', qualificacao_socio: { id: 10, descricao: 'Diretor' } }
  ],
  simples: { mei: 'Não', simples: 'Não' },
  estabelecimento: {
    cnpj: '00000000000191', tipo: 'Matriz', nome_fantasia: 'DIRECAO GERAL',
    situacao_cadastral: 'Ativa', data_inicio_atividade: '1966-04-25',
    tipo_logradouro: 'SETOR', logradouro: 'BRASILIA', numero: 'SN', bairro: 'ASA NORTE', cep: '70040900',
    ddd1: '61', telefone1: '34939002', email: 'secex@bb.com.br',
    estado: { sigla: 'DF', nome: 'Distrito Federal' },
    cidade: { nome: 'Brasília' },
    atividade_principal: { id: '6422100', classe: '64.21-00', descricao: 'Bancos múltiplos, com carteira comercial' },
    atualizado_em: '2026-10-10T03:00:00.000Z'
  }
};
// Minha Receita (provedor de reserva). Formato copia da resposta real de
// GET https://minhareceita.org/11222333000181.
const RECEITA_OK = {
  cnpj: '11222333000181',
  razao_social: 'CAIXA ESCOLAR DA ESCOLA ESTADUAL DE ENSINO FUNDAMENTAL JOSEFINA JACQUES NORONHA',
  nome_fantasia: 'CAIXA ESCOLAR DA ESCOLA ESTADUAL DE ENSINO FUNDAMENTAL J',
  descricao_situacao_cadastral: 'ATIVA',
  cnae_fiscal: 8550301, cnae_fiscal_descricao: 'Administração de caixas escolares',
  capital_social: 0, porte: 'DEMAIS', natureza_juridica: 3999,
  uf: 'RS', municipio: 'SAO SEBASTIAO DO CAI',
  descricao_tipo_de_logradouro: 'RUA', logradouro: 'GARIBALDI', numero: '070', bairro: 'VILA RICA', cep: '95760000',
  ddd_telefone_1: '51', telefone_1: '36354333', email: null,
  opcao_pelo_simples: 'Não', opcao_pelo_mei: 'Não', data_inicio_atividade: '2009-09-02',
  qsa: [{ nome_socio: 'CLAUDIA KICH DA SILVA', qualificacao_socio: 'Presidente' }]
};

const realFetch = globalThis.fetch;
const chamadas = [];
let respostas = [];
globalThis.fetch = async (url, opts) => {
  chamadas.push({ url: String(url), metodo: opts?.method || 'GET', corpo: opts?.body || null, headers: opts?.headers || null });
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

  // --- cnpj_br: CNPJ.ws como provedor primario, Minha Receita de reserva ---
  const alvoCnpj = { tipo: 'cnpj', valor: '00000000000191' };
  const baseCnpj = chamadas.length;

  respostas = [{ corpo: JSON.stringify(CNPJ_WS_OK) }];
  let saidaCnpj = await cnpj.run(alvoCnpj, c);
  assert.equal(chamadas.length - baseCnpj, 1, 'o CNPJ.ws responde primeiro');
  assert.match(chamadas.at(-1).url, /^https:\/\/publica\.cnpj\.ws\/cnpj\/00000000000191$/);
  assert.equal(saidaCnpj.dados.provedor, 'cnpj-ws');
  assert.equal(saidaCnpj.dados.razao, 'BANCO DO BRASIL SA');
  assert.equal(saidaCnpj.dados.situacao, 'Ativa');
  assert.equal(saidaCnpj.dados.cnae, 'Bancos múltiplos, com carteira comercial');
  assert.equal(saidaCnpj.dados.cnae_codigo, '64.21-00');
  assert.equal(saidaCnpj.dados.uf, 'DF');
  assert.equal(saidaCnpj.dados.municipio, 'Brasília');
  assert.equal(saidaCnpj.dados.email, 'secex@bb.com.br');
  assert.equal(saidaCnpj.dados.telefone, '6134939002');
  assert.equal(saidaCnpj.dados.simples, false, '"Não" do provedor vira false');
  assert.equal(saidaCnpj.dados.mei, false);
  assert.equal(saidaCnpj.dados.total_socios, 2);
  // O pivo de e-mail vem primeiro: e ele que alimenta as checagens de e-mail.
  assert.deepEqual(saidaCnpj.pivos[0], { tipo: 'email', valor: 'secex@bb.com.br' });
  assert.deepEqual(saidaCnpj.pivos[1], { tipo: 'telefone', valor: '6134939002' });
  assert.deepEqual(saidaCnpj.pivos[2], { tipo: 'nome', valor: 'FULANO DE TAL' });

  // Token comercial configurado: a consulta vai para comercial.cnpj.ws.
  const ctxComToken = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0', CNPJWS_TOKEN: 'token-de-teste' }, 'https://local.test');
  respostas = [{ corpo: JSON.stringify(CNPJ_WS_OK) }];
  saidaCnpj = await cnpj.run(alvoCnpj, ctxComToken);
  assert.match(chamadas.at(-1).url, /^https:\/\/comercial\.cnpj\.ws\/cnpj\/00000000000191$/);
  assert.equal(chamadas.at(-1).headers.get('x_api_token'), 'token-de-teste');
  assert.equal(saidaCnpj.dados.provedor, 'cnpj-ws');

  // Limite do endpoint publico (429): a fonte cai no Minha Receita.
  respostas = [
    { status: 429, corpo: '{"status":429,"titulo":"Muitas requisições"}' },
    { corpo: JSON.stringify(RECEITA_OK) }
  ];
  saidaCnpj = await cnpj.run({ tipo: 'cnpj', valor: '11222333000181' }, c);
  assert.equal(chamadas.length - baseCnpj, 4, 'o CNPJ.ws e o Minha Receita foram consultados');
  assert.match(chamadas.at(-1).url, /^https:\/\/minhareceita\.org\/11222333000181$/);
  assert.equal(saidaCnpj.dados.provedor, 'minha-receita');
  assert.equal(saidaCnpj.dados.razao, RECEITA_OK.razao_social);
  assert.equal(saidaCnpj.dados.situacao, 'ATIVA');
  assert.equal(saidaCnpj.dados.uf, 'RS');
  assert.equal(saidaCnpj.dados.email, null, 'sem e-mail no cadastro nao ha pivo de e-mail');
  assert.deepEqual(saidaCnpj.pivos[0], { tipo: 'telefone', valor: '5136354333' });
  assert.deepEqual(saidaCnpj.pivos[1], { tipo: 'nome', valor: 'CLAUDIA KICH DA SILVA' });

  // Os dois provedores falham: o erro do primario vem com o do reserva.
  respostas = [{ status: 429, corpo: 'limite' }, { status: 503, corpo: 'indisponivel' }];
  await assert.rejects(() => cnpj.run(alvoCnpj, c),
    e => e.status === 429 && /HTTP 429/.test(e.message) && /fallback: HTTP 503/.test(e.message));

  // Os dois dizem que o CNPJ nao existe.
  respostas = [{ status: 404, corpo: 'nao encontrado' }, { status: 404, corpo: 'nao encontrado' }];
  saidaCnpj = await cnpj.run(alvoCnpj, c);
  assert.deepEqual(saidaCnpj.dados, { existe: false });

  // A lista de socios entra inteira e volta limitada no relatorio.
  const muitos = { ...CNPJ_WS_OK, socios: Array.from({ length: 25 }, (_, i) => ({ nome: `SOCIO ${i + 1}`, qualificacao_socio: { descricao: 'Sócio' } })) };
  respostas = [{ corpo: JSON.stringify(muitos) }];
  saidaCnpj = await cnpj.run(alvoCnpj, c);
  assert.equal(saidaCnpj.dados.total_socios, 25);
  assert.equal(saidaCnpj.dados.socios.length, 20);

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; fixtures offline dos provedores',
    gitlab: { rota: 'graphql projects(search:)', encontrados: 2, erroDePermissao: 'falha real' },
    npm: { total: '2 pacotes do mantenedor (total cru do provedor ignorado)', ruido: '0' },
    wayback: { cdx: '2 URLs + parametros', fallback: 'disponibilidade, TTL 900s', semFallback: 'falha real' },
    crtsh: { subdominios: 2, servidorOcupado: 'HTTP 503 propagado' },
    cnpj: {
      primario: 'cnpj-ws (publica.cnpj.ws)',
      reserva: 'minha-receita (429 do primario nao vira falha)',
      token: 'comercial.cnpj.ws quando CNPJWS_TOKEN existe',
      ausentes: 'existe:false so quando os dois dizem que nao existe',
      limite_socios: '25 no cadastro, 20 no relatorio'
    }
  }));
} finally {
  globalThis.fetch = realFetch;
}
