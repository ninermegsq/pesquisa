// Mantem os dois public/mapa.js em sincronia.
//
// O arquivo canonico e current-site/osint-infoc-hacker/public/mapa.js (o que
// o Worker e a previa local servem). A variante Netlify usa o mesmo codigo
// com um cabecalho proprio, que explica o contrato legado (availability) e
// de onde vem a lista `fontes`.
//
// Uso: node scripts/unificar-mapa.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..', '..');
const canonico = path.join(raiz, 'current-site', 'osint-infoc-hacker', 'public', 'mapa.js');
const netlify = path.join(raiz, 'osint-infoc-hacker', 'public', 'mapa.js');

const CABECALHO_NETLIFY = `/* Mapa de conexoes do scanner OSINT.
   Sem dependencias externas (o projeto nao tem bundler nem npm): o mapa e
   desenhado em SVG puro a partir das fontes que o ultimo scan consultou.
   Cada fonte vira um no; o arco ate o no mostra o caminho percorrido e a
   cor mostra o resultado: brasa (#e6a274) quando a fonte respondeu, vermelho
   (#f87171) quando falhou. A paleta e a mesma do site (creme sobre #050505)
   para nao abrir divergencia visual.

   Copia identica de current-site/osint-infoc-hacker/public/mapa.js.
   O pacote Netlify monta a lista de fontes consultadas a partir do contrato
   legado (availability) e entrega o mesmo objeto \`fontes\` para o mapa. */`;

// Separa o cabecalho do corpo: o corpo comeca em "(function(){".
function separar(codigo) {
  const i = codigo.indexOf('(function(){');
  if (i < 0) throw new Error('mapa.js sem o IIFE esperado');
  return { cabecalho: codigo.slice(0, i), corpo: codigo.slice(i) };
}

const fonte = separar(readFileSync(canonico, 'utf8'));
writeFileSync(netlify, CABECALHO_NETLIFY + fonte.corpo);
console.log(JSON.stringify({
  copiado: path.relative(raiz, netlify),
  de: path.relative(raiz, canonico),
  bytes: Buffer.byteLength(CABECALHO_NETLIFY + fonte.corpo)
}));
