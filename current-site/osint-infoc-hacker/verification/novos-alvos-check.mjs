// Verificacao dos alvos novos: CPF, placa de veiculo e nome completo.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede real: as respostas dos
// provedores vem de fixtures servidas por um stub de fetch. O que este
// check prova:
//
//   - a deteccao do alvo (CPF com DV valido, placa Mercosul e placa
//     anterior, nome completo, e o alvo que nao existe);
//   - as fontes locais, que nao chamam ninguem (validacao do CPF, formato
//     da placa e as buscas publicas);
//   - o contrato de parsing das fontes de rede: 200 com o formato
//     esperado, 404 (ausencia na base) e formato inesperado (erro, sem
//     dado chumbado);
//   - o scan completo de um alvo CPF, que antes voltava 400.
//
// O que este check NAO prova: a disponibilidade real dos provedores. As
// fontes de rede (cpf_brasilapi, placa_sinesp, nome_perfil) ainda nao
// passaram pela aceitacao com internet real, porque a maquina ficou sem
// rede no dia da implementacao. A aceitacao pendente e feita por
// `npm run probe:novas` e `npm run probe:live`.

import assert from 'node:assert/strict';
import { cpfOk, detectar, normalizarPlaca } from '../src/lib/alvo.mjs';
import { REGISTRY } from '../src/sources/registry.mjs';
import { ctx } from '../src/lib/http.mjs';
import { handleScan } from '../src/scan.mjs';

const fonte = id => {
  const achada = REGISTRY.find(f => f.id === id);
  assert.ok(achada, `fonte ausente no registro: ${id}`);
  return achada;
};

// ---------------------------------------------------------------------------
// Deteccao do alvo
// ---------------------------------------------------------------------------
assert.deepEqual(detectar('111.444.777-35'), { tipo: 'cpf', valor: '11144477735' });
assert.deepEqual(detectar('11144477735'), { tipo: 'cpf', valor: '11144477735' });
assert.equal(cpfOk('11144477735'), true);
assert.equal(cpfOk('11144477736'), false);
assert.equal(cpfOk('11111111111'), false);

assert.deepEqual(detectar('ABC1D23'), { tipo: 'placa', valor: 'ABC1D23' });
assert.deepEqual(detectar('abc-1d23'), { tipo: 'placa', valor: 'ABC1D23' });
assert.deepEqual(detectar('ABC1234'), { tipo: 'placa', valor: 'ABC1234' });
assert.deepEqual(normalizarPlaca('ABC1D23'), { valor: 'ABC1D23', modelo: 'mercosul' });
assert.deepEqual(normalizarPlaca('ABC1234'), { valor: 'ABC1234', modelo: 'antiga' });
assert.equal(normalizarPlaca('ABC1D2'), null);
assert.equal(normalizarPlaca('A1BCD23'), null);

assert.deepEqual(detectar('Maria Silva'), { tipo: 'nome', valor: 'Maria Silva' });
assert.throws(() => detectar('!!!'), /não reconhecido/);
assert.throws(() => detectar('ABC1D2'), /não reconhecido/);

// O alvo do telefone nao pode ser confundido com placa: 11 digitos comeca
// com letra (placa) nunca vira telefone, e 11 digitos sempre vira telefone.
assert.deepEqual(detectar('11987654321'), { tipo: 'telefone', valor: '11987654321' });

// ---------------------------------------------------------------------------
// Stub de rede: as respostas sao escolhidas pela URL, nao por fila, para que
// a ordem das fontes concorrentes nao mude o resultado do teste.
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
const chamadas = [];
let rota = url => { throw new Error(`fetch sem resposta preparada: ${url}`); };
globalThis.fetch = async (url, opts) => {
  chamadas.push({ url: String(url), metodo: opts?.method || 'GET', corpo: opts?.body || null });
  const r = rota(String(url), opts);
  if (r.excecao) throw r.excecao;
  return new Response(r.corpo ?? '', {
    status: r.status ?? 200,
    headers: { 'content-type': r.tipo || 'application/json' }
  });
};
const contexto = ctx({ UA_MODE: 'identificado', UA: 'fixture-check/1.0' }, 'https://local.test');

