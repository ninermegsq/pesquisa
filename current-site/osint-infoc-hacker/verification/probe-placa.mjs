// Terceira rodada da sonda: procuro um provedor de placa que responda de
// verdade (a API do FIPE devolveu 404 em todas as rotas, inclusive nas de
// marca e modelo, entao o problema nao e a placa), confiro o formato exato
// do OpenAlex e procuro um usuario de Bitbucket para validar a regra de
// "existe" desse site.
//
//   node verification/probe-placa.mjs
//
// Nao grava nada no projeto: e medicao.

import { resolve } from 'node:dns/promises';

const UA = 'ostnt.online scanner (+https://ostnt.online)';

async function dnsDe(host) {
  try {
    const r = await resolve(host);
    return r.slice(0, 2).join(',');
  } catch (e) {
    return `SEM DNS (${String(e?.code || e?.message || e).slice(0, 60)})`;
  }
}

async function medir(url, { timeout = 12000, accept = 'application/json' } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow'
    });
    const corpo = await r.text();
    return { status: r.status, ms: Date.now() - t0, corpo: corpo.slice(0, 320).replace(/\s+/g, ' ') };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, erro: String(e?.message || e).slice(0, 120) };
  }
}

// --- FIPE: o host responde alguma coisa? ---
const FIPE = [
  'https://veiculos.fipe.org.br/',
  'https://veiculos.fipe.org.br/api/veiculos/v1/veiculos.json',
  'https://veiculos.fipe.org.br/api/veiculos/v2/veiculos.json',
  'https://veiculos.fipe.org.br/api/veiculos/v1/placa/ABC1D23.json',
  'https://fipe.org.br/api/veiculos/v1/placa/ABC1D23.json',
  'https://veiculos.fipe.org.br/api-docs/'
];

// --- Candidatos de placa: host + caminho de exemplo ---
const PLACA = [
  ['consultaplaca.com.br', 'https://consultaplaca.com.br/api/plate/ABC1D23'],
  ['www.consultaplaca.com.br', 'https://www.consultaplaca.com.br/api/plate/ABC1D23'],
  ['api.consultaplaca.com.br', 'https://api.consultaplaca.com.br/plate/ABC1D23'],
  ['placabrasileiro.com.br', 'https://placabrasileiro.com.br/api/placa/ABC1D23'],
  ['api.placabrasileiro.com.br', 'https://api.placabrasileiro.com.br/v1/placa/ABC1D23'],
  ['consulta-placa-api.fly.dev', 'https://consulta-placa-api.fly.dev/placa/ABC1D23'],
  ['api.mercosul.com.br', 'https://api.mercosul.com.br/placa/ABC1D23'],
  ['veiculos.fipe.org.br', 'https://veiculos.fipe.org.br/api/veiculos/v1/placa/ABC1D23.json'],
  ['api.buscaplaca.com.br', 'https://api.buscaplaca.com.br/v1/placa/ABC1D23'],
  ['placaapi.com.br', 'https://placaapi.com.br/api/placa/ABC1D23']
];

// --- SINESP (via API-Carros, o endpoint usado pelo pacote sinesp-api) ---
const SINESP = [
  'https://apicarros.com/',
  'https://apicarros.com/v1/consulta/ABC1D23/json',
  'https://apicarros.com/v1/consulta/ABC1234/json',
  'https://apicarros.com/v1/consulta/ABC1D23/json?callback=x',
  'https://apicarros.com/v2/consulta/ABC1D23/json'
];

// --- Terceira leva: site que o placafipy usa (placafipe.com) e FIPE ---
const PLACA3 = [
  'https://consultarplaca.com.br/',
  'https://docs.consultarplaca.com.br/preco',
  'https://consultarplaca.com.br/api/plate/ABC1D23',
  'https://api.consultarplaca.com.br/plate/ABC1D23',
  'https://consultarplaca.com.br/api/v1/placa/ABC1D23'
];

// --- Busca no GitHub: repositorios de placa/fipe/sinesp ---
const BUSCA_GH = [
  ['consulta-placa', 'https://api.github.com/search/repositories?q=consulta+placa+veiculo&sort=stars&order=desc&per_page=8'],
  ['fipe-api', 'https://api.github.com/search/repositories?q=fipe+api+veiculos&sort=stars&order=desc&per_page=8'],
  ['sinesp-placa', 'https://api.github.com/search/repositories?q=sinesp+placa&sort=updated&order=desc&per_page=8']
];

// --- Candidatos adicionais de provedor de placa ---
const PLACA2 = [
  ['placabrasileiro.com', 'https://placabrasileiro.com/api/placa/ABC1D23'],
  ['api.placabrasileiro.com', 'https://api.placabrasileiro.com/placa/ABC1D23'],
  ['consultaplaca.app', 'https://consultaplaca.app/api/placa/ABC1D23'],
  ['placaapi.com', 'https://placaapi.com/placa/ABC1D23'],
  ['api.placaapi.com', 'https://api.placaapi.com/placa/ABC1D23'],
  ['consultaplate.com', 'https://consultaplate.com/api/plate/ABC1D23'],
  ['api.consultaplate.com', 'https://api.consultaplate.com/plate/ABC1D23'],
  ['todosconsultas.com.br', 'https://todosconsultas.com.br/api/placa/ABC1D23'],
  ['veiclock.com.br', 'https://veiclock.com.br/api/placa/ABC1D23'],
  ['api.apicep.com.br', 'https://api.apicep.com.br/placa/ABC1D23']
];

