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
//   - o contrato de parsing das fontes de rede, com os formatos MEDIDOS
//     em 2026-11-11: a BrasilAPI no CPF (cadastro completo, digitos
//     validos sem dados pessoais, digitos invalidos, 404), o Consultar
//     Placa (sucesso, placa nao encontrada, servico indisponivel, 401) e
//     o Keybase (perfil encontrado e usuario inexistente);
//   - a credencial obrigatoria da fonte de veiculo: sem ela a fonte
//     responde sem_chave e o relatorio NAO e marcado como parcial;
//   - o scan completo de um alvo CPF, que antes voltava 400.
//
// O que este check NAO prova: a disponibilidade real dos provedores. A
// aceitacao com internet real foi feita em 2026-11-11
// (`npm run aceite:novos-alvos`) e esta registrada em
// verification/status.md.

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
// Contexto com a credencial do provedor de veiculo: entre as tres fontes de
// rede dos alvos novos, e a unica que exige credencial do operador.
const contextoComCredencial = ctx(
  { UA_MODE: 'identificado', UA: 'fixture-check/1.0', CONSULTARPLACA_CREDENCIAL: 'conta@example.invalid:api_key_falsa' },
  'https://local.test'
);

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
  assert.ok(placaLocal.dados.links.consultar_placa.includes('ABC1D23'));
  assert.equal(placaLocal.dados.links.sinesp_oficial, 'https://cidadao.sinesp.gov.br/');
  assert.equal(chamadas.length, 0, 'fonte local nao pode fazer chamada de rede');
  await assert.rejects(() => fonte('placa_footprint').run({ tipo: 'placa', valor: 'ABC1D2' }, contexto), /placa nao reconhecida/);

  // -------------------------------------------------------------------------
  // cpf_brasilapi: os quatro formatos medidos ao vivo em 2026-11-11.
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
        endereco: { cep: '01001000', logradouro: 'Praca', numero: '1', bairro: 'Centro', localidade: 'Sao Paulo', uf: 'SP' },
        rf: 7,
        ufs: ['ES', 'RJ']
      })
    };
  };
  const cpfDados = await cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto);
  assert.equal(cpfDados.dados.existe, true);
  assert.equal(cpfDados.dados.cadastro_disponivel, true);
  assert.equal(cpfDados.dados.nome, 'MARIA SILVA');
  assert.equal(cpfDados.dados.nascimento, '1980-05-01');
  assert.equal(cpfDados.dados.endereco.uf, 'SP');
  assert.equal(cpfDados.dados.endereco.municipio, 'Sao Paulo');
  assert.equal(cpfDados.dados.regiao_fiscal, '7');
  assert.deepEqual(cpfDados.dados.ufs, ['ES', 'RJ']);
  assert.equal(chamadas.length, 1);

  // Medido: digitos validos e regiao fiscal, sem dados pessoais publicados.
  // `existe` fica nulo: o provedor nao disse que o CPF existe nem que nao
  // existe.
  rota = () => ({
    status: 200,
    corpo: JSON.stringify({ cpf: '111.444.777-35', isValid: true, rf: 7, ufs: ['ES', 'RJ'] })
  });
  const cpfSemCadastro = await cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto);
  assert.equal(cpfSemCadastro.dados.existe, null);
  assert.equal(cpfSemCadastro.dados.digitos_validos, true);
  assert.equal(cpfSemCadastro.dados.cadastro_disponivel, false);
  assert.equal(cpfSemCadastro.dados.regiao_fiscal, '7');
  assert.deepEqual(cpfSemCadastro.dados.ufs, ['ES', 'RJ']);
  assert.equal(cpfSemCadastro.dados.nome, undefined);

  // Medido: digitos invalidos.
  rota = () => ({ status: 200, corpo: JSON.stringify({ isValid: false }) });
  const cpfInvalido = await cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto);
  assert.equal(cpfInvalido.dados.existe, false);
  assert.equal(cpfInvalido.dados.digitos_validos, false);
  assert.equal(cpfInvalido.dados.cadastro_disponivel, false);
  assert.match(cpfInvalido.dados.observacao, /digito verificador/);

  // Medido: 404 (CPF fora da base do provedor).
  rota = () => ({ status: 404, corpo: '{}' });
  const cpfAusente = await cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto);
  assert.equal(cpfAusente.dados.existe, false);
  assert.equal(cpfAusente.dados.digitos_validos, null);
  assert.equal(cpfAusente.dados.cadastro_disponivel, false);
  assert.match(cpfAusente.dados.observacao, /nao consta/);

  // Formato desconhecido e erro de HTTP: erro, nunca dado chumbado.
  rota = () => ({ status: 200, corpo: JSON.stringify({ sem_campos_esperados: true }) });
  await assert.rejects(() => cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto), /formato inesperado/);

  rota = () => ({ status: 500, corpo: 'erro interno' });
  await assert.rejects(() => cpfRede.run({ tipo: 'cpf', valor: '11144477735' }, contexto), /HTTP 500/);

  // -------------------------------------------------------------------------
  // placa_consultarplaca: credencial obrigatoria, sucesso e os erros
  // declarados pelo provedor.
  // -------------------------------------------------------------------------
  const placaRede = fonte('placa_consultarplaca');
  // Sem credencial: a fonte nao roda, e o erro e de configuracao (sem_chave).
  await assert.rejects(
    () => placaRede.run({ tipo: 'placa', valor: 'ABC1D23' }, contexto),
    e => e?.codigo === 'sem_chave' && /CONSULTARPLACA_CREDENCIAL/.test(String(e?.message || ''))
  );

  rota = (url, opts) => {
    assert.match(url, /api\.consultarplaca\.com\.br\/v2\/consultarPlaca\?placa=ABC1D23/);
    // Basic Auth: o e-mail da conta como usuario e a api_key como senha.
    const esperado = 'Basic ' + Buffer.from('conta@example.invalid:api_key_falsa').toString('base64');
    assert.equal(opts?.headers?.get('authorization'), esperado);
    return {
      status: 200,
      corpo: JSON.stringify({
        status: 'ok',
        mensagem: 'Consulta realizada com sucesso!',
        data_solicitacao: '2020-11-22 16:54:10',
        dados: {
          informacoes_veiculo: {
            dados_veiculo: {
              placa: 'ABC1D23',
              chassi: '9AAAA99AAAA999999',
              ano_fabricacao: '2014',
              ano_modelo: '2015',
              marca: 'HYUNDAI',
              modelo: 'HYUNDAI/HB20 1.0M COMFOR',
              cor: 'Branca',
              segmento: 'Auto',
              especie: 'Passageiro',
              combustivel: 'Alcool / Gasolina',
              procedencia: 'Nacional',
              municipio: 'MARINGA',
              uf_municipio: 'PR'
            },
            dados_tecnicos: {
              tipo_veiculo: 'Automovel',
              sub_segmento: 'AU - HATCH PEQUENO',
              numero_motor: 'A9AAAA999999',
              numero_caixa_cambio: 'AA999999999',
              potencia: '80',
              cilindradas: '998'
            }
          }
        }
      })
    };
  };
  const placaDados = await placaRede.run({ tipo: 'placa', valor: 'ABC1D23' }, contextoComCredencial);
  assert.equal(placaDados.dados.existe, true);
  assert.equal(placaDados.dados.provedor, 'consultarplaca');
  assert.equal(placaDados.dados.placa, 'ABC1D23');
  assert.equal(placaDados.dados.modelo, 'HYUNDAI/HB20 1.0M COMFOR');
  assert.equal(placaDados.dados.marca, 'HYUNDAI');
  assert.equal(placaDados.dados.ano_fabricacao, '2014');
  assert.equal(placaDados.dados.ano_modelo, '2015');
  assert.equal(placaDados.dados.cor, 'Branca');
  assert.equal(placaDados.dados.municipio, 'MARINGA');
  assert.equal(placaDados.dados.uf, 'PR');
  assert.equal(placaDados.dados.tipo_veiculo, 'Automovel');
  assert.equal(placaDados.dados.cilindradas, '998');

  // Medido: placa fora da base do provedor.
  rota = () => ({
    status: 200,
    corpo: JSON.stringify({
      status: 'erro',
      tipo_do_erro: 'placa_nao_encontrada',
      mensagem: 'Nao foi possivel obter informacoes para a placa informada.',
      request: { placa: 'ABC1D23' }
    })
  });
  const placaAusente = await placaRede.run({ tipo: 'placa', valor: 'ABC1D23' }, contextoComCredencial);
  assert.equal(placaAusente.dados.existe, false);
  assert.equal(placaAusente.dados.motivo, 'placa_nao_encontrada');

  // Medido: fornecedor indisponivel e erro de credencial: falha de verdade,
  // nunca "placa nao encontrada".
  rota = () => ({
    status: 200,
    corpo: JSON.stringify({
      status: 'erro',
      tipo_do_erro: 'servico_indisponivel',
      mensagem: 'Nao foi possivel completar sua pesquisa.'
    })
  });
  await assert.rejects(
    () => placaRede.run({ tipo: 'placa', valor: 'ABC1D23' }, contextoComCredencial),
    /provedor respondeu erro/
  );

  // Formato desconhecido e credencial rejeitada.
  rota = () => ({ status: 200, corpo: JSON.stringify({ status: 'ok', dados: {} }) });
  await assert.rejects(
    () => placaRede.run({ tipo: 'placa', valor: 'ABC1D23' }, contextoComCredencial),
    /formato inesperado de placa/
  );

  rota = () => ({ status: 401, corpo: 'unauthorized' });
  await assert.rejects(
    () => placaRede.run({ tipo: 'placa', valor: 'ABC1D23' }, contextoComCredencial),
    /HTTP 401/
  );

  // -------------------------------------------------------------------------
  // nome_perfil: candidatos de usuario, perfis, "sem perfil" e site fora do ar.
  // -------------------------------------------------------------------------
  const nomeRede = fonte('nome_perfil');
  const respostaDe = usuario => ({
    github: { status: 200, corpo: JSON.stringify({ login: usuario, name: 'Maria Silva', html_url: `https://github.com/${usuario}` }) },
    gitlab: { status: 200, corpo: '[]' },
    hackernews: { status: 500, corpo: 'erro' },
    keybase: { status: 200, corpo: JSON.stringify({ status: { code: 205, name: 'NOT_FOUND' }, them: null }) },
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
  assert.deepEqual(nomeDados.dados.perfis.map(p => p.site), ['github', 'devto', 'github', 'devto']);
  // Contadores: resposta valida, sem perfil e indisponivel sao coisas
  // diferentes.
  assert.equal(nomeDados.dados.respostas, 8);
  assert.equal(nomeDados.dados.sem_perfil, 4);
  assert.equal(nomeDados.dados.falhas, 2);
  assert.ok(nomeDados.dados.buscas['Redes e perfis'].length > 0);
  assert.match(nomeDados.dados.observacao, /Maigret/);

  // Medido: o Keybase responde 200 com status.code 205 quando o usuario nao
  // existe. Isso e "sem perfil", nao falha.
  rota = url => {
    if (url.includes('keybase.io/_/api/1.0/user/lookup.json')) {
      return {
        status: 200,
        corpo: JSON.stringify({
          status: { code: 0, name: 'OK' },
          them: { basics: { username: 'mariasilva' }, profile: { full_name: 'Maria Silva' } }
        })
      };
    }
    return { status: 404, corpo: '{}' };
  };
  const nomeKeybase = await nomeRede.run({ tipo: 'nome', valor: 'Maria Silva' }, contexto);
  const perfilKeybase = nomeKeybase.dados.perfis.find(p => p.site === 'keybase');
  assert.ok(perfilKeybase, 'perfil do keybase nao foi lido');
  assert.equal(perfilKeybase.usuario, 'mariasilva');
  assert.equal(perfilKeybase.nome, 'Maria Silva');
  assert.equal(perfilKeybase.url, 'https://keybase.io/mariasilva');
  // Os outros sites responderam 404: e resposta valida, nao falha.
  assert.equal(nomeKeybase.dados.falhas, 0);
  assert.equal(nomeKeybase.dados.sem_perfil, 8);

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
    },
    CONSULTARPLACA_CREDENCIAL: 'conta@example.invalid:api_key_falsa'
  };
  const scan = async (alvo, origem = 'https://local.test', ambiente = env) => {
    const resposta = await handleScan(
      new Request(`${origem}/api/scan`, { method: 'POST', body: JSON.stringify({ alvo }) }),
      ambiente,
      'local-test'
    );
    return { status: resposta.status, relatorio: await resposta.json() };
  };

  rota = url => {
    if (url.includes('brasilapi.com.br')) {
      return { status: 200, corpo: JSON.stringify({ nome: 'MARIA SILVA', nascimento: '1980-05-01' }) };
    }
    if (url.includes('api.consultarplaca.com.br')) {
      return {
        status: 200,
        corpo: JSON.stringify({
          status: 'ok',
          dados: {
            informacoes_veiculo: {
              dados_veiculo: { placa: 'ABC1D23', modelo: 'HB20', ano_modelo: '2020', cor: 'BRANCO', municipio: 'SAO PAULO', uf_municipio: 'SP' },
              dados_tecnicos: { tipo_veiculo: 'Automovel' }
            }
          }
        })
      };
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
  assert.deepEqual(placaScan.relatorio.fontes.map(f => f.id).sort(), ['placa_consultarplaca', 'placa_footprint']);
  assert.equal(placaScan.relatorio.fontes.find(f => f.id === 'placa_consultarplaca').status, 'ok');
  assert.ok(placaScan.relatorio.html.includes('VEÍCULO'));

  // Sem a credencial do provedor de veiculo: a fonte responde sem_chave e o
  // relatorio NAO e marcado como parcial. Origem diferente: o cache da
  // consulta anterior nao pode responder por esta.
  const placaSemCredencial = await scan('ABC1D23', 'https://sem-credencial.test', { OSINT_KV: env.OSINT_KV });
  assert.equal(placaSemCredencial.status, 200);
  const veiculo = placaSemCredencial.relatorio.fontes.find(f => f.id === 'placa_consultarplaca');
  assert.equal(veiculo.status, 'erro');
  assert.equal(veiculo.erro_codigo, 'sem_chave');
  assert.equal(placaSemCredencial.relatorio.score.parcial, false);

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
    scope: 'LOCAL ONLY; fixtures offline; aceitacao de rede real feita em 2026-11-11 (npm run aceite:novos-alvos)',
    alvos: ['cpf', 'placa', 'nome'],
    fontesNovas: 5,
    cpf: { detectado: true, scan: cpfScan.status, fontes: cpfScan.relatorio.fontes.length },
    placa: { detectado: true, scan: placaScan.status, fontes: placaScan.relatorio.fontes.length },
    nome: { scan: nomeScan.status, perfis: nomeScan.relatorio.fontes.find(f => f.id === 'nome_perfil').dados.perfis.length },
    provedores: { cpf: 'brasilapi', placa: 'consultarplaca (credencial obrigatoria)', perfis: 'github/gitlab/hackernews/keybase/devto' }
  }));
} finally {
  globalThis.fetch = realFetch;
}
