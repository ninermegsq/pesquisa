// Check do painel admin: cripto, login, precedencia de credencial, leitura
// sem vazamento, rotacao de proxy e protecao das rotas.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede (o banco e o modo local em
// memoria), nenhum arquivo alterado, nada publicado.
//
// O que este check garante:
//   1. a cifra das credenciais faz ida e volta e falha bem quando o texto
//      cifrado e adulterado;
//   2. o login aceita o '@' inicial no usuario e na senha (o '@' e ruido de
//      digitacao, nao parte da credencial);
//   3. senha errada nao entra;
//   4. as rotas exigem sessao;
//   5. a leitura da credencial devolve mascara e impressao digital, nunca o
//      valor em claro;
//   6. a credencial do banco tem precedencia sobre a do ambiente;
//   7. a rotacao de proxy ignora proxy inativo e proxy em cooldown.

import assert from 'node:assert/strict';

import { cifrar, decifrar, hashMestre, hashIgual, mascarar, impressao } from '../src/admin/cripto.mjs';
import { nucleo, USUARIO_LOCAL } from '../src/admin/local-db.mjs';
import { tratarAdmin } from '../src/admin/rotas.mjs';
import { listarCredenciais, aplicarCredenciais, salvarCredencial, removerCredencial, invalidarCredenciais } from '../src/admin/credenciais.mjs';
import { escolherProxy } from '../src/admin/proxies.mjs';
import { fontesComProxy, invalidarFontes } from '../src/admin/fontes.mjs';
import { registrar } from '../src/admin/telemetria.mjs';

const MESTRE = 'chave-mestra-de-teste-0000000000';
// Senha de teste do check: nao e a senha do operador (que vive apenas como
// hash no banco remoto). O modo local usa a senha que vier em ADMIN_SENHA.
const SENHA_DE_TESTE = 'senha-de-teste-local';
const env = {
  ADMIN_MODO_LOCAL: '1',
  CREDENCIAIS_MASTER_KEY: MESTRE,
  ADMIN_SENHA: SENHA_DE_TESTE,
  HMAC_SECRET: 'segredo-de-teste'
};

const SECRETO = 'ghp_valor_de_teste_1234567890';
const passos = [];
const ok = (nome, detalhe = '') => passos.push({ ok: true, nome, detalhe });

// --- 1. Cifra -------------------------------------------------------------
{
  const texto = cifrar(SECRETO, MESTRE);
  assert.ok(texto.startsWith('v1.'), 'formato da cifra mudou');
  assert.equal(decifrar(texto, MESTRE), SECRETO, 'a decifragem nao devolveu o valor');
  assert.equal(decifrar(texto, 'outra-chave-de-teste-000000'), null, 'decifrou com a chave errada');
  const adulterado = texto.slice(0, -2) + (texto.endsWith('AA') ? 'BB' : 'AA');
  assert.equal(decifrar(adulterado, MESTRE), null, 'decifrou um texto cifrado adulterado');
  assert.equal(hashMestre(MESTRE).length, 64, 'hash da chave mestra com tamanho errado');
  assert.ok(hashIgual(hashMestre(MESTRE), hashMestre(MESTRE)), 'hashIgual devolveu falso para hashes iguais');
  assert.ok(!hashIgual(hashMestre(MESTRE), hashMestre('outra')), 'hashIgual devolveu true para hashes diferentes');
  assert.ok(!mascarar(SECRETO).includes(SECRETO.slice(4, 10)), 'a mascara deixou o miolo a vista');
  assert.equal(impressao(SECRETO).length, 12, 'impressao digital com tamanho errado');
  ok('cripto', 'ida e volta, adulteracao e chave errada');
}

// --- 2. Nucleo (o '@' e ruido de digitacao) --------------------------------
{
  assert.equal(nucleo('@Gui170pretty'), 'Gui170pretty');
  assert.equal(nucleo('Gui170pretty'), 'Gui170pretty');
  ok('nucleo', "'@' inicial ignorado no usuario e na senha");
}