// --- Bitbucket: algum usuario valido para validar a regra "existe" ---
const BITBUCKET = ['white', 'atlassian', 'tutorials', 'charlie', 'marioc', 'git'];

// --- OpenAlex: formato enxuto do resultado ---
const OPENALEX = 'https://api.openalex.org/authors?search=Maria%20Silva&per-page=2&select=id,display_name,works_count,cited_by_count,orcid,last_known_institutions';

// --- Repositorios candidatos de placa (leem o codigo-fonte para achar a rota) ---
const REPOS = [
  ['consulta-veicular/arvore', 'https://api.github.com/repos/maxh33/consulta-veicular/git/trees/main?recursive=1']
];

async function main() {
  const so = new Set(process.argv.slice(2).filter(a => !a.startsWith('-')));
  const quer = f => !so.size || so.has(f);

  if (quer('fipe')) {
    console.log('--- FIPE ---');
    for (const url of FIPE) {
      const r = await medir(url, { accept: 'text/html,application/json,*/*' });
      console.log(JSON.stringify({ url, dns: await dnsDe(new URL(url).hostname), ...r }));
    }
  }

  if (quer('placa')) {
    console.log('--- PLACA ---');
    for (const [host, url] of PLACA) {
      const r = await medir(url);
      console.log(JSON.stringify({ host, url, dns: await dnsDe(host), ...r }));
    }
  }

  if (quer('sinesp')) {
    console.log('--- SINESP ---');
    for (const url of SINESP) {
      const r = await medir(url, { accept: 'application/json,text/plain,*/*' });
      console.log(JSON.stringify({ url, dns: await dnsDe(new URL(url).hostname), ...r }));
    }
  }

  if (quer('github')) {
    console.log('--- GITHUB ---');
    for (const [rotulo, url] of BUSCA_GH) {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(12000) });
      const j = await r.json().catch(() => ({}));
      const itens = (j.items || []).map(x => ({
        nome: x.full_name, stars: x.stargazers_count, forks: x.forks_count,
        atualizado: x.pushed_at, licenca: x.license && x.license.spdx_id,
        lang: x.language, desc: String(x.description || '').slice(0, 140),
        arquivado: x.archived
      }));
      console.log(JSON.stringify({ rotulo, status: r.status, total: j.total_count, itens }));
    }
  }

  if (quer('placa3')) {
    console.log('--- PLACA3 ---');
    for (const url of PLACA3) {
      const r = await medir(url, { accept: 'text/html,application/json,*/*' });
      console.log(JSON.stringify({ url, dns: await dnsDe(new URL(url).hostname), ...r }));
    }
  }

  if (quer('placa2')) {
    console.log('--- PLACA2 ---');
    for (const [host, url] of PLACA2) {
      const r = await medir(url);
      console.log(JSON.stringify({ host, dns: await dnsDe(host), ...r }));
    }
  }

  if (quer('bitbucket')) {
    console.log('--- BITBUCKET ---');
    for (const u of BITBUCKET) {
      const r = await medir(`https://api.bitbucket.org/2.0/users/${u}`);
      console.log(JSON.stringify({ usuario: u, ...r }));
    }
  }

  if (quer('openalex')) {
    console.log('--- OPENALEX ---');
    const oa = await medir(OPENALEX);
    console.log(JSON.stringify(oa));
  }

  if (!quer('repos')) return;
  console.log('--- REPOS ---');
  for (const [nome, url] of REPOS) {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/vnd.github+json,text/plain,*/*' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow'
    });
    const corpo = await r.text();
    if (nome.endsWith('arvore')) {
      let caminhos = [];
      try { caminhos = (JSON.parse(corpo).tree || []).map(t => t.path); } catch { caminhos = []; }
      console.log(JSON.stringify({ nome, status: r.status, caminhos }));
      continue;
    }
    if (nome === 'placafipy/pypi') {
      let j = {};
      try { j = JSON.parse(corpo); } catch { /* ignora */ }
      const info = j.info || {};
      console.log(JSON.stringify({
        nome, status: r.status,
        versao: info.version,
        licenca: info.license,
        resumo: String(info.summary || '').slice(0, 300),
        classificador: info.classifiers,
        home: info.home_page,
        urls: (info.project_urls || {}),
        arquivos: (j.urls || []).map(u => ({ nome: u.filename, url: u.url }))
      }));
      continue;
    }
    if (nome === 'juniorkrz/repos') {
      let lista = [];
      try { lista = (JSON.parse(corpo) || []).map(r => ({ nome: r.full_name, licenca: r.license && r.license.spdx_id, stars: r.stargazers_count, lang: r.language, desc: String(r.description || '').slice(0, 120) })); } catch { lista = []; }
      console.log(JSON.stringify({ nome, status: r.status, lista }));
      continue;
    }
    const linhas = corpo.match(/https?:\/\/[^\s"'<>)\]]{6,120}/g)?.slice(0, 30) || null;
    const grande = nome.includes('__init__');
    console.log(JSON.stringify({ nome, url, status: r.status, corpo: corpo.slice(0, grande ? 9000 : 2600), urls: linhas }));
  }
}

await main();
