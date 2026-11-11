// Le a documentacao publica da API DataJud (CNJ) sem usar a cota de busca.
//
//   node verification/probe-datajud-doc.mjs
//
// Escopo: REDE REAL, mas apenas paginas de documentacao (nao consome a cota
// de consultas do indice). Serve para conferir o formato de consulta
// recomendado pelo CNJ, o cabecalho de autenticacao e o formato do
// documento, sem depender de suposicao.

const LIMITE = 6000;

// A documentacao da API tambem exige autenticacao. A credencial vem do
// ambiente do processo (nunca de um arquivo) e NAO e impressa.
const chave = String(process.env.DATAJUD_API_KEY || '').trim();
const cabecalhos = chave ? { authorization: `ApiKey ${chave}`, accept: 'text/html,application/json' } : { accept: 'text/html,application/json' };

const paginas = [
  { nome: 'raiz da API', url: 'https://api-publica.datajud.cnj.jus.br/' },
  { nome: 'documentacao', url: 'https://api-publica.datajud.cnj.jus.br/docs' },
  { nome: 'indexacao', url: 'https://api-publica.datajud.cnj.jus.br/indexacao' },
  { nome: 'exemplo de consulta', url: 'https://api-publica.datajud.cnj.jus.br/exemplo' }
];

const textoDe = html => String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n\s*\n+/g, '\n')
  .trim();

const relatorio = [];
for (const p of paginas) {
  const inicio = Date.now();
  try {
    const r = await fetch(p.url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: cabecalhos });
    const html = await r.text();
    const texto = textoDe(html);
    relatorio.push({
      nome: p.nome,
      url: p.url,
      status: r.status,
      ms: Date.now() - inicio,
      trecho: texto.slice(0, LIMITE)
    });
  } catch (e) {
    relatorio.push({ nome: p.nome, url: p.url, status: 'erro', ms: Date.now() - inicio, erro: String(e?.message || e).slice(0, 160) });
  }
}

console.log(JSON.stringify(relatorio, null, 2));
