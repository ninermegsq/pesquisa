// Verificacao dos artefatos gerados (codegen).
//
// O Worker nao le arquivos no runtime: o manifesto (src/sources/registry.json)
// e as migracoes (migrations/*.sql) precisam virar modulos .mjs.
//
// Este check garante que os arquivos gerados em disco estao em dia com as
// fontes e que a geracao e deterministica (sem data, sem hash de execucao),
// de modo que `npm run build` duas vezes nao produz diff.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  root as ROOT_REGISTRY,
  MANIFESTO,
  GERADO as GERADO_REGISTRY,
  gerarMeta,
  validarManifesto
} from '../scripts/build-registry.mjs';
import {
  root as ROOT_MIGRATIONS,
  GERADO as GERADO_MIGRATIONS,
  gerarModulo,
  listarMigracoes
} from '../scripts/build-migrations.mjs';

// --- registro ---------------------------------------------------------------
const manifesto = JSON.parse(await readFile(path.join(ROOT_REGISTRY, MANIFESTO), 'utf8'));
const metaEsperado = gerarMeta(manifesto);
const metaEmDisco = await readFile(path.join(ROOT_REGISTRY, GERADO_REGISTRY), 'utf8');
assert.equal(
  metaEmDisco,
  metaEsperado,
  `${GERADO_REGISTRY} desatualizado: rode "npm run build" (ou "npm run build:registry").`
);
assert.equal(gerarMeta(manifesto), metaEsperado, 'a geracao do registro precisa ser deterministica');

// --- migracoes --------------------------------------------------------------
const migracoes = await listarMigracoes();
const moduloEsperado = gerarModulo(migracoes);
const moduloEmDisco = await readFile(path.join(ROOT_MIGRATIONS, GERADO_MIGRATIONS), 'utf8');
assert.equal(
  moduloEmDisco,
  moduloEsperado,
  `${GERADO_MIGRATIONS} desatualizado: rode "npm run build" (ou "npm run build:migrations").`
);
assert.equal(
  gerarModulo(await listarMigracoes()),
  moduloEsperado,
  'a geracao das migracoes precisa ser deterministica'
);

// --- o manifesto passa na validacao -----------------------------------------
const valido = validarManifesto(manifesto);
assert.equal(valido.fontes.length, 27);
assert.equal(valido.fontes.filter(f => f.tipos.includes('email')).length, 13);
assert.equal(valido.fontes.filter(f => f.chave === true).length, 0);

// --- o validador rejeita manifestos quebrados -------------------------------
const clonar = () => JSON.parse(JSON.stringify(manifesto));

const comChave = clonar();
comChave.fontes[0].chave = true;
assert.throws(() => validarManifesto(comChave), /chave do visitante/);

const duplicado = clonar();
duplicado.fontes[1].id = duplicado.fontes[0].id;
assert.throws(() => validarManifesto(duplicado), /duplicado/);

const tipoInvalido = clonar();
tipoInvalido.fontes[0].tipos = ['banana'];
assert.throws(() => validarManifesto(tipoInvalido), /tipo invalido/);

const credencialInvalida = clonar();
credencialInvalida.fontes[0].requer = { tipo: 'chave', env: 'minusculo' };
assert.throws(() => validarManifesto(credencialInvalida), /requer.env invalido/);

const custoInvalido = clonar();
custoInvalido.fontes[0].custo = -1;
assert.throws(() => validarManifesto(custoInvalido), /custo invalido/);

console.log(JSON.stringify({
  ok: true,
  fontes: valido.fontes.length,
  digest: metaEsperado.match(/digest: "([a-f0-9]+)"/)?.[1] || null,
  migracoes: migracoes.length,
  deterministico: true
}));
