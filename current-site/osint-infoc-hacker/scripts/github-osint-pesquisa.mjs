// Pesquisa dos repositorios open source de OSINT de e-mail e telefone.
//
// Escopo: REDE REAL (API publica do GitHub, sem autenticacao). Este script
// responde "quais repositorios puxam dados por e-mail e por numero de
// celular, ordenados por estrelas?" com o numero real de estrelas do GitHub.
//
//   npm run pesquisa:github
//
// O rate limit da busca publica do GitHub e de 10 requisicoes por minuto
// (sem autenticacao). Com autenticacao (GITHUB_TOKEN no ambiente) o limite
// sobe para 30 por minuto. Quando o limite e atingido, o script espera a
// janela abrir (cabecalho x-ratelimit-reset) e repete a consulta; so depois
// de duas tentativas ele registra o aviso e segue com o que tem.
//
// A saida e um JSON com o ranking. O relatorio escrito a mao, com a leitura
// dos resultados, fica em verification/github-osint.md.

const UA = 'ostnt.online scanner (+https://ostnt.online)';

// As consultas cobrem o que a fonte precisa: descobrir e-mail e descobrir
// numero de celular a partir de um alvo.
const CONSULTAS = [
  {q: 'osint email', rotulo: 'osint email'},
  {q: 'email osint tools', rotulo: 'email osint tools'},
  {q: 'phone number osint', rotulo: 'phone number osint'},
  {q: 'phone number reconnaissance', rotulo: 'phone number reconnaissance'},
  {q: 'email breach check', rotulo: 'email breach check'},
  {q: 'osint tool email phone', rotulo: 'osint tool email phone'},
  {q: 'phone osint investigation', rotulo: 'phone osint investigation'},
  {q: 'osint email domain harvest', rotulo: 'osint email domain harvest'},
  {q: 'osint email username domain', rotulo: 'osint email username domain'},
  {q: 'theharvester osint', rotulo: 'theharvester osint'}
];

const CABECALHOS = () => {
  const h = {accept: 'application/vnd.github+json','user-agent': UA};
  const token = process.env.GITHUB_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
};

async function buscar(q, tentativa = 1) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
  const r = await fetch(url, {headers: CABECALHOS(), signal: AbortSignal.timeout(15000)});
  const restantes = r.headers.get('x-ratelimit-remaining');
  const reset = Number(r.headers.get('x-ratelimit-reset') || 0);
  if ((r.status === 403 || r.status === 429) && reset && tentativa <= 2) {
    // A busca publica permite 10 requisicoes por minuto sem autenticacao. Em
    // vez de perder a consulta, o script espera a janela abrir e repete.
    const espera = Math.min(Math.max(reset * 1000 - Date.now() + 2000, 1000), 70000);
    console.error(`busca "${q}": limite da API (restantes=${restantes}); aguardando ${Math.round(espera / 1000)}s`);
    await new Promise(x => setTimeout(x, espera));
    return buscar(q, tentativa + 1);
  }
  if (r.status === 403 || r.status === 429) {
    return {q, erro: `limite da API do GitHub (restantes=${restantes})`, repos: []};
  }
  if (!r.ok) return {q, erro: `HTTP ${r.status}`, repos: []};
  const j = await r.json();
  return {
    q,
    restantes,
    repos: (j.items || []).map(x => ({
      nome: x.full_name,
      estrelas: x.stargazers_count,
      forks: x.forks_count,
      linguagem: x.language,
      licence: x.license?.spdx_id ?? null,
      atualizado: x.pushed_at,
      descricao: (x.description || '').slice(0, 160),
      url: x.html_url
    }))
  };
}

// Deduplica por nome completo e ordena por estrelas.
function consolidar(resultados) {
  const mapa = new Map();
  for (const r of resultados) {
    for (const repo of r.repos) {
      const atual = mapa.get(repo.nome);
      if (!atual || repo.estrelas > atual.estrelas) mapa.set(repo.nome, {...repo, consultas: [r.q]});
      else if (!atual.consultas.includes(r.q)) atual.consultas.push(r.q);
    }
  }
  return [...mapa.values()].sort((a, b) => b.estrelas - a.estrelas);
}

const resultados = [];
for (const c of CONSULTAS) {
  const r = await buscar(c.q);
  resultados.push(r);
  console.error(`busca "${c.q}": ${r.repos.length} repositorios${r.erro ? ` (${r.erro})` : ''}`);
  await new Promise(x => setTimeout(x, 1200)); // folga entre as buscas
}

const ranking = consolidar(resultados);
const comLicenca = ranking.filter(r => r.licence);
const saida = {
  escopo: 'REDE REAL; API publica de busca do GitHub',
  consultado_em: new Date().toISOString(),
  autenticado: Boolean(process.env.GITHUB_TOKEN),
  consultas: CONSULTAS.map(c => c.q),
  total_repositorios: ranking.length,
  ranking: ranking.slice(0, 40).map((r, i) => ({posicao: i + 1, ...r})),
  avisos: resultados.filter(r => r.erro).map(r => r.erro),
  observacao: `licenca declarada no GitHub em ${comLicenca.length} de ${ranking.length} repositorios; a licenca do codigoported e do proprio projeto, nao do repositorio consultado`
};
console.log(JSON.stringify(saida, null, 2));
