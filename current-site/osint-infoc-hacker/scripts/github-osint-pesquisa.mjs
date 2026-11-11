// Pesquisa dos repositorios open source de OSINT.
//
// Escopo: REDE REAL (API publica do GitHub, sem autenticacao). Este script
// responde "quais repositorios puxam dados por e-mail, telefone, nome
// completo, CPF ou placa, ordenados por estrelas, e quais ainda sao
// mantidos?", com o numero real de estrelas e a data real do ultimo push.
//
//   npm run pesquisa:github                 # todas as consultas
//   npm run pesquisa:github -- --fase 2     # so as consultas novas (nome/CPF/placa)
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

// As consultas cobrem o que a fonte precisa: descobrir e-mail, descobrir
// numero de celular, puxar dados por nome completo, por CPF e por placa.
//
// Fase 1: e-mail e telefone (pesquisa ja publicada no relatorio).
// Fase 2: nome completo, CPF e placa (pedido de 2026-11-11).
const CONSULTAS = [
  {fase: 1, q: 'osint email', rotulo: 'osint email'},
  {fase: 1, q: 'email osint tools', rotulo: 'email osint tools'},
  {fase: 1, q: 'phone number osint', rotulo: 'phone number osint'},
  {fase: 1, q: 'phone number reconnaissance', rotulo: 'phone number reconnaissance'},
  {fase: 1, q: 'email breach check', rotulo: 'email breach check'},
  {fase: 1, q: 'osint tool email phone', rotulo: 'osint tool email phone'},
  {fase: 1, q: 'phone osint investigation', rotulo: 'phone osint investigation'},
  {fase: 1, q: 'osint email domain harvest', rotulo: 'osint email domain harvest'},
  {fase: 1, q: 'osint email username domain', rotulo: 'osint email username domain'},
  {fase: 1, q: 'theharvester osint', rotulo: 'theharvester osint'},

  {fase: 2, q: 'osint person name search', rotulo: 'osint person name search'},
  {fase: 2, q: 'username from name osint', rotulo: 'username from name osint'},
  {fase: 2, q: 'maigret sherlock username', rotulo: 'maigret sherlock username'},
  {fase: 2, q: 'consulta cpf api', rotulo: 'consulta cpf api'},
  {fase: 2, q: 'cpf brasil leaked dataset', rotulo: 'cpf brasil leaked dataset'},
  {fase: 2, q: 'consulta placa veiculo api', rotulo: 'consulta placa veiculo api'},
  {fase: 2, q: 'vehicle license plate lookup brazil', rotulo: 'vehicle license plate lookup brazil'},
  {fase: 2, q: 'placa de carro consulta dados', rotulo: 'placa de carro consulta dados'}
];

const argumentos = process.argv.slice(2);
const opcao = nome => {
  for (let i = 0; i < argumentos.length; i++) {
    if (argumentos[i] === `--${nome}`) return argumentos[i + 1] ?? '';
    if (argumentos[i].startsWith(`--${nome}=`)) return argumentos[i].slice(nome.length + 3);
  }
  return '';
};
const fasePedida = Number(opcao('fase') || 0);
const consultas = fasePedida ? CONSULTAS.filter(c => c.fase === fasePedida) : CONSULTAS;

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
for (const c of consultas) {
  const r = await buscar(c.q);
  resultados.push(r);
  console.error(`busca "${c.q}": ${r.repos.length} repositorios${r.erro ? ` (${r.erro})` : ''}`);
  await new Promise(x => setTimeout(x, 1200)); // folga entre as buscas
}

const ranking = consolidar(resultados);
const comLicenca = ranking.filter(r => r.licence);
const agora = Date.now();
// "Atualizado" = push nos ultimos 365 dias. O GitHub devolve `pushed_at` de
// verdade (nao a data de criacao), entao e o dado de manutencao do repo.
const dias = r => (r.atualizado ? Math.floor((agora - Date.parse(r.atualizado)) / 86400000) : null);
const mantidos = ranking.filter(r => dias(r) !== null && dias(r) <= 365);
const saida = {
  escopo: 'REDE REAL; API publica de busca do GitHub',
  consultado_em: new Date().toISOString(),
  autenticado: Boolean(process.env.GITHUB_TOKEN),
  fase: fasePedida || 'todas',
  consultas: consultas.map(c => c.q),
  total_repositorios: ranking.length,
  mantidos_ultimo_ano: mantidos.length,
  ranking: ranking.slice(0, 40).map((r, i) => ({posicao: i + 1, ...r, dias_sem_push: dias(r)})),
  avisos: resultados.filter(r => r.erro).map(r => r.erro),
  observacao: `licenca declarada no GitHub em ${comLicenca.length} de ${ranking.length} repositorios; ${mantidos.length} com push nos ultimos 365 dias; a licenca do codigo ported e do proprio projeto, nao do repositorio consultado`
};
console.log(JSON.stringify(saida, null, 2));
