// Check da aba FALHAS do painel: a caixa "Explicacao dos codigos" tem que
// mostrar o texto da fonte que DE FALHOU, e nao o texto de uma fonte fixa
// do catalogo.
//
// Por que este check existe:
//   O texto de um codigo de erro nao e unico no catalogo. `http` tem 20
//   textos diferentes entre as 32 fontes (o texto do GitHub fala de token
//   sem escopo, o do Xon fala de cota por IP, o do CNJ fala de
//   security_exception). A versao anterior de renderFalhas pegava o texto
//   da PRIMEIRA fonte do catalogo (gravatar) e mostrava aquele texto para
//   qualquer falha da lista: o operador lia a documentacao do gravatar
//   enquanto olhava uma falha do CNJ.
//
//   Este check roda o admin.js de verdade contra um stub de DOM e de rede
//   e le o HTML que o painel escreve em #codigos. Nao e um teste de
//   string: e o mesmo caminho de codigo que o navegador executa.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede (o fetch e substituido por
// um stub), nada alterado no projeto, nada publicado.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminJs = readFileSync(path.join(SITE, 'public', 'admin.js'), 'utf8');
const { CATALOGO } = await import(pathToFileURL(path.join(SITE, 'src', 'admin', 'catalogo.meta.mjs')).href);

// --- Harness: DOM minimo + fetch stub ------------------------------------
// O admin.js e um IIFE que so escreve em document.getElementById(...). O
// stub guarda o innerHTML de cada id para o check poder ler o que o painel
// pintou.
async function rodarPainel(falhas, fontes = CATALOGO) {
  const el = () => ({
    innerHTML: '', textContent: '', value: '', className: '',
    addEventListener() {}, scrollIntoView() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  });
  const nodes = {};
  const listeners = {};
  globalThis.document = {
    getElementById: id => (nodes[id] ||= el()),
    querySelectorAll: () => [],
    querySelector: () => el(),
    addEventListener: (evento, fn) => { (listeners[evento] ||= []).push(fn); }
  };
  globalThis.sessionStorage = { getItem: () => 'token-de-teste', setItem() {}, removeItem() {} };
  globalThis.window = { confirm: () => true };

  const painel = {
    usuario: { usuario: 'operador' },
    ambiente: { banco: 'local', master_key: true },
    dias: 30, visitas: {}, serie: [], eventos: [], falhas
  };
  const responder = dados => Promise.resolve({
    ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(dados))
  });
  globalThis.fetch = caminho => {
    if (caminho.startsWith('/api/admin/painel')) return responder(painel);
    if (caminho.startsWith('/api/admin/fontes')) return responder({ ok: true, fontes });
    if (caminho.startsWith('/api/admin/credenciais')) return responder({ ok: true, credenciais: [] });
    if (caminho.startsWith('/api/admin/proxies')) return responder({ ok: true, proxies: [] });
    return responder({ ok: true });
  };

  new Function(adminJs)();
  for (const fn of (listeners.DOMContentLoaded || [])) fn();
  await new Promise(resolve => setTimeout(resolve, 150));
  return {
    codigos: (nodes['codigos'] || {}).innerHTML || '',
    falhas: (nodes['lista-falhas'] || {}).innerHTML || ''
  };
}

const passos = [];
const ok = (nome, detalhe = '') => passos.push({ ok: true, nome, detalhe });

// --- 1. O texto exibido e o da fonte que falhou ----------------------------
{
  const falhas = [
    { fonte: 'datajud', codigo: 'http', n: 3, ultimo_em: '2026-11-12T10:00:00Z' },
    { fonte: 'xon', codigo: 'http', n: 1, ultimo_em: '2026-11-12T10:00:00Z' },
    { fonte: 'numverify', codigo: 'rota', n: 1, ultimo_em: '2026-11-12T10:00:00Z' },
    { fonte: 'github', codigo: 'sem_chave', n: 5, ultimo_em: '2026-11-12T10:00:00Z' }
  ];
  const r = await rodarPainel(falhas);

  // O texto do CNJ tem que estar la: e a fonte que falhou com `http`.
  assert.ok(
    r.codigos.includes('security_exception'),
    'a explicacao de `http` nao trouxe o texto da fonte que falhou (datajud)'
  );
  // E o texto do Xon tambem: o mesmo codigo, outra fonte, outro texto.
  assert.ok(
    r.codigos.includes('cota por IP (100/dia)'),
    'a explicacao de `http` nao trouxe o texto da segunda fonte que falhou (xon)'
  );
  // O texto da PRIMEIRA fonte do catalogo nao pode sobreviver sozinho.
  const gravatar = CATALOGO[0];
  assert.equal(gravatar.id, 'gravatar', 'a primeira fonte do catalogo mudou; o check precisa ser revisto');
  assert.ok(
    !r.codigos.includes(gravatar.explicacoes.http),
    'a explicacao de `http` ainda mostra o texto da primeira fonte do catalogo (gravatar)'
  );
  // O codigo `rota` so existe na fonte numverify: e a prova de que a caixa
  // nao vem de uma fonte fixa.
  assert.ok(r.codigos.includes('NUMVERIFY_API_ROTA'), 'a explicacao de `rota` (so do numverify) sumiu');
  ok('codigos-falhas', 'a caixa usa o texto da fonte que falhou, nao da primeira fonte');
}

// --- 2. A tabela e a caixa concordam ---------------------------------------
{
  const falhas = [{ fonte: 'github', codigo: 'sem_chave', n: 5, ultimo_em: '2026-11-12T10:00:00Z' }];
  const r = await rodarPainel(falhas);
  const esperado = CATALOGO.find(f => f.id === 'github').explicacoes.sem_chave;
  assert.ok(r.codigos.includes(esperado), 'a caixa e a tabela discordam sobre `sem_chave` do github');
  assert.ok(r.falhas.includes(esperado), 'a tabela nao mostra o texto proprio da fonte');
  ok('codigos-falhas', 'tabela e caixa de explicacoes mostram o mesmo texto');
}

// --- 3. Sem falha no periodo, o glossario continua completo ---------------
{
  const r = await rodarPainel([]);
  // A caixa e documentada como "o significado de cada codigo de erro do
  // motor": sem falha no periodo ela ainda tem de listar a taxonomia.
  for (const codigo of ['sem_chave', 'sem_token', 'erro_rede', 'timeout', 'http', 'formato', 'erro']) {
    assert.ok(r.codigos.includes(codigo), `o glossario perdeu o codigo ${codigo}`);
  }
  assert.ok(
    !r.codigos.includes('catalogo indisponivel'),
    'sem falhas no periodo a caixa Genevenneu em vez de mostrar a taxonomia'
  );
  ok('codigos-falhas', 'sem falhas no periodo o glossario continua completo');
}

// --- 4. Fonte fora do catalogo nao quebra a caixa -------------------------
{
  const r = await rodarPainel([
    { fonte: 'fonte_que_nao_existe', codigo: 'codigo_inexistente', n: 1, ultimo_em: '2026-11-12T10:00:00Z' }
  ]);
  assert.ok(r.codigos.includes('erro_rede'), 'a caixa quebrou com fonte fora do catalogo');
  assert.ok(r.codigos.includes('codigo_inexistente') || !r.codigos.includes('undefined'),
    'a caixa imprimiu undefined com fonte fora do catalogo');
  ok('codigos-falhas', 'fonte fora do catalogo nao derruba a caixa');
}

console.log(JSON.stringify({ escopo: 'codigos-falhas', passos }, null, 2));