// --- 3. Login -------------------------------------------------------------
const login = async (usuario, senha) => {
  const resposta = await tratarAdmin(
    new Request('https://painel.local/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario, senha })
    }),
    env,
    { ip: '203.0.113.10' }
  );
  return { status: resposta.status, dados: await resposta.json() };
};

let token = null;
{
  const comArroba = await login('@Gui170pretty', `@${SENHA_DE_TESTE}`);
  assert.equal(comArroba.status, 200, `login com '@' falhou: ${JSON.stringify(comArroba.dados)}`);
  assert.equal(comArroba.dados.ok, true);
  assert.equal(comArroba.dados.usuario, USUARIO_LOCAL);
  assert.ok(comArroba.dados.token, 'login nao devolveu token');
  token = comArroba.dados.token;
  ok('login', "@Gui170pretty / @<senha> entrou");

  const semArroba = await login('Gui170pretty', SENHA_DE_TESTE);
  assert.equal(semArroba.status, 200, 'login sem @ falhou');
  ok('login', 'Gui170pretty / <senha> entrou (mesma credencial)');

  const errada = await login('@Gui170pretty', '@senha-errada');
  assert.equal(errada.status, 401, 'senha errada entrou no painel');
  ok('login', 'senha errada recusada');
}

// --- 4. Rotas exigem sessao ------------------------------------------------
{
  const semToken = await tratarAdmin(new Request('https://painel.local/api/admin/painel'), env, { ip: '203.0.113.10' });
  assert.equal(semToken.status, 401, 'painel respondeu sem sessao');
  const comToken = await tratarAdmin(
    new Request('https://painel.local/api/admin/painel', { headers: { authorization: `Bearer ${token}` } }),
    env,
    { ip: '203.0.113.10' }
  );
  assert.equal(comToken.status, 200, 'painel recusou a sessao valida');
  const painel = await comToken.json();
  assert.equal(painel.ok, true);
  assert.equal(painel.ambiente.banco, 'local');
  assert.equal(painel.ambiente.master_key, true);
  assert.ok(Array.isArray(painel.fontes) && painel.fontes.length > 0, 'painel sem o catalogo de fontes');
  ok('rotas', 'painel exige sessao e devolve o catalogo');
}