try {
  // -------------------------------------------------------------------------
  // Fontes locais: nao chamam nenhum provedor.
  // -------------------------------------------------------------------------
  const cpfValida = fonte('cpf_valida');
  const cpfLocal = await cpfValida.run({ tipo: 'cpf', valor: '111.444.777-35' }, contexto);
  assert.equal(cpfLocal.dados.cpf, '111.444.777-35');
  assert.equal(cpfLocal.dados.valido, true);
  assert.equal(cpfLocal.dados.cpf_de_teste, true);
  assert.equal(cpfLocal.dados.digitos_verificadores, '35');
  assert.equal(cpfLocal.dados.links.brasilapi, 'https://brasilapi.com.br/api/cpf/v1/11144477735');
  assert.equal(chamadas.length, 0, 'fonte local nao pode fazer chamada de rede');
  await assert.rejects(() => cpfValida.run({ tipo: 'cpf', valor: '11144477736' }, contexto), /CPF invalido/);

  const placaLocal = await fonte('placa_footprint').run({ tipo: 'placa', valor: 'ABC1D23' }, contexto);
  assert.equal(placaLocal.dados.placa, 'ABC1D23');
  assert.match(placaLocal.dados.modelo, /Mercosul/);
  assert.ok(placaLocal.dados.buscas['Veiculos e Detran'].length > 0);
  assert.ok(placaLocal.dados.links.fipe.includes('ABC1D23'));
  assert.equal(chamadas.length, 0, 'fonte local nao pode fazer chamada de rede');
  await assert.rejects(() => fonte('placa_footprint').run({ tipo: 'placa', valor: 'ABC1D2' }, contexto), /placa nao reconhecida/);

  // -------------------------------------------------------------------------
  // cpf_brasilapi: formato esperado, 404 e formato inesperado.
  // -------------------------------------------------------------------------
  const cpfRede = fonte('cpf_brasilapi');
  rota = url => {
    assert.match(url, /brasilapi\.com\.br\/api\/cpf\/v1\/11144477735/);
    return {
      status: 200,
      corpo: JSON.stringify({
        nome: 'MARIA SILVA',
        nascimento: { day: 1, month: 5, year: 1980 },
        sexo: 'F',
        mae: 'ANA SILVA',
        pai: 'JOSE SILVA',
        email: 'maria@example.invalid',
        telefone: '11999999999',
        endereco: { cep: '01001000', logradouro: 'Praca', numero: '1', bairro: 'Centro', localidade: 'Sao Paulo', uf: 'SP' }
      })
    };
  };
  const cpfDados = await cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto);
  assert.equal(cpfDados.dados.existe, true);
  assert.equal(cpfDados.dados.nome, 'MARIA SILVA');
  assert.equal(cpfDados.dados.nascimento, '1980-05-01');
  assert.equal(cpfDados.dados.endereco.uf, 'SP');
  assert.equal(cpfDados.dados.endereco.municipio, 'Sao Paulo');
  assert.equal(chamadas.length, 1);

  rota = () => ({ status: 404, corpo: '{}' });
  const cpfAusente = await cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto);
  assert.equal(cpfAusente.dados.existe, false);
  assert.match(cpfAusente.dados.observacao, /nao consta/);

  rota = () => ({ status: 200, corpo: JSON.stringify({ sem_campos_esperados: true }) });
  await assert.rejects(() => cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto), /formato inesperado/);

  rota = () => ({ status: 500, corpo: 'erro interno' });
  await assert.rejects(() => cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto), /HTTP 500/);

  // -------------------------------------------------------------------------
  // placa_sinesp: formato esperado, 404 e formato inesperado.
  // -------------------------------------------------------------------------
  const placaRede = fonte('placa_sinesp');
  rota = url => {
    assert.match(url, /apicarros\.com/);
    return {
      status: 200,
      corpo: JSON.stringify({
        data: { vehicle: { modelo: 'HB20', anoModelo: 2020, anoFabricacao: 2019, cor: 'BRANCO', cidade: 'SAO PAULO', uf: 'SP', tipoVeiculo: 'AUTO' } }
      })
    };
  };
  const placaDados = await placaRede.run({ tipo: 'placa', valor: 'ABC1D23' }, contexto);
  assert.equal(placaDados.dados.existe, true);
  assert.equal(placaDados.dados.modelo, 'HB20');
  assert.equal(placaDados.dados.ano_modelo, 2020);
  assert.equal(placaDados.dados.cor, 'BRANCO');
  assert.equal(placaDados.dados.uf, 'SP');

  rota = () => ({ status: 404, corpo: '{}' });
  const placaAusente = await placaRede.run({ tipo: 'placa', valor: 'ABC1D23' }, contexto);
  assert.equal(placaAusente.dados.existe, false);

  rota = () => ({ status: 200, corpo: JSON.stringify({ data: {} }) });
  await assert.rejects(() => placaRede.run({ tipo: 'placa', valor: 'ABC1D23' }, contexto), /formato inesperado/);

  // -------------------------------------------------------------------------
  // nome_perfil: candidatos de usuario, perfis encontrados e site fora do ar.
  // -------------------------------------------------------------------------
  const nomeRede = fonte('nome_perfil');
  const respostaDe = usuario => ({
    github: { status: 200, corpo: JSON.stringify({ login: usuario, name: 'Maria Silva', html_url: `https://github.com/${usuario}` }) },
    gitlab: { status: 200, corpo: '[]' },
    hackernews: { status: 200, corpo: JSON.stringify({ id: usuario }) },
    keybase: { status: 500, corpo: 'erro' },
    devto: { status: 200, corpo: JSON.stringify({ username: usuario, name: 'Maria Silva' }) }
  });
  rota = url => {
    if (url.includes('api.github.com/users/')) return respostaDe(url.split('/users/')[1]).github;
    if (url.includes('gitlab.com/api/v4/users')) return respostaDe('x').gitlab;
    if (url.includes('hacker-news.firebaseio.com')) return respostaDe('x').hackernews;
    if (url.includes('keybase.io')) return respostaDe('x').keybase;
    if (url.includes('dev.to/api/users')) return respostaDe('x').devto;
    throw new Error(`fetch sem resposta preparada: ${url}`);
  };
  const nomeDados = await nomeRede.run({ tipo: 'nome', valor: 'Maria Silva' }, contexto);
  assert.ok(nomeDados.dados.usuarios.includes('mariasilva'));
  assert.ok(nomeDados.dados.usuarios.includes('maria.silva'));
  assert.deepEqual(nomeDados.dados.perfis.map(p => p.site), ['github', 'hackernews', 'devto', 'github', 'hackernews', 'devto']);
  assert.equal(nomeDados.dados.falhas, 2);
  assert.ok(nomeDados.dados.buscas['Redes e perfis'].length > 0);
  assert.match(nomeDados.dados.observacao, /Maigret/);

  // Acento e nome do meio: o candidato sai sem acento e com a inicial do
  // nome do meio.
  const comAcento = await nomeRede.run({ tipo: 'nome', valor: 'José Antônio Silva' }, contexto);
  assert.ok(comAcento.dados.usuarios.includes('joseasilva'), 'acento nao foi removido do candidato');
  assert.ok(!comAcento.dados.usuarios.some(u => /[^\x00-\x7F]/.test(u)));

  // Nenhum site responde: e falha real do provedor, e nao "nada encontrado".
  rota = () => ({ status: 500, corpo: 'erro' });
  await assert.rejects(() => nomeRede.run({ tipo: 'nome', valor: 'Maria Silva' }, contexto), /nenhum site de perfil respondeu/);

  // Nome sem partes suficientes: nao ha candidato nem consulta.
  await assert.rejects(() => nomeRede.run({ tipo: 'nome', valor: 'Madonna' }, contexto), /partes suficientes/);

  // -------------------------------------------------------------------------
  // Scan completo: CPF, placa e nome.
  // -------------------------------------------------------------------------
  const cacheEntries = new Map();
  globalThis.caches = {
    default: {
      async match(k) { return cacheEntries.get(k.url)?.clone(); },
      async put(k, r) { cacheEntries.set(k.url, r.clone()); }
    }
  };
  const kv = new Map();
  const env = {
    OSINT_KV: {
      async get(k) { return kv.get(k) || null; },
      async put(k, v) { kv.set(k, v); }
    }
  };
  const scan = async alvo => {
    const resposta = await handleScan(
      new Request('https://local.test/api/scan', { method: 'POST', body: JSON.stringify({ alvo }) }),
      env,
      'local-test'
    );
    return { status: resposta.status, relatorio: await resposta.json() };
  };

  rota = url => {
    if (url.includes('brasilapi.com.br')) {
      return { status: 200, corpo: JSON.stringify({ nome: 'MARIA SILVA', nascimento: '1980-05-01' }) };
    }
    if (url.includes('apicarros.com')) {
      return { status: 200, corpo: JSON.stringify({ data: { vehicle: { modelo: 'HB20', anoModelo: 2020, cor: 'BRANCO', uf: 'SP' } } }) };
    }
    if (url.includes('query.wikidata.org')) {
      return { status: 200, corpo: JSON.stringify({ results: { bindings: [] } }) };
    }
    if (url.includes('api.github.com/users/')) return respostaDe('mariasilva').github;
    if (url.includes('gitlab.com/api/v4/users')) return respostaDe('x').gitlab;
    if (url.includes('hacker-news.firebaseio.com')) return respostaDe('x').hackernews;
    if (url.includes('keybase.io')) return respostaDe('x').keybase;
    if (url.includes('dev.to/api/users')) return respostaDe('x').devto;
    throw new Error(`fetch sem resposta preparada: ${url}`);
  };

  const cpfScan = await scan('111.444.777-35');
  assert.equal(cpfScan.status, 200, 'CPF deve responder 200 (antes respondia 400)');
  assert.equal(cpfScan.relatorio.alvo.tipo, 'cpf');
  assert.deepEqual(cpfScan.relatorio.fontes.map(f => f.id).sort(), ['cpf_brasilapi', 'cpf_valida']);
  assert.equal(cpfScan.relatorio.fontes.find(f => f.id === 'cpf_valida').status, 'ok');
  assert.ok(cpfScan.relatorio.html.includes('CADASTRO DE CPF'));

  const placaScan = await scan('ABC1D23');
  assert.equal(placaScan.status, 200);
  assert.equal(placaScan.relatorio.alvo.tipo, 'placa');
  assert.deepEqual(placaScan.relatorio.fontes.map(f => f.id).sort(), ['placa_footprint', 'placa_sinesp']);

  const nomeScan = await scan('Maria Silva');
  assert.equal(nomeScan.status, 200);
  assert.equal(nomeScan.relatorio.alvo.tipo, 'nome');
  const idsNome = nomeScan.relatorio.fontes.map(f => f.id).sort();
  assert.ok(idsNome.includes('wikidata'));
  assert.ok(idsNome.includes('nome_perfil'));
  // O Datajud exige credencial: sem a chave ele responde sem_chave e o
  // relatorio NAO e marcado como parcial.
  const datajud = nomeScan.relatorio.fontes.find(f => f.id === 'datajud');
  assert.equal(datajud.status, 'erro');
  assert.equal(datajud.erro_codigo, 'sem_chave');
  assert.equal(nomeScan.relatorio.score.parcial, false);

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; fixtures offline; aceitacao de rede real pendente (npm run probe:novas / npm run probe:live)',
    alvos: ['cpf', 'placa', 'nome'],
    fontesNovas: 5,
    cpf: { detectado: true, scan: cpfScan.status, fontes: cpfScan.relatorio.fontes.length },
    placa: { detectado: true, scan: placaScan.status, fontes: placaScan.relatorio.fontes.length },
    nome: { scan: nomeScan.status, perfis: nomeScan.relatorio.fontes.find(f => f.id === 'nome_perfil').dados.perfis.length },
    provedores: { cpf: 'brasilapi', placa: 'sinesp-apicarros', perfis: 'github/gitlab/hackernews/keybase/devto' }
  }));
} finally {
  globalThis.fetch = realFetch;
}
