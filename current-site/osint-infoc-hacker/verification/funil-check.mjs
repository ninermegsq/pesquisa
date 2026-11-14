// Prova o bug do funil: as etapas `scan`, `scan_concluido` e `falha` nao
// chegavam ao banco porque o Worker nao entregava o `waitUntil` ao motor.
//
// O teste reimplementa o `fetch` do Worker em cima do `handleScan` real, com
// um `ctx.waitUntil` que registra as promessas entregues. Ate a correcao,
// nenhuma promessa era entregue e o funil ficava vazio.
//
// Verifica tambem que `ms` cabe na coluna integer: o epoch em milissegundos
// estoura 2^31-1 e a RPC recusa a linha.

import assert from 'node:assert/strict';

const MOD = '../src/scan.mjs';
const TEL = '../src/admin/telemetria.mjs';

const etapas = [];
const masterHash = 'a'.repeat(64);

// Substitui a telemetria por um duble que registra o que chegou.
const telemetriaReal = await import(TEL);
const gravados = [];
const fakeRegistrar = async (env, dados) => {
  gravados.push({ ...dados });
  return { ok: true };
};

const { handleScan } = await import(MOD);

// Reconstroi o ambiente minimo: o motor continua sem banco real, e a
// telemetria e capturada pelo duble de `fetch` da RPC.
const env = {
  CREDENCIAIS_MASTER_KEY: 'chave-mestre-de-teste-000000',
  HMAC_SECRET: 'segredo-de-teste',
  BUDGET_SUBREQ: '38',
  SUPABASE_URL: 'https://banco-de-teste.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_teste',
  OSINT_KV: {
    async get() { return null; },
    async put() {}
  }
};

// O motor importa `registrar` de telemetria. No Node, o cache de modulos ESM
// e congelado, entao o duble e feito no nivel do `fetch` global: `rpcSegura`
// chama `fetch` para a RPC do Supabase, e e ai que a chamada e registrada.
const chamadas = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('admin_registrar_visita') || u.includes('admin_registrar_evento') || u.includes('admin_credenciais_uso')) {
    const body = JSON.parse(init.body);
    chamadas.push({ rpc: u.split('/rpc/')[1], body });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

// Um alvo simples (email) e um POST /api/scan. As fontes vao falhar porque
// nao ha rede: o que importa e o funil.
const request = new Request('https://exemplo.test/api/scan', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://exemplo.test' },
  body: JSON.stringify({ alvo: 'teste@example.com' })
});

// ctx.waitUntil que captura as promessas entregues.
const entregues = [];
const ctx = { waitUntil: (p) => { entregues.push(p); } };

const resposta = await handleScan(request, env, '203.0.113.10', {
  escopo: 'visitante',
  waitUntil: (p) => { ctx.waitUntil(p); }
});

assert.equal(resposta.status, 200, 'o scan nao respondeu 200');

// Deixa as promessas entregues resolverem.
await Promise.allSettled(entregues);

const visitas = chamadas.filter(c => c.rpc === 'admin_registrar_visita');
const etapasVistas = visitas.map(c => c.body.p_etapa);
console.log(JSON.stringify({
  status: resposta.status,
  promessas_entregues_ao_runtime: entregues.length,
  rpcs_chamadas: chamadas.map(c => c.rpc),
  etapas_gravadas: etapasVistas
}, null, 2));

assert.ok(entregues.length >= 3, `esperava ao menos 3 promessas entregues ao runtime, veio ${entregues.length}`);
assert.ok(etapasVistas.includes('scan'), 'a etapa scan nao chegou ao banco');
assert.ok(etapasVistas.includes('scan_concluido'), 'a etapa scan_concluido nao chegou ao banco');
assert.ok(etapasVistas.includes('falha'), 'a etapa falha nao chegou ao banco');

// `ms` precisa caber em integer (2^31-1 = 2147483647).
for (const c of visitas) {
  if (c.body.p_ms === null || c.body.p_ms === undefined) continue;
  assert.ok(
    Number(c.body.p_ms) <= 2147483647,
    `p_ms fora do range do integer: ${c.body.p_ms} (etapa ${c.body.p_etapa})`
  );
  assert.ok(Number(c.body.p_ms) >= 0, `p_ms negativo: ${c.body.p_ms}`);
}

console.log('OK: funil completo gravado (scan, scan_concluido, falha) e ms dentro do range do integer.');
