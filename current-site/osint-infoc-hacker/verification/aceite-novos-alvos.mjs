// Aceite com rede real das fontes novas (CPF, placa, nome completo).
//
// Esta e a etapa que a verificacao offline nao cobre: aqui as fontes de
// rede sao executadas de verdade, com o mesmo cliente HTTP do Worker
// (src/lib/http.mjs) e o mesmo codigo de src/sources/registry.mjs.
//
// O script NAO grava nada no projeto e nao inventa resultado: ele imprime o
// que o provedor respondeu e o que a fonte entregou.
//
//   node verification/aceite-novos-alvos.mjs
//
// A fonte de veiculo (Consultar Placa) exige credencial do operador. O
// script mede os tres caminhos possíveis:
//   1. sem credencial  -> a fonte responde sem_chave e nao chama ninguem;
//   2. credencial errada -> o provedor responde 401/403 (prova que o
//      Basic Auth realmente chega nele);
//   3. credencial do operador (CONSULTARPLACA_CREDENCIAL no ambiente) ->
//      consulta de verdade. A placa AAA0000 e a placa de teste gratuita do
//      provedor: devolve dados ficticios e nao consome credito.
//
// Saida: uma linha JSON por fonte/alvo, com o status, o erro (quando houve)
// e os dados (quando a fonte respondeu).

import { REGISTRY } from '../src/sources/registry.mjs';
import { ctx } from '../src/lib/http.mjs';

const CREDENCIAL_OPERADOR = process.env.CONSULTARPLACA_CREDENCIAL || '';

// Alvos de teste. Os CPFs e as placas sao de teste (publicados na
// documentacao dos provedores): nenhum dado real de pessoa e consultado.
const ALVOS = [
  { id: 'cpf_valida', tipo: 'cpf', valor: '11144477735', esperado: 'ok' },
  { id: 'cpf_brasilapi', tipo: 'cpf', valor: '11144477735', esperado: 'ok' },
  { id: 'cpf_brasilapi', tipo: 'cpf', valor: '11111111111', esperado: 'ok' },
  { id: 'cpf_brasilapi', tipo: 'cpf', valor: '52998224725', esperado: 'ok' },
  { id: 'placa_footprint', tipo: 'placa', valor: 'ABC1D23', esperado: 'ok' },
  { id: 'placa_consultarplaca', tipo: 'placa', valor: 'ABC1D23', credencial: 'nenhuma', esperado: 'sem_chave' },
  { id: 'placa_consultarplaca', tipo: 'placa', valor: 'ABC1D23', credencial: 'invalida', esperado: 'erro_401' },
  { id: 'placa_consultarplaca', tipo: 'placa', valor: 'AAA0000', credencial: 'operador', esperado: 'ok_ou_sem_chave' },
  { id: 'nome_perfil', tipo: 'nome', valor: 'Maria Silva', esperado: 'ok' }
];

// O ambiente muda por alvo: a fonte de veiculo so roda com a credencial.
const ambienteDe = credencial => {
  const env = { UA_MODE: 'identificado' };
  if (credencial === 'invalida') env.CONSULTARPLACA_CREDENCIAL = 'invalido@example.invalid:api_key_invalida';
  if (credencial === 'operador' && CREDENCIAL_OPERADOR) env.CONSULTARPLACA_CREDENCIAL = CREDENCIAL_OPERADOR;
  return env;
};

async function medir({ id, tipo, valor, credencial }) {
  const fonte = REGISTRY.find(s => s.id === id);
  if (!fonte) throw new Error(`fonte ausente no registro: ${id}`);
  const alvo = { tipo, valor };
  const t0 = Date.now();
  const http = [];
  const c = ctx(ambienteDe(credencial), 'https://ostnt.online');
  const contexto = {
    ...c,
    get: async (...args) => {
      const r = await c.get(...args);
      http.push({ host: new URL(args[0]).hostname, status: r.status });
      return r;
    }
  };
  try {
    const r = await fonte.run(alvo, contexto);
    return { id, alvo: valor, credencial: credencial || 'nenhuma', status: 'ok', ms: Date.now() - t0, http, dados: r.dados };
  } catch (e) {
    return {
      id,
      alvo: valor,
      credencial: credencial || 'nenhuma',
      status: 'erro',
      codigo: e?.codigo || null,
      ms: Date.now() - t0,
      http,
      erro: String(e?.message || e).slice(0, 200)
    };
  }
}

// O resultado bate com o esperado? Cada alvo tem uma expectativa declarada
// acima; a divergencia e o que interessa no aceite.
function confere(r, esperado) {
  if (esperado === 'ok') return r.status === 'ok';
  if (esperado === 'sem_chave') return r.status === 'erro' && r.codigo === 'sem_chave';
  if (esperado === 'erro_401') return r.status === 'erro' && /HTTP 40[13]|401|403/i.test(r.erro || '');
  if (esperado === 'ok_ou_sem_chave') return r.status === 'ok' || (r.status === 'erro' && r.codigo === 'sem_chave');
  return true;
}

const resultados = [];
for (const a of ALVOS) {
  const r = await medir(a);
  r.esperado = a.esperado;
  r.conforme = confere(r, a.esperado);
  resultados.push(r);
  console.log(JSON.stringify(r));
}

const divergentes = resultados.filter(r => !r.conforme);
console.log('--- RESUMO ---');
console.log(JSON.stringify({
  total: resultados.length,
  conformes: resultados.length - divergentes.length,
  divergentes: divergentes.map(e => ({ id: e.id, alvo: e.alvo, credencial: e.credencial, esperado: e.esperado, status: e.status, erro: e.erro })),
  credencialDoOperador: CREDENCIAL_OPERADOR ? 'configurada' : 'ausente (a fonte de veiculo responde sem_chave)',
  provedores: [...new Set(resultados.flatMap(r => (r.http || []).map(h => `${r.id}:${h.host}:${h.status}`)))]
}, null, 1));
