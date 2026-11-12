// Verificacao ao vivo do site publicado: confere se os assets novos
// (mapa.js, relatorio.js) e o bloco do mapa chegam no Worker em producao.
// Escopo: apenas leitura (GET) em rotas publicas.
const urls = [
  'https://ostnt.online/',
  'https://ostnt.online/mapa.js',
  'https://ostnt.online/relatorio.js',
  'https://ostnt.online/app.js'
];
const saida = [];
for (const url of urls) {
  try {
    const resposta = await fetch(url, { headers: { 'user-agent': 'ostnt.online scanner (+https://ostnt.online)' } });
    const corpo = await resposta.text();
    saida.push({
      url,
      status: resposta.status,
      bytes: corpo.length,
      mapa: corpo.includes('OSINTMapa'),
      relatorio: corpo.includes('OSINTRelatorio'),
      scriptMapa: corpo.includes('/mapa.js'),
      // O layout novo do mapa: saidas separadas em leque com faixa lateral.
      layout: corpo.includes('afastaCurvas') && corpo.includes('SEP_LEQUE'),
      // O headline novo da capa.
      hero: corpo.includes('Mapeie a'),
      dataFonte: resposta.headers.get('content-type')
    });
  } catch (erro) {
    saida.push({ url, erro: String(erro?.message || erro) });
  }
}
const mapa = saida.find(s => s.url.endsWith('/mapa.js'));
console.log(JSON.stringify({
  ok: saida.every(s => s.status === 200) && !!(mapa && mapa.layout),
  rotas: saida
}, null, 2));
