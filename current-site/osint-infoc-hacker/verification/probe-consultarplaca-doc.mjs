// Le a documentacao publica da API Consultar Placa para conhecer o contrato
// real de resposta (campos, formato, erros) antes de escrever o parser.
//
// Uso: node verification/probe-consultarplaca-doc.mjs [limite] [paginas]
//   limite  caracteres impressos por pagina (padrao 6000)
//   paginas indices das paginas a ler, separados por virgula (padrao todas)
const PAGINAS = [
  'https://docs.consultarplaca.com.br/llms.txt',
  'https://docs.consultarplaca.com.br/api-consultar-placa/padroes-de-resposta.md',
  'https://docs.consultarplaca.com.br/api-consultar-placa/autenticacao-e-teste.md',
  'https://docs.consultarplaca.com.br/api-consultar-placa/api-de-historico-veicular-introducao.md',
  'https://docs.consultarplaca.com.br/api-consultar-placa/preco.md',
  'https://docs.consultarplaca.com.br/consultas/consultar-placa.md'
];

const args = process.argv.slice(2);
const LIMITE = Number(args[0]) > 0 ? Number(args[0]) : 6000;
const SELECIONADAS = args[1]
  ? args[1].split(',').map(n => Number(n.trim())).filter(n => Number.isInteger(n) && n >= 0 && n < PAGINAS.length)
  : PAGINAS.map((_, i) => i);

for (const indice of SELECIONADAS) {
  const url = PAGINAS[indice];
  try {
    const r = await fetch(url, { headers: { accept: 'text/plain,text/markdown,*/*' } });
    const t = await r.text();
    console.log('\n===== [' + indice + '] ' + url + ' -> HTTP ' + r.status + ' (' + t.length + ' bytes) =====');
    console.log(t.slice(0, LIMITE));
  } catch (e) {
    console.log('\n===== [' + indice + '] ' + url + ' -> ERRO ' + (e && e.message) + ' =====');
  }
}
