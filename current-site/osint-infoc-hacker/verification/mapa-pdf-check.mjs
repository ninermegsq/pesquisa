import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Confere o mapa de conexoes (public/mapa.js) e o relatorio em PDF
// (public/relatorio.js) sem navegador: os dois scripts sao carregados em um
// contexto isolado com o DOM minimo que eles tocam.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede, nenhum arquivo alterado.

const aqui = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(aqui, '..');

function carregar(arquivo) {
  const codigo = readFileSync(path.join(SITE, 'public', arquivo), 'utf8');
  const sandbox = {
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: arquivo });
  return sandbox;
}

function elementoFake() {
  return { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
}

// ---- mapa de conexoes -------------------------------------------------
const mapa = carregar('mapa.js');
assert.ok(mapa.window.OSINTMapa, 'mapa.js nao exportou OSINTMapa');
assert.equal(typeof mapa.window.OSINTMapa.render, 'function');

const el = elementoFake();
mapa.window.OSINTMapa.render(el, {
  pais: 'BR',
  fontes: [
    { id: 'gravatar', status: 'ok', ms: 120, provenance: 'https://gravatar.com', dados: { avatar: 'x' } },
    { id: 'github', status: 'sem_token', erro: 'sem token: GITHUB_TOKEN', ms: 4 },
    { id: 'ddd', status: 'ok', ms: 1 }
  ]
});
const svg = el.innerHTML;
assert.ok(svg.includes('MAPA DE CONEXOES'), 'cabecalho do mapa ausente');
assert.ok(svg.includes('data-nodo="gravatar"'), 'no da fonte que respondeu ausente');
assert.ok(svg.includes('data-nodo="github"'), 'no da fonte que falhou ausente');
assert.ok(svg.includes('<b>2</b> ok'), 'contagem de fontes que responderam errada');
assert.ok(svg.includes('<b class="mapa-falhas-n">1</b> falha'), 'contagem de falhas errada');
assert.ok(svg.includes('class="mapa-arco ok"'), 'arco de fonte que respondeu ausente');
assert.ok(svg.includes('class="mapa-arco falha"'), 'arco de fonte que falhou ausente');
assert.ok(svg.includes('class="mapa-halo"'), 'halo de falha ausente');

const noGithub = svg.match(/data-nodo="github"[\s\S]*?<\/g>/);
assert.ok(noGithub, 'grupo do no que falhou ausente');
assert.ok(noGithub[0].includes('#f87171'), 'no que falhou nao ficou vermelho');
const noGravatar = svg.match(/data-nodo="gravatar"[\s\S]*?<\/g>/);
assert.ok(noGravatar[0].includes('#e6a274'), 'no que respondeu nao ficou na cor de sucesso');

const terra = svg.match(/<g class="mapa-terra">([\s\S]*?)<\/g>/);
assert.ok(terra, 'malha de pontos do mapa ausente');
assert.ok((terra[1].match(/<circle/g) || []).length > 400, 'malha de pontos rasa demais');

// Fonte local nao tem host unico: fica em volta da origem e nao ganha arco.
const soLocal = elementoFake();
mapa.window.OSINTMapa.render(soLocal, { pais: 'BR', fontes: [{ id: 'ddd', status: 'ok', ms: 1 }] });
assert.ok(!soLocal.innerHTML.includes('mapa-arco-'), 'fonte local nao deveria ter arco');
assert.ok(soLocal.innerHTML.includes('data-nodo="ddd"'), 'fonte local ausente do mapa');

// Scan sem fontes nao pode quebrar o render.
const vazio = elementoFake();
mapa.window.OSINTMapa.render(vazio, { pais: 'BR', fontes: [] });
assert.ok(vazio.innerHTML.includes('MAPA DE CONEXOES'), 'mapa vazio sem cabecalho');

// Clicar no no abre o detalhe da fonte correspondente.
const alvo = { open: false, parentElement: null, scrollIntoView() { alvo.scroll = true; }, classList: { add() {}, remove() {} } };
alvo.parentElement = { tagName: 'DETAILS', open: false };
mapa.document.querySelector = sel => (sel === '[data-fonte="github"]' ? alvo : null);
mapa.window.OSINTMapa.abrirFonte('github');
assert.equal(alvo.open, true, 'abrirFonte nao abriu o detalhe');
assert.equal(alvo.parentElement.open, true, 'abrirFonte nao abriu o acordeao pai');
assert.equal(alvo.scroll, true, 'abrirFonte nao rolou ate o detalhe');

// ---- relatorio em PDF --------------------------------------------------
const rel = carregar('relatorio.js');
assert.ok(rel.window.OSINTRelatorio, 'relatorio.js nao exportou OSINTRelatorio');
assert.equal(typeof rel.window.OSINTRelatorio.pdf, 'function');

const dados = {
  alvo: 'teste@exemplo.com',
  gerado_em: '2026-11-20T12:00:00.000Z',
  fontes: [
    { id: 'gravatar', status: 'ok', ms: 120, provenance: 'https://gravatar.com', dados: { avatar: 'https://gravatar.com/avatar/abc' } },
    { id: 'github', status: 'sem_token', erro: 'sem token: GITHUB_TOKEN', ms: 4 },
    { id: 'dns', status: 'ok', ms: 210, dados: { mx: 'mx.exemplo.com', spf: 'presente' } }
  ],
  score: { valor: 42, nivel: 'MEDIO', parcial: true, motivos: ['breach identificado', 'dmarc ausente'] },
  meta: { job_id: 'job-123', planejadas: 3, executadas: 3, subrequests: 24, pais: 'BR' }
};
const bytes = rel.window.OSINTRelatorio.pdf(dados, 'teste@exemplo.com');
assert.ok(bytes && typeof bytes.length === 'number', 'pdf nao devolveu bytes');
const pdf = Buffer.from(Array.from(bytes)).toString('latin1');
assert.ok(pdf.startsWith('%PDF-1.4'), 'cabecalho PDF invalido');
assert.ok(pdf.trimEnd().endsWith('%%EOF'), 'PDF sem %%EOF');
assert.ok(pdf.includes('/Type /Catalog'), 'catalogo do PDF ausente');
assert.ok(pdf.includes('teste@exemplo.com'), 'alvo ausente do PDF');
assert.ok(pdf.includes('sem token: GITHUB_TOKEN'), 'erro da fonte ausente do PDF');
assert.ok(pdf.includes('GRAVATAR'), 'titulo da fonte ausente do PDF');
assert.ok(pdf.includes('MX EXEMPLO.COM') || pdf.includes('mx.exemplo.com'), 'achado da fonte ausente do PDF');
assert.ok(pdf.includes('pagina 1/1'), 'rodape com paginacao ausente');

// Tabela xref coerente: cada offset aponta para o objeto certo.
const xref = pdf.match(/startxref\n(\d+)\n%%EOF/);
assert.ok(xref, 'startxref ausente');
const pos = Number(xref[1]);
assert.equal(pdf.slice(pos, pos + 4), 'xref', 'startxref nao aponta para a tabela xref');
const linhas = pdf.slice(pos).split('\n');
const objetos = Number(linhas[1].split(' ')[1]);
assert.equal(objetos, Number(pdf.match(/\/Size (\d+)/)[1]), 'tamanho do xref divergente do trailer');
for (let i = 1; i < objetos; i++) {
  const off = Number(linhas[2 + i].slice(0, 10));
  assert.equal(pdf.slice(off, off + String(i).length + 6), i + ' 0 obj', 'offset do objeto ' + i + ' invalido');
}
const refs = pdf.match(/\/Kids \[([^\]]*)\]/)[1].trim().split(/\s+/).filter(Boolean);
const paginas = refs.length / 3;
assert.ok(paginas >= 1 && refs.every((r, i) => (i % 3 === 1 ? r === '0' : i % 3 === 2 ? r === 'R' : /^[0-9]+$/.test(r))), 'lista de paginas malformada');
assert.ok(pdf.includes('/Count ' + paginas), 'Count de paginas divergente do Kids');

