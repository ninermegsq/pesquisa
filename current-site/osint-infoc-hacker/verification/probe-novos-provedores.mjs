// Sonda dos provedores candidatos para os alvos novos: CPF, placa e nome
// completo. Roda fora do Worker (node), apenas mede: quem responde, com
// que status e com que corpo.
//
// A sonda e a base medida das implementacoes em src/sources/registry.mjs:
// nenhuma fonte entra no registro sem ter passado por aqui.
//
// Uso: node verification/probe-novos-provedores.mjs

const UA = 'ostnt.online scanner (+https://ostnt.online)';

async function medir(url, { timeout = 12000, accept = 'application/json', headers = {} } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept, ...headers },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow'
    });
    const corpo = await r.text();
    return { status: r.status, ms: Date.now() - t0, corpo: corpo.slice(0, 500) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, erro: String(e?.message || e).slice(0, 160) };
  }
}

// ---------------------------------------------------------------- CPF
const CPF_TESTE = '11144477735'; // CPF de teste publicado na literatura (DV valido)
const cpfAlvos = [
  { grupo: 'cpf', nome: 'brasilapi', url: `https://brasilapi.com.br/api/cpf/v1/${CPF_TESTE}` },
  { grupo: 'cpf', nome: 'brasilapi-v2', url: `https://brasilapi.com.br/api/cpf/v2/${CPF_TESTE}` },
  { grupo: 'cpf', nome: 'cnpja-publica', url: `https://publica.cnpja.com/cpf/${CPF_TESTE}` },
  { grupo: 'cpf', nome: 'cnpja-comercial', url: `https://comercial.cnpja.com/cpf/${CPF_TESTE}` },
  { grupo: 'cpf', nome: 'cnpja-site', url: `https://cnpja.com/api/cpf/${CPF_TESTE}` },
  { grupo: 'cpf', nome: 'localizacpf', url: `https://api.localizacpf.com/v1/cpf/${CPF_TESTE}` },
  { grupo: 'cpf', nome: 'serpro-scp', url: `https://api.scp.gov.br/consulta-cpf/v1/cpf/${CPF_TESTE}` },
  { grupo: 'cpf', nome: 'minhareceita', url: `https://minhareceita.org/${CPF_TESTE}` },
  { grupo: 'cpf', nome: 'consultar-io', url: `https://consultar-io.com/api/cpf/${CPF_TESTE}` }
];

// ------------------------------------------------------------- PLACA
const PLACA_TESTE = 'ABC1D23';
const placaAlvos = [
  { grupo: 'placa', nome: 'fipe-v1', url: `https://veiculos.fipe.org.br/api/veiculos/v1/placa/${PLACA_TESTE}.json` },
  { grupo: 'placa', nome: 'fipe-v1-sem-hifen', url: `https://veiculos.fipe.org.br/api/veiculos/v1/placa/${PLACA_TESTE.replace('-', '')}.json` },
  { grupo: 'placa', nome: 'fipe-v2', url: `https://veiculos.fipe.org.br/api/veiculos/v2/placa/${PLACA_TESTE}.json` },
  { grupo: 'placa', nome: 'fipe-v1-antiga', url: `https://veiculos.fipe.org.br/api/veiculos/v1/placa/${'ABC1234'}.json` },
  { grupo: 'placa', nome: 'placabrasileiro', url: 'https://placabrasileiro.com.br/api/placa/ABC1D23' },
  { grupo: 'placa', nome: 'placabrasileiro-api', url: 'https://api.placabrasileiro.com.br/v1/placa/ABC1D23' },
  { grupo: 'placa', nome: 'consultaplaca', url: 'https://api.consultaplaca.com.br/placa/ABC1D23' },
  { grupo: 'placa', nome: 'consulta-placa-fly', url: 'https://consulta-placa-api.fly.dev/placa/ABC1D23' },
  { grupo: 'placa', nome: 'mercosul-oficial', url: 'https://api.mercosul.com.br/placa/ABC1D23' }
];

