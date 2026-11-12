// Verificacao do catalogo operacional das fontes.
//
// O painel admin tem duas fontes de verdade para os limites de cada fonte:
// o catalogo gerado (runtime do Worker) e as linhas que o operador gravou no
// banco. A semente `db/migrations/0002_catalogo.sql` e o formato que o
// Postgres recebe, entao ela precisa ser SQL de verdade.
//
// Esta verificacao existe porque dois bugs passaram pelo build e so apareceram
// na hora de aplicar a semente no banco:
//   1. o array de tipos saia no formato JavaScript (`['email']`), invalido em
//      SQL: o banco recusava a semente com erro de sintaxe;
//   2. uma linha tinha um valor a mais que as colunas: o banco recusava a
//      semente com "VALUES lists must all be the same length".
// Nenhum dos dois aparecia no build, porque o build so conferia que o arquivo
// tinha sido gerado, nao que ele era aplicavel.
//
// O que ela prova:
//   1. o modulo gerado e a semente SQL estao em dia com o manifesto e os
//      limites (rode "npm run build:catalog" se nao estiver);
//   2. a geracao e deterministica (rodar duas vezes nao produz diff);
//   3. cada linha da semente tem exatamente 15 valores (o numero de colunas),
//      na ordem do manifesto, com o array de tipos em `ARRAY[...]`;
//   4. o upsert e idempotente (ON CONFLICT DO UPDATE).
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  root,
  MANIFESTO,
  LIMITES,
  GERADO,
  SQL,
  montarCatalogo,
  gerarModulo,
  gerarSql
} from '../scripts/build-catalog.mjs';

const manifesto = JSON.parse(await readFile(path.join(root, MANIFESTO), 'utf8'));
const limites = JSON.parse(await readFile(path.join(root, LIMITES), 'utf8'));
const catalogo = montarCatalogo(manifesto, limites);

// --- 1. os artefatos em disco estao em dia ----------------------------------
const moduloEsperado = gerarModulo(catalogo);
const moduloEmDisco = await readFile(path.join(root, GERADO), 'utf8');
assert.equal(
  moduloEmDisco,
  moduloEsperado,
  `${GERADO} desatualizado: rode "npm run build:catalog".`
);

const sqlEsperado = gerarSql(catalogo);
const sqlEmDisco = await readFile(path.join(root, SQL), 'utf8');
assert.equal(
  sqlEmDisco,
  sqlEsperado,
  `${SQL} desatualizado: rode "npm run build:catalog".`
);

// --- 2. a geracao e deterministica ------------------------------------------
assert.equal(
  gerarSql(montarCatalogo(manifesto, limites)),
  sqlEsperado,
  'a geracao da semente precisa ser deterministica'
);
assert.equal(
  gerarModulo(montarCatalogo(manifesto, limites)),
  moduloEsperado,
  'a geracao do modulo precisa ser deterministica'
);

// --- 3. a semente e aplicavel no Postgres ----------------------------------
const COLUNAS = 15;

// Conta os valores de uma linha do VALUES ignorando virgulas dentro de
// texto ('...') e dentro de ARRAY[...]. A linha ja vem com o parenteses
// externo, entao as virgulas que separam valores sao as de profundidade 1.
function contarValores(linha) {
  let emTexto = false;
  let profundidade = 0;
  let valores = 1;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (emTexto) {
      if (c === "'") {
        if (linha[i + 1] === "'") { i++; continue; }
        emTexto = false;
      }
      continue;
    }
    if (c === "'") { emTexto = true; continue; }
    if (c === '(' || c === '[') { profundidade++; continue; }
    if (c === ')' || c === ']') { profundidade--; continue; }
    if (c === ',' && profundidade === 1) valores++;
  }
  return valores;
}

const linhas = sqlEmDisco.split('\n').filter(linha => linha.startsWith('  ('));
assert.equal(
  linhas.length,
  manifesto.fontes.length,
  `a semente tem ${linhas.length} linhas e o manifesto tem ${manifesto.fontes.length} fontes`
);

const quebradas = [];
linhas.forEach((linha, indice) => {
  const id = (/^  \('([^']*)'/.exec(linha) || [])[1];
  const esperado = manifesto.fontes[indice]?.id;
  if (id !== esperado) {
    quebradas.push(`linha ${indice + 1}: id "${id}" fora de ordem (esperado "${esperado}")`);
    return;
  }
  const valores = contarValores(linha);
  if (valores !== COLUNAS) {
    quebradas.push(`linha ${indice + 1} (${id}): ${valores} valores para ${COLUNAS} colunas`);
    return;
  }
  if (!/^  \('[^']*', '[^']*', ARRAY\[/.test(linha)) {
    quebradas.push(`linha ${indice + 1} (${id}): tipos fora do formato ARRAY[...] do Postgres`);
  }
});
assert.equal(
  quebradas.length,
  0,
  `a semente nao e aplicavel no Postgres:\n  - ${quebradas.join('\n  - ')}`
);

// --- 4. a semente e idempotente ---------------------------------------------
assert.ok(
  /ON CONFLICT \(id\) DO UPDATE/.test(sqlEmDisco),
  'a semente precisa ser idempotente (ON CONFLICT DO UPDATE)'
);
assert.ok(
  !/,\s*\[\s*'/.test(sqlEmDisco),
  'a semente nao pode usar array no formato JavaScript (use ARRAY[...])'
);

// --- 5. o catalogo do runtime cobre as 32 fontes -----------------------------
assert.equal(catalogo.fontes.length, 32);
assert.ok(
  catalogo.fontes.every(f => Array.isArray(f.tipos) && f.tipos.length > 0),
  'toda fonte precisa declarar ao menos um tipo'
);
assert.ok(
  catalogo.fontes.every(f => f.explicacoes && typeof f.explicacoes === 'object'),
  'toda fonte precisa ter explicacoes de falha'
);

console.log(
  JSON.stringify({
    ok: true,
    fontes: catalogo.fontes.length,
    colunas: COLUNAS,
    linhas: linhas.length,
    com_proxy: catalogo.fontes.filter(f => f.usa_proxy).length,
    deterministico: true
  })
);
