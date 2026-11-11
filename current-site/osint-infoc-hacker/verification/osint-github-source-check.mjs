// Verificacao das fontes portadas dos repositorios OSINT mais estrelados do
// GitHub (holehe, blackbird e PhoneInfoga).
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede: os corpos das respostas vem
// de fixtures offline, copiados das chamadas ao vivo feitas com o
// User-Agent de producao.
//
// O check existe porque os sinais dessas fontes nao sao obvios e quebram
// silenciosamente se o codigo assumir o formato "comum":
//  - o Freelancer responde HTTP 409 (e nao 200) quando o e-mail ja existe;
//  - o WordPress responde HTTP 200 nos dois sentidos e o sinal esta dentro
//    do envelope (body.email_verified contra body.error);
//  - o ProtonMail responde texto puro, nao JSON;
//  - a fonte de telefone nao faz nenhuma chamada de rede (custo zero);
//  - a fonte do Numverify exige credencial: sem ela a resposta e sem_chave,
//    que e falha de configuracao e nao torna o relatorio parcial.

import assert from 'node:assert/strict';

const { REGISTRY } = await import('../src/sources/registry.mjs');
const { ctx } = await import('../src/lib/http.mjs');
const { classificarErro } = await import('../src/contract.mjs');

const EMAIL = 'qa.teste.9f3a7b@gmail.com';

// --- fixtures: o mesmo endpoint nos dois sentidos ----------------------------
// Positivo: e-mail cadastrado. Negativo: e-mail inexistente. Os corpos sao
// os reais das chamadas ao vivo, truncados no que a fonte le.
const FIXTURES = {
  positivo: {
    'www.duolingo.com': { tipo: 'json', status: 200, corpo: { users: [{ id: 1, username: 'qa', email: EMAIL, name: 'QA' }] } },
    'api.protonmail.ch': { tipo: 'texto', status: 200, corpo: 'info:1:1 pub: 4096R/0x0ABCDEF1234567890 2024-01-01 uid:security@protonmail.com' },
    'public-api.wordpress.com': { tipo: 'json', status: 200, corpo: { code: 200, headers: [{ name: 'Content-Type', value: 'application/json' }], body: { passwordless: false, email_verified: true } } },
    'api.twitter.com': { tipo: 'json', status: 200, corpo: { valid: false, msg: 'Este e-mail ja esta sendo usado.', taken: true } },
    'spclient.wg.spotify.com': { tipo: 'json', status: 200, corpo: { status: 20, errors: { email: 'That email is already registered to an account.' } } },
    'auth.services.adobe.com': { tipo: 'json', status: 200, corpo: [{ userId: 'abc123', email: EMAIL, emailVerified: true }] },
    'api.accounts.firefox.com': { tipo: 'json', status: 200, corpo: { exists: true } },
    'www.freelancer.com': { tipo: 'json', status: 409, corpo: { status: 'error', message: 'This email already exists, please choose another', error_code: 'UserExceptionCodes.EMAIL_TAKEN', error: { code: 'EMAIL_ALREADY_IN_USE', message: 'Email already in use' } } }
  },
  negativo: {
    'www.duolingo.com': { tipo: 'json', status: 200, corpo: { users: [] } },
    'api.protonmail.ch': { tipo: 'texto', status: 200, corpo: 'info:1:0 ' },
    'public-api.wordpress.com': { tipo: 'json', status: 200, corpo: { code: 404, headers: [{ name: 'Content-Type', value: 'application/json' }], body: { error: 'unknown_user', message: 'User does not exist.' } } },
    'api.twitter.com': { tipo: 'json', status: 200, corpo: { valid: true, msg: 'Disponivel!', taken: false } },
    'spclient.wg.spotify.com': { tipo: 'json', status: 200, corpo: { status: 1, country: 'BR' } },
    'auth.services.adobe.com': { tipo: 'json', status: 200, corpo: [] },
    'api.accounts.firefox.com': { tipo: 'json', status: 200, corpo: { exists: false } },
    'www.freelancer.com': { tipo: 'json', status: 200, corpo: { status: 'success', request_id: 'a1b2c3' } }
  }
};

const NUMVERIFY_OK = {
  success: true, valid: true, number: '5511999999999', local_format: '11999999999',
  international_format: '+5511999999999', country_code: 'BR', country_name: 'Brazil',
  location: 'Sao Paulo', carrier: 'Claro', line_type: 'mobile'
};