// A cor do indice de expoicao muda conforme a faixa do score.
function corDoScore(texto, valor) {
  const alvo = '(' + valor + ') Tj';
  for (const linha of texto.split('\n')) {
    if (linha.includes('/F2 36 Tf') && linha.includes(alvo)) {
      const m = linha.match(/^([0-9.]+ [0-9.]+ [0-9.]+) rg/);
      return m ? m[1] : null;
    }
  }
  return null;
}
assert.equal(corDoScore(pdf, 42), '0.96 0.62 0.04', 'score medio deveria sair em ambar');
const alto = Buffer.from(Array.from(rel.window.OSINTRelatorio.pdf({ ...dados, score: { valor: 80, nivel: 'CRITICO', motivos: [] } }, 'teste@exemplo.com'))).toString('latin1');
assert.equal(corDoScore(alto, 80), '0.97 0.44 0.44', 'score alto deveria sair em vermelho');
const baixo = Buffer.from(Array.from(rel.window.OSINTRelatorio.pdf({ ...dados, score: { valor: 10, nivel: 'BAIXO', motivos: [] } }, 'teste@exemplo.com'))).toString('latin1');
assert.equal(corDoScore(baixo, 10), '0.29 0.87 0.5', 'score baixo deveria sair em verde');

console.log(JSON.stringify({
  ok: true,
  escopo: 'LOCAL ONLY; mapa e PDF conferidos sem navegador',
  nos: 3,
  falhas: 1,
  paginas: paginas,
  bytes: bytes.length
}));
