// Verificacao da fonte Telegram e do shim local de HTMLRewriter.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede: o HTML do t.me vem de um
// fixture offline, copiado da pagina real de contato por telefone.
//
// O check existe porque a fonte quebrava o scan inteiro com
// "parser.transform(...).text is not a function": o shim local devolvia uma
// Promise de transform(), enquanto o runtime do Cloudflare devolve a Response
// de imediato. Aqui ficam travados os dois lados do contrato: transform() tem
// que devolver algo com .text(), a fonte tem que extrair titulo e descricao da
// pagina real e a URL nao pode usar ?embed=1 (que devolve um widget em
// JavaScript, sem os campos da pagina de contato).

import assert from 'node:assert/strict';

// O segredo do token de operacao tem que existir antes do import do servidor
// local: o modulo le o ambiente uma unica vez, no import.
process.env.WARM_SECRET = process.env.WARM_SECRET || 'segredo-de-teste-0123456789';

// O import instala o shim de HTMLRewriter no global (mesmo caminho do preview).
await import('../scripts/dev-server.mjs');
const { REGISTRY } = await import('../src/sources/registry.mjs');
const { ctx } = await import('../src/lib/http.mjs');

// --- contrato do shim: transform() devolve algo com .text() ----------------
const rewriter = new globalThis.HTMLRewriter();
const transformed = rewriter.transform(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
assert.equal(typeof transformed?.text, 'function', 'transform() deveria devolver um objeto com .text()');
assert.equal(typeof transformed?.then, 'undefined', 'transform() nao deveria devolver uma Promise');

// --- a fonte existe no registro ---------------------------------------------
const fonte = REGISTRY.find(f => f.id === 'telegram');
assert.ok(fonte, 'fonte telegram ausente no registro');
assert.deepEqual(fonte.tipos, ['telefone']);
assert.equal(fonte.custo, 1);

// --- fixture offline da pagina de contato do t.me --------------------------
const HTML_FIXTURE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Telegram: Contact</title></head>
<body><div class="tgme_body_wrap"><div class="tgme_page">
<div class="tgme_page_icon"><i class="tgme_icon_group"></i></div>
<div class="tgme_page_title">
  Chat with <strong><nobr>+55 11 99999 9999</nobr></strong>
</div>
<div class="tgme_page_action"><a class="tgme_action_button_new shine" href="tg://resolve?phone=5511999999999">Open Chat</a></div>
<div class="tgme_page_additional">
  If you have <strong>Telegram</strong>, you can contact <br><strong>+55 11 99999 9999</strong> right away.
</div>
</div></div></body></html>`;

const realFetch = globalThis.fetch;
const chamadas = [];
globalThis.fetch = async (url) => {
  chamadas.push(String(url));
  return new Response(HTML_FIXTURE, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
};

try {
  const c = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0' }, 'https://validation.example');
  const saida = await fonte.run({ tipo: 'telefone', valor: '5511999999999' }, c);

  assert.equal(saida.dados.paginaPublica, true, 'a fonte deveria encontrar a pagina de contato no fixture');
  assert.equal(saida.dados.titulo, 'Chat with +55 11 99999 9999');
  assert.equal(saida.dados.descricao, 'If you have Telegram, you can contact +55 11 99999 9999 right away.');
  assert.equal(saida.dados.usuario, '+5511999999999');
  assert.equal(chamadas[0], 'https://t.me/+5511999999999', `URL do t.me inesperada: ${chamadas[0]}`);

  // Numero nacional (sem codigo do pais) recebe o prefixo 55, como a fonte DDD.
  const nacional = await fonte.run({ tipo: 'telefone', valor: '11999999999' }, c);
  assert.equal(chamadas[1], 'https://t.me/+5511999999999', `URL do t.me inesperada: ${chamadas[1]}`);
  assert.equal(nacional.dados.usuario, '+5511999999999');

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; fixture offline da pagina do t.me',
    fonte: 'telegram',
    titulo: saida.dados.titulo,
    descricao: saida.dados.descricao,
    url: chamadas[0],
    transformSincrono: true
  }));
} finally {
  globalThis.fetch = realFetch;
}
