// Sonda: le o codigo-fonte de repositorios publicos (GitHub) para descobrir
// as rotas REAIS dos provedores de placa. O motivo e simples: a API do FIPE
// responde 404 em todas as rotas e o host apicarros.com virou um dominio
// estacionado ("this domain may be for sale"), entao nenhum dos dois
// enderecos que o projeto usava funciona.
//
// A busca e por URL dentro do codigo: e o que o codigo realmente chama.
//
//   node verification/probe-placa-github.mjs

const UA = 'ostnt.online scanner (+https://ostnt.online)';

async function texto(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/plain,*/*' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    });
    const t = await r.text();
    return { status: r.status, ms: Date.now() - t0, corpo: t };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, erro: String(e?.message || e).slice(0, 120) };
  }
}

// Repositorios candidatos (busca por "consulta placa" / "sinesp placa"),
// com os arquivos que costuma conter a rota.
const REPOS = [
  ['maxh33/consulta-veicular', [
    'sinesp.py', 'lookup.py', 'client.py', 'README.md', '.env.example'
  ]],
  ['juniorkrz/placa-fipe-api', ['README.md', 'placa_fipe/__init__.py', 'placa_fipe/api.py', 'main.py']],
  ['rafaelvcb/api-placa-fipe', ['README.md', 'src/index.ts', 'src/api.ts']],
  ['victor-torres/sinesp-client', ['README.md', 'sinesp_client/__init__.py', 'sinesp_client/sinesp.py']],
  ['yagoluiz/consultaplaca-api', ['README.md', 'src/index.js', 'index.js']],
  ['jetherbsf/placa-fipe-api', ['README.md']],
  ['fabiovianna89/SINESP_Consulta', ['README.md']]
];

// Arquivos que valem a leitura inteira: e neles que esta a rota.
const FULL = [
  ['maxh33/consulta-veicular', 'sinesp.py'],
  ['maxh33/consulta-veicular', 'lookup.py'],
  ['maxh33/consulta-veicular', 'client.py'],
  ['yagoluiz/consultaplaca-api', 'src/services/sinesp-service.js'],
  ['victor-torres/sinesp-client', 'src/sinesp_client/__init__.py'],
  ['victor-torres/sinesp-client', 'src/sinesp_client/body.xml'],
  ['juniorkrz/placa-fipe-api', 'fipe/main.py'],
  ['juniorkrz/placa-fipe-api', 'fipe/tokens.py'],
  ['rafaelvcb/api-placa-fipe', 'src/index.ts']
];

function urlsDo(texto) {
  return [...new Set(
    (texto.match(/https?:\/\/[^\s"'`)<>\]|]{6,160}/g) || [])
      .map(u => u.replace(/[.,;)]+$/, ''))
  )];
}

async function main() {
  for (const [repo, arquivos] of REPOS) {
    console.log(`--- ${repo} ---`);
    const arvore = await texto(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`);
    let caminhos = [];
    if (arvore.status === 200) {
      try { caminhos = (JSON.parse(arvore.corpo).tree || []).map(t => t.path); } catch { caminhos = []; }
    }
    console.log(JSON.stringify({ repo, arvore: arvore.status, arquivos: caminhos.slice(0, 60) }));
    const lidos = arquivos.filter(a => !caminhos.length || caminhos.some(c => c.endsWith(a)));
    for (const arq of lidos) {
      const url = `https://raw.githubusercontent.com/${repo}/HEAD/${arq}`;
      const r = await texto(url);
      if (r.status !== 200) {
        console.log(JSON.stringify({ repo, arq, status: r.status }));
        continue;
      }
      const urls = urlsDo(r.corpo);
      console.log(JSON.stringify({ repo, arq, status: r.status, ms: r.ms, urls: urls.slice(0, 25) }));
    }
  }

  console.log('--- CODIGO (leitura integral) ---');
  for (const [repo, arq] of FULL) {
    const url = `https://raw.githubusercontent.com/${repo}/HEAD/${arq}`;
    const r = await texto(url);
    console.log(`===== ${repo} :: ${arq} (${r.status}) =====`);
    console.log((r.corpo || r.erro || '').slice(0, 4000));
  }
}

await main();