// -------------------------------------------------------------- NOME
const NOME_TESTE = 'Maria Silva';
const NOME_FALSO = 'Zequila Furnoblesc';
const nomeAlvos = [
  { grupo: 'nome', nome: 'orcid', url: `https://pub.orcid.org/v3.0/search/?q=${encodeURIComponent('given-names:' + NOME_TESTE + ' AND family-name:' + NOME_TESTE.split(' ')[1])}` },
  { grupo: 'nome', nome: 'openlibrary', url: `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(NOME_TESTE)}` },
  { grupo: 'nome', nome: 'openalex', url: `https://api.openalex.org/authors?search=${encodeURIComponent(NOME_TESTE)}&per-page=5` },
  { grupo: 'nome', nome: 'viaf', url: `https://viaf.org/viaf/AutoSuggest?query=${encodeURIComponent(NOME_TESTE)}` },
  { grupo: 'nome', nome: 'nominatim', url: `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=${encodeURIComponent(NOME_TESTE + ' Brasil')}` },
  { grupo: 'nome', nome: 'openlibrary-falso', url: `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(NOME_FALSO)}` },
  { grupo: 'nome', nome: 'openalex-falso', url: `https://api.openalex.org/authors?search=${encodeURIComponent(NOME_FALSO)}&per-page=5` }
];

// Sites de perfil publico para derivacao de nome de usuario (estilo Maigret).
const USUARIO_TESTE = 'mariassilva';
const USUARIO_FALSO = 'zequilafurnoblesc99';
const SITES_USUARIO = [
  { nome: 'reddit', url: u => `https://www.reddit.com/user/${u}/about.json`, json: true },
  { nome: 'gitlab', url: u => `https://gitlab.com/api/v4/users?username=${u}` },
  { nome: 'bitbucket', url: u => `https://api.bitbucket.org/2.0/users/${u}` },
  { nome: 'hackernews', url: u => `https://hacker-news.firebaseio.com/v0/user/${u}.json` },
  { nome: 'devto', url: u => `https://dev.to/api/users/by_username?url=${u}` },
  { nome: 'chess', url: u => `https://api.chess.com/pub/player/${u}` },
  { nome: 'keybase', url: u => `https://keybase.io/_api/1.0/user/lookup.json?username=${u}` },
  { nome: 'github', url: u => `https://api.github.com/users/${u}` },
  { nome: 'telegram', url: u => `https://t.me/${u}`, accept: 'text/html' },
  { nome: 'steam', url: u => `https://steamcommunity.com/id/${u}`, accept: 'text/html' },
  { nome: 'roblox', url: u => `https://api.roblox.com/users.roblox.com/v1/users/search?keyword=${u}&limit=5` }
];

const usuarioAlvos = [];
for (const site of SITES_USUARIO) {
  usuarioAlvos.push({ grupo: 'usuario', nome: `${site.nome} (existe)`, url: site.url(USUARIO_TESTE), accept: site.accept });
  usuarioAlvos.push({ grupo: 'usuario', nome: `${site.nome} (inexistente)`, url: site.url(USUARIO_FALSO), accept: site.accept });
}

