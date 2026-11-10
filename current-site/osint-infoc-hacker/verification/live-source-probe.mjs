// Sondagem real das fontes do scanner.
//
// Escopo: REDE REAL. Este script consulta os provedores externos de verdade,
// com alvos publicos e inofensivos (o proprio dominio do projeto, um IP de
// documentacao, um CNPJ de exemplo). Ele NAO faz parte de `npm test`, que
// continua 100% offline. Serve para responder "as fontes estao respondendo
// agora?" com evidencia real, e nao com fixture.
//
//   node verification/live-source-probe.mjs
//
// As fontes que exigem credencial do operador (github, emailrep, ceis,
// datajud) devolvem sem_chave/sem_token: e o comportamento declarado, e nao
// uma falha do provedor.
//
// Nao use este script em laco: ele consome cota dos provedores publicos.

process.env.WARM_SECRET = process.env.WARM_SECRET || 'segredo-de-teste-0123456789';
await import('../scripts/dev-server.mjs'); // instala o shim local de HTMLRewriter
const { REGISTRY } = await import('../src/sources/registry.mjs');
const { ctx } = await import('../src/lib/http.mjs');
const { classificarErro } = await import('../src/contract.mjs');

// Alvos publicos, escolhidos para nao investigar ninguem.
const ALVOS = {
  email: 'teste@example.com',
  dominio: 'ostnt.online',
  ip: '8.8.8.8',
  cnpj: '00000000000191',
  telefone: '11999999999',
  nome: 'São Paulo'
};

const base = ctx(
  { UA_MODE: 'identificado', UA: 'ostnt.online scanner (+https://ostnt.online)' },
  'https://local.test'
);

const consultas = [];
for (const fonte of REGISTRY) {
  for (const tipo of fonte.tipos) consultas.push({ fonte, tipo });
}

const resultados = [];
for (const { fonte, tipo } of consultas) {
  const valor = ALVOS[tipo];
  const inicio = Date.now();
  const http = [];
  const c = {
    ...base,
    get: async (url, opts) => {
      const r = await base.get(url, opts);
      try { http.push({ host: new URL(url).hostname, status: r.status }); } catch {}
      return r;
    }
  };
  let status = 'ok';
  let codigo = null;
  let erro = null;
  let resumo = null;
  try {
    const saida = await fonte.run({ tipo, valor }, c);
    const d = saida?.dados || {};
    // Resumo curto do que o provedor devolveu, para deixar claro que a
    // resposta veio de verdade e nao de um stub.
    resumo = d.existe === false ? 'sem dados para o alvo'
      : d.situacao ? `situacao=${d.situacao}`
      : d.total !== undefined ? `total=${d.total}`
      : d.paginaPublica !== undefined ? `paginaPublica=${d.paginaPublica}`
      : d.observacao ? 'observacao do provedor'
      : Object.keys(d).length ? 'dados recebidos' : 'resposta vazia';
  } catch (e) {
    status = 'erro';
    codigo = classificarErro(e).codigo;
    erro = String(e?.message || e).slice(0, 200);
  }
  resultados.push({
    id: fonte.id,
    tipo,
    alvo: valor,
    status,
    erro_codigo: codigo,
    erro,
    resumo,
    http,
    ms: Date.now() - inicio
  });
}

const comCredencial = ['github', 'emailrep', 'ceis', 'datajud'];
const respondidas = resultados.filter(r => r.status === 'ok');
const falhasReais = resultados.filter(r => r.status !== 'ok' && !comCredencial.includes(r.id));
const bloqueadasPorCredencial = resultados.filter(r => r.status !== 'ok' && comCredencial.includes(r.id));

console.log(JSON.stringify({
  escopo: 'REDE REAL; consultas publicas aos provedores externos',
  alvos: ALVOS,
  consultas: resultados.length,
  responderam: respondidas.length,
  falharam: falhasReais.length,
  bloqueadas_por_credencial: bloqueadasPorCredencial.map(r => ({ id: r.id, tipo: r.tipo, erro_codigo: r.erro_codigo })),
  detalhe: resultados
}, null, 2));
