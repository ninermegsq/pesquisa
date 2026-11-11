// Sondagem real com uma credencial fornecida na execucao.
//
//   node verification/probe-live-credencial.mjs <NOME_DA_VARIAVEL> <valor> [probe]
//
// Por que existe: as credenciais do operador (GITHUB_TOKEN, DATAJUD_API_KEY,
// ...) nunca ficam no repositorio. Para medir o caminho real de uma fonte
// que exige credencial, este script recebe o valor pela linha de comando,
// coloca a variavel no ambiente do processo de sondagem e chama o probe
// indicado (ou a sondagem completa de todas as fontes).
//
// Regras:
//   - o valor NAO e gravado em arquivo do projeto;
//   - o valor NAO e impresso no relatorio (so o nome da variavel e o
//     comprimento aparecem);
//   - e uma ferramenta local: nao faz parte de `npm test`.
//
// Escopo: REDE REAL. Consulta os provedores externos de verdade.

const nomeVar = process.argv[2] || '';
const valor = process.argv[3] || '';
const probe = process.argv[4] || './live-source-probe.mjs';

if (!nomeVar || !valor) {
  console.error('uso: node verification/probe-live-credencial.mjs <NOME_DA_VARIAVEL> <valor> [probe]');
  process.exit(2);
}

process.env[nomeVar] = valor;
console.error(`[probe] variavel ${nomeVar} definida no ambiente (${valor.length} caracteres); o valor nao sera impresso.`);

await import(probe);