// Segunda rodada: rotas alternativas, formatos de resposta que a
// implementacao precisa conhecer e amostras positivas dos sites de perfil.
const EXTRA = [
  // --- CPF: outros provedores e os codigos de resposta do BrasilAPI ---
  { grupo: 'cpf2', nome: 'speedio', url: `https://api-publica.speedio.com.br/buscarcpf?cpf=${CPF_TESTE}` },
  { grupo: 'cpf2', nome: 'brasilapi-www', url: `https://api.brasilapi.com.br/api/cpf/v1/${CPF_TESTE}` },
  { grupo: 'cpf2', nome: 'brazilapi', url: `https://api.brazilapi.com.br/api/cpf/v1/${CPF_TESTE}` },
  { grupo: 'cpf2', nome: 'cpf-dv-invalido', url: 'https://brasilapi.com.br/api/cpf/v1/11111111111' },
  { grupo: 'cpf2', nome: 'cpf-sequencia-testes', url: 'https://brasilapi.com.br/api/cpf/v1/12345678909' },
  { grupo: 'cpf2', nome: 'cpf-inexistente', url: 'https://brasilapi.com.br/api/cpf/v1/52998224725' },

  // --- Placa: a rota existe? e o que o FIPE responde ---
  { grupo: 'placa2', nome: 'fipe-modelos', url: 'https://veiculos.fipe.org.br/api/veiculos/v1/modelos.json' },
  { grupo: 'placa2', nome: 'fipe-marcas', url: 'https://veiculos.fipe.org.br/api/veiculos/v1/marcas.json' },
  { grupo: 'placa2', nome: 'fipe-placa-inexistente', url: 'https://veiculos.fipe.org.br/api/veiculos/v1/placa/ZZZZZZZZ.json' },
  { grupo: 'placa2', nome: 'fipe-swagger', url: 'https://veiculos.fipe.org.br/api-docs/swagger.json' },
  { grupo: 'placa2', nome: 'fipe-openapi', url: 'https://veiculos.fipe.org.br/api/openapi.json' },

  // --- Nome: formato exato das respostas ---
  { grupo: 'nome2', nome: 'orcid-pessoa', url: 'https://pub.orcid.org/v3.0/0000-0003-0917-0498/person' },
  { grupo: 'nome2', nome: 'openalex-autor', url: 'https://api.openalex.org/authors?search=Maria%20Silva&per-page=1' },
  { grupo: 'nome2', nome: 'viaf-json', url: 'https://viaf.org/viaf/AutoSuggest?query=Maria%20Silva' },

  // --- Sites de perfil: amostras positivas (existencia confirmada) ---
  { grupo: 'usuario2', nome: 'devto-ben', url: 'https://dev.to/api/users/by_username?url=ben' },
  { grupo: 'usuario2', nome: 'bitbucket-white', url: 'https://api.bitbucket.org/2.0/users/white' },
  { grupo: 'usuario2', nome: 'hackernews-pg', url: 'https://hacker-news.firebaseio.com/v0/user/pg.json' },
  { grupo: 'usuario2', nome: 'keybase-chris', url: 'https://keybase.io/_api/1.0/user/lookup.json?username=chris' },
  { grupo: 'usuario2', nome: 'steam-gaben', url: 'https://steamcommunity.com/id/gaben', accept: 'text/html' },
  { grupo: 'usuario2', nome: 'github-busca-nome', url: 'https://api.github.com/search/users?q=%22Maria+Silva%22+in:fullname&per_page=5' },

  // --- Keybase: a rota antiga (_api) responde 404; a atual usa /_/api ---
  { grupo: 'usuario3', nome: 'keybase-novo-pg', url: 'https://keybase.io/_/api/1.0/user/lookup.json?username=pg' },
  { grupo: 'usuario3', nome: 'keybase-novo-mariassilva', url: 'https://keybase.io/_/api/1.0/user/lookup.json?username=mariassilva' },
  { grupo: 'usuario3', nome: 'keybase-novo-chris', url: 'https://keybase.io/_/api/1.0/user/lookup.json?username=chris' },
  { grupo: 'usuario3', nome: 'keybase-antigo-pg', url: 'https://keybase.io/_api/1.0/user/lookup.json?username=pg' },
  { grupo: 'usuario3', nome: 'keybase-autocomplete', url: 'https://keybase.io/_/api/1.0/user/autocomplete.json?username=marias' },

  // --- Dev.to: a rota por username responde 200 quando o usuario existe ---
  { grupo: 'usuario3', nome: 'devto-mariassilva', url: 'https://dev.to/api/users/by_username?url=mariassilva' },
  { grupo: 'usuario3', nome: 'hackernews-marias', url: 'https://hacker-news.firebaseio.com/v0/user/marias.json' },
  { grupo: 'usuario3', nome: 'github-marias', url: 'https://api.github.com/users/marias' },
  { grupo: 'usuario3', nome: 'gitlab-marias', url: 'https://gitlab.com/api/v4/users?username=marias' }
];

async function main() {
  const alvos = [...cpfAlvos, ...placaAlvos, ...nomeAlvos, ...usuarioAlvos, ...EXTRA];
  const resultados = await Promise.all(alvos.map(async a => {
    const r = await medir(a.url, { accept: a.accept || 'application/json' });
    return { grupo: a.grupo, nome: a.nome, url: a.url, ...r };
  }));
  for (const r of resultados) {
    const marca = r.status === 200 ? '200' : String(r.status);
    console.log(JSON.stringify({ grupo: r.grupo, nome: r.nome, status: r.status, ms: r.ms, corpo: r.corpo || r.erro }));
  }
  const resumo = {};
  for (const r of resultados) {
    const k = `${r.grupo}/${r.nome}`;
    resumo[k] = r.status;
  }
  console.log('--- RESUMO ---');
  console.log(JSON.stringify(resumo, null, 1));
}

await main();