const chamadas = [];
let direcao = 'positivo';
let bloqueados = new Set();
let numverifyResposta = { status: 200, corpo: NUMVERIFY_OK };

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  chamadas.push({ url: String(url), host: u.hostname, method: opts.method || 'GET', body: opts.body ?? null });
  if (u.hostname === 'apilayer.net') {
    return new Response(JSON.stringify(numverifyResposta.corpo), {
      status: numverifyResposta.status, headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
  if (bloqueados.has(u.hostname)) return new Response('blocked by provider', { status: 403 });
  const fx = FIXTURES[direcao][u.hostname];
  if (!fx) return new Response('sem fixture para este host', { status: 404 });
  const corpo = fx.tipo === 'texto' ? fx.corpo : JSON.stringify(fx.corpo);
  return new Response(corpo, {
    status: fx.status,
    headers: { 'content-type': fx.tipo === 'texto' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8' }
  });
};

try {
  const c = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0' }, 'https://validation.example');
  const alvo = { tipo: 'email', valor: EMAIL };

  // --- email_registro: cadastro em sites publicos ---------------------------
  const registro = REGISTRY.find(f => f.id === 'email_registro');
  assert.ok(registro, 'fonte email_registro ausente no registro');
  assert.deepEqual(registro.tipos, ['email']);
  assert.equal(registro.custo, 8, 'o custo tem de bater com as oito checagens');
  assert.equal(registro.provenance, 'holehe-blackbird-cadastro');

  chamadas.length = 0;
  let saida = await registro.run(alvo, c);
  assert.equal(chamadas.length, 8, 'a fonte tem de fazer exatamente oito consultas');
  assert.equal(saida.dados.total, 8);
  assert.equal(saida.dados.checagens, 8);
  assert.equal(saida.dados.sites.length, 8);
  assert.ok(saida.dados.sites.every(s => s.estado === 'cadastrado'),
    `todos os sites deveriam responder "cadastrado": ${JSON.stringify(saida.dados.sites)}`);

  // Os enderecos das oito consultas ficam travados aqui.
  const porHost = new Map(chamadas.map(x => [x.host, x]));
  assert.ok(porHost.get('www.duolingo.com').url.startsWith('https://www.duolingo.com/2017-06-30/users?email='));
  assert.ok(porHost.get('api.protonmail.ch').url.startsWith('https://api.protonmail.ch/pks/lookup?op=index&search='));
  assert.equal(porHost.get('public-api.wordpress.com').url,
    'https://public-api.wordpress.com/rest/v1.1/users/qa.teste.9f3a7b%40gmail.com/auth-options?http_envelope=1');
  assert.ok(porHost.get('api.twitter.com').url.startsWith('https://api.twitter.com/i/users/email_available.json?email='));
  assert.ok(porHost.get('spclient.wg.spotify.com').url.startsWith('https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email='));
  assert.equal(porHost.get('auth.services.adobe.com').url, 'https://auth.services.adobe.com/signin/v2/users/accounts');
  assert.equal(porHost.get('api.accounts.firefox.com').url, 'https://api.accounts.firefox.com/v1/account/status');
  assert.equal(porHost.get('www.freelancer.com').url,
    'https://www.freelancer.com/api/users/0.1/users/check?compact=true&new_errors=true');
  assert.equal(porHost.get('www.duolingo.com').method, 'GET');
  assert.equal(porHost.get('auth.services.adobe.com').method, 'POST');
  assert.equal(porHost.get('api.accounts.firefox.com').method, 'POST');
  assert.equal(porHost.get('www.freelancer.com').method, 'POST');
  // O Freelancer manda o e-mail no corpo; a resposta positiva vem em 409.
  assert.match(porHost.get('www.freelancer.com').body, /EMAIL_TAKEN|email/);

  // Direcao negativa: o mesmo conjunto de sites responde "sem cadastro".
  direcao = 'negativo';
  saida = await registro.run(alvo, c);
  assert.equal(saida.dados.total, 0, 'nenhum site deveria encontrar cadastro');
  assert.equal(saida.dados.checagens, 8);
  assert.ok(saida.dados.sites.every(s => s.estado === 'nao_cadastrado'),
    `todos os sites deveriam responder "nao cadastrado": ${JSON.stringify(saida.dados.sites)}`);

  // Um site bloqueado nao derruba a fonte: ele vira "indisponivel".
  direcao = 'positivo';
  bloqueados = new Set(['api.twitter.com']);
  saida = await registro.run(alvo, c);
  assert.equal(saida.dados.sites.find(s => s.site === 'twitter').estado, 'indisponivel');
  assert.equal(saida.dados.checagens, 7, 'as sete checagens restantes continuam valendo');
  assert.equal(saida.dados.total, 7);

  // Sem nenhuma resposta utilizavel, a fonte falha de verdade.
  bloqueados = new Set(Object.keys(FIXTURES.positivo));
  await assert.rejects(() => registro.run(alvo, c), /nenhuma checagem de cadastro respondeu/);
  bloqueados = new Set();

  // --- phone_footprint: formatos e buscas, sem chamada de rede --------------
  const tel = REGISTRY.find(f => f.id === 'phone_footprint');
  assert.ok(tel, 'fonte phone_footprint ausente no registro');
  assert.deepEqual(tel.tipos, ['telefone']);
  assert.equal(tel.custo, 0, 'a fonte de telefone nao consome subrequests');
  assert.equal(tel.ttl, 0);
  assert.equal(tel.provenance, 'phoneinfoga-local-dorks');

  chamadas.length = 0;
  let saidaTel = await tel.run({ tipo: 'telefone', valor: '11999999999' }, c);
  assert.equal(chamadas.length, 0, 'a fonte de telefone nao pode fazer chamada de rede');
  assert.equal(saidaTel.dados.internacional, '5511999999999');
  assert.equal(saidaTel.dados.e164, '+5511999999999');
  assert.equal(saidaTel.dados.nacional, '(11) 99999-9999');
  assert.equal(saidaTel.dados.pais, 'Brasil (+55)');
  assert.equal(saidaTel.dados.links.whatsapp, 'https://wa.me/5511999999999');
  assert.equal(saidaTel.dados.links.telegram, 'https://t.me/+5511999999999');
  assert.deepEqual(Object.keys(saidaTel.dados.buscas),
    ['Redes sociais', 'SMS descartavel', 'Reputacao', 'Pessoas', 'Busca geral']);
  const social = saidaTel.dados.buscas['Redes sociais'];
  assert.equal(social.length, 5);
  assert.equal(social[0].consulta, 'site:facebook.com intext:"5511999999999"');
  assert.ok(social[0].url.startsWith('https://www.google.com/search?q='), 'a busca tem de virar link do Google');
  assert.equal(saidaTel.dados.buscas['Busca geral'].length, 4, 'duas consultas gerais em duas variacoes do numero');

  // O mesmo numero, ja com o codigo do pais, produz o mesmo resultado.
  saidaTel = await tel.run({ tipo: 'telefone', valor: '+55 11 99999-9999' }, c);
  assert.equal(saidaTel.dados.e164, '+5511999999999');
  assert.equal(saidaTel.dados.nacional, '(11) 99999-9999');
  // Numero curto demais nao e telefone: a fonte falha.
  await assert.rejects(() => tel.run({ tipo: 'telefone', valor: '12345' }, c), /curto demais/);

  // --- numverify: credencial obrigatoria ------------------------------------
  const nv = REGISTRY.find(f => f.id === 'numverify');
  assert.ok(nv, 'fonte numverify ausente no registro');
  assert.deepEqual(nv.tipos, ['telefone']);
  assert.equal(nv.custo, 1);
  assert.equal(nv.provenance, 'numverify-apilayer');

  // Sem a chave: sem_chave (configuracao), e nao uma falha que tornaria o
  // relatorio parcial.
  const cSemChave = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0' }, 'https://validation.example');
  await assert.rejects(() => nv.run({ tipo: 'telefone', valor: '11999999999' }, cSemChave), e => {
    const { codigo } = classificarErro(e);
    return codigo === 'sem_chave' && e.env === 'NUMVERIFY_API_KEY';
  });

  const cComChave = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0', NUMVERIFY_API_KEY: 'chave-de-teste' }, 'https://validation.example');
  chamadas.length = 0;
  let saidaNv = await nv.run({ tipo: 'telefone', valor: '11999999999' }, cComChave);
  assert.equal(chamadas[0].url, 'https://apilayer.net/api/validate?access_key=chave-de-teste&number=5511999999999');
  assert.equal(saidaNv.dados.valido, true);
  assert.equal(saidaNv.dados.operadora, 'Claro');
  assert.equal(saidaNv.dados.codigoPais, 'BR');
  assert.equal(saidaNv.dados.tipoLinha, 'mobile');

  // Chave invalida: o provedor responde 401 e a fonte propaga o erro.
  numverifyResposta = { status: 401, corpo: { success: false, error: { code: 101, type: 'invalid_access_key' } } };
  await assert.rejects(() => nv.run({ tipo: 'telefone', valor: '11999999999' }, cComChave), e => /HTTP 401/.test(e.message));

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; fixtures offline das respostas ao vivo',
    fontes: ['email_registro', 'phone_footprint', 'numverify'],
    email_registro: { checagens: 8, positivo: '8 cadastrado', negativo: '0 cadastrado', bloqueado: '7 checagens seguem', todosBloqueados: 'falha real' },
    phone_footprint: { chamadasDeRede: 0, e164: '+5511999999999', nacional: '(11) 99999-9999', categorias: 5 },
    numverify: { semChave: 'sem_chave', comChave: 'resposta valida', chaveInvalida: 'HTTP 401' }
  }));
} finally {
  globalThis.fetch = realFetch;
}