// --- 5. Credencial: gravacao, leitura sem vazamento e precedencia ----------
{
  const gravou = await salvarCredencial(env, token, {
    fonte: 'github',
    envname: 'GITHUB_TOKEN',
    valor: SECRETO,
    status: 'ativa',
    limite_minuto: 83,
    limite_dia: 2000
  });
  assert.equal(gravou.ok, true, `gravacao recusada: ${JSON.stringify(gravou)}`);

  invalidarCredenciais();
  const lista = await listarCredenciais(env);
  const item = lista.credenciais.find(c => c.fonte === 'github');
  assert.ok(item, 'a credencial gravada nao apareceu na listagem');
  assert.equal(item.origem, 'banco');
  assert.equal(item.status, 'ativa');
  assert.ok(!JSON.stringify(lista).includes(SECRETO), 'a listacao vazou a credencial em claro');

  // Precedencia: o banco vence o ambiente.
  const comAmbiente = { ...env, GITHUB_TOKEN: 'token-do-ambiente' };
  const aplicado = await aplicarCredenciais(comAmbiente);
  assert.equal(aplicado.env.GITHUB_TOKEN, SECRETO, 'a credencial do ambiente venceu a do banco');
  ok('credenciais', 'gravada, lida sem vazar e com precedencia do banco');

  // A credencial do banco vale para QUALQUER ambiente: o painel e a fonte da
  // verdade e o ambiente e so o fallback. Se o banco so valesse quando a
  // variavel de ambiente ja existisse, configurar uma chave nova pelo painel
  // nao teria efeito nenhum no scan.
  const semAmbiente = await aplicarCredenciais(env);
  assert.equal(semAmbiente.env.GITHUB_TOKEN, SECRETO, 'a credencial do banco nao chegou ao ambiente sem a variavel');
  assert.equal(env.GITHUB_TOKEN, undefined, 'aplicarCredenciais alterou o ambiente original');
  ok('credenciais', 'a credencial do banco vence o ambiente e nao altera o env original');

  // Sem credencial no banco e sem variavel de ambiente, a fonte continua
  // sem_chave: nada e inventado.
  await removerCredencial(env, token, 'github');
  invalidarCredenciais();
  const semNada = await aplicarCredenciais(env);
  assert.equal(semNada.env.GITHUB_TOKEN, undefined, 'a fonte subiu sem credencial nenhuma');
  ok('credenciais', 'ausencia de credencial mantem a fonte sem_chave');

  // Credencial marcada como inativa nao e aplicada.
  await salvarCredencial(env, token, {
    fonte: 'github',
    envname: 'GITHUB_TOKEN',
    valor: SECRETO,
    status: 'inativa'
  });
  invalidarCredenciais();
  const inativa = await aplicarCredenciais(env);
  assert.equal(inativa.env.GITHUB_TOKEN, undefined, 'a credencial inativa foi aplicada');
  ok('credenciais', 'credencial inativa nao e aplicada');

  // Deixa a fonte gravada como estava no inicio do check.
  await salvarCredencial(env, token, {
    fonte: 'github',
    envname: 'GITHUB_TOKEN',
    valor: SECRETO,
    status: 'ativa',
    limite_minuto: 83,
    limite_dia: 2000
  });
  invalidarCredenciais();
}

// --- 6. Telemetria entra no funil ------------------------------------------
{
  const visita = await registrar(env, { etapa: 'visita', ip: '203.0.113.10', agente: 'check' });
  assert.equal(visita.ok, true, 'a visita nao foi registrada');
  const falha = await registrar(env, { etapa: 'falha', fonte: 'github', codigo: 'http', ok: false });
  assert.equal(falha.ok, true, 'a falha nao foi registrada');
  const invalida = await registrar(env, { etapa: 'etapa-que-nao-existe' });
  assert.equal(invalida.ok, false, 'etapa invalida foi aceita');
  ok('telemetria', 'visita e falha registradas; etapa invalida recusada');
}

// --- 7. Rotacao de proxy ---------------------------------------------------
{
  const lista = [
    { id: 'a', url: 'http://a', ativo: true, peso: 1 },
    { id: 'b', url: 'http://b', ativo: true, peso: 1 },
    { id: 'c', url: 'http://c', ativo: false, peso: 1 },
    { id: 'd', url: 'http://d', ativo: true, peso: 1, cooldown_ate: new Date(Date.now() + 60000).toISOString() }
  ];
  const escolhidos = new Set();
  for (let i = 0; i < 10; i++) {
    const p = escolherProxy(lista, { fonte: 'xon' });
    assert.ok(p, 'a rotacao devolveu nenhum proxy');
    assert.ok(p.id !== 'c', 'proxy inativo entrou na rotacao');
    assert.ok(p.id !== 'd', 'proxy em cooldown entrou na rotacao');
    escolhidos.add(p.id);
  }
  assert.equal(escolhidos.size, 2, 'a rotacao nao percorreu os dois proxies aptos');
  ok('proxies', 'rotacao ignora inativo e cooldown, e percorre os aptos');
}

// --- 8. Fontes: o painel manda e o scan obedece ----------------------------
{
  const comToken = (caminho, opcoes) => tratarAdmin(
    new Request('https://painel.local' + caminho, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(opcoes || {})
    }),
    env,
    { ip: '203.0.113.10' }
  );

  const lista = await (await comToken('/api/admin/fontes')).json();
  assert.equal(lista.ok, true, 'a leitura das fontes falhou');
  assert.ok(Array.isArray(lista.fontes) && lista.fontes.length >= 30, 'catalogo de fontes vazio');
  const alvo = lista.fontes.find(f => f.id === 'github');
  assert.ok(alvo, 'a fonte github nao esta no catalogo');
  assert.ok(alvo.padrao, 'a fonte nao trouxe o valor padrao do catalogo');
  ok('fontes', 'leitura devolve o catalogo com o valor padrao');

  // Grava um ajuste: limite por minuto e saida pelo pool de proxies.
  const gravou = await (await comToken('/api/admin/fontes', {
    method: 'POST',
    body: JSON.stringify({
      id: 'github',
      titulo: alvo.titulo,
      tipos: alvo.tipos,
      custo: alvo.custo,
      ttl: alvo.ttl,
      proveniencia: alvo.proveniencia,
      requer_env: alvo.requer_env,
      requer_tipo: alvo.requer_tipo,
      limite_minuto: 7,
      limite_dia: 99,
      limite_texto: '7 req/min no teste',
      limite_origem: alvo.limite_origem,
      usa_proxy: true,
      observacao: 'ajuste do check',
      explicacoes: alvo.explicacoes
    })
  })).json();
  assert.equal(gravou.ok, true, `gravacao da fonte recusada: ${JSON.stringify(gravou)}`);

  invalidarFontes();
  const depois = await (await comToken('/api/admin/fontes')).json();
  const ajustada = depois.fontes.find(f => f.id === 'github');
  assert.equal(ajustada.limite_minuto, 7, 'o limite por minuto nao foi gravado');
  assert.equal(ajustada.limite_dia, 99, 'o limite por dia nao foi gravado');
  assert.equal(ajustada.usa_proxy, true, 'a saida pelo pool de proxies nao foi gravada');
  assert.equal(ajustada.ajustado, true, 'a fonte nao foi marcada como ajustada');
  ok('fontes', 'limites e pool de proxies gravados pelo painel');

  // O scan obedece: e o painel que decide quem sai pelo proxy.
  const proxied = await fontesComProxy(env);
  assert.ok(proxied.has('github'), 'o scan ignorou a escolha de proxy do painel');
  ok('fontes', 'o scan usa o pool de proxies onde o painel mandou');

  // Voltar ao padrao do catalogo.
  const restaurou = await (await comToken('/api/admin/fontes', {
    method: 'POST',
    body: JSON.stringify({
      id: 'github',
      titulo: alvo.padrao.titulo,
      tipos: alvo.tipos,
      custo: alvo.padrao.custo,
      ttl: alvo.padrao.ttl,
      proveniencia: alvo.proveniencia,
      requer_env: alvo.requer_env,
      requer_tipo: alvo.requer_tipo,
      limite_minuto: alvo.padrao.limite_minuto,
      limite_dia: alvo.padrao.limite_dia,
      limite_texto: alvo.padrao.limite_texto,
      limite_origem: alvo.limite_origem,
      usa_proxy: alvo.padrao.usa_proxy,
      observacao: alvo.padrao.observacao,
      explicacoes: alvo.explicacoes
    })
  })).json();
  assert.equal(restaurou.ok, true, 'a restauracao do padrao falhou');
  invalidarFontes();
  const voltou = await (await comToken('/api/admin/fontes')).json();
  const final = voltou.fontes.find(f => f.id === 'github');
  assert.equal(final.usa_proxy, alvo.padrao.usa_proxy, 'o padrao do proxy nao voltou');
  assert.equal(final.limite_minuto, alvo.padrao.limite_minuto, 'o padrao do limite nao voltou');
  ok('fontes', 'restaurar padrao devolve os valores do catalogo');
}

console.log(JSON.stringify({
  ok: true,
  escopo: 'LOCAL ONLY; sem rede, sem arquivo alterado',
  passos
}, null, 2));
