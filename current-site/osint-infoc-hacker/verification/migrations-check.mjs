// Verificacao das migracoes do Durable Object.
//
// Duas partes:
//   1. o modulo gerado (src/lib/migrations.mjs) tem o formato e o conteudo
//      esperado das migracoes em migrations/*.sql;
//   2. aplicarMigracoes() aplica em ordem, uma vez cada, e nao repete.
//
// Escopo: LOCAL ONLY. O executor SQL e de mentira: nada de Durable Object.

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aplicarMigracoes, TABELA_META } from '../src/lib/sql-migrations.mjs';
import { MIGRACOES } from '../src/lib/migrations.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- executor sql de mentira ------------------------------------------------
function criarSql() {
  const comandos = [];
  const registradas = new Map();
  const sql = {
    exec(comando, ...params) {
      comandos.push({ comando, params });
      if (/^\s*SELECT\s+versao\s+FROM/i.test(comando)) {
        const versao = Number(params[0]);
        return { one: () => (registradas.has(versao) ? { versao } : null) };
      }
      if (/^\s*INSERT OR REPLACE INTO\s+schema_meta/i.test(comando)) {
        registradas.set(Number(params[0]), { versao: Number(params[0]), nome: String(params[1]) });
        return {};
      }
      return {};
    }
  };
  return { sql, comandos, registradas };
}

// --- formato do modulo gerado ----------------------------------------------
assert.ok(Array.isArray(MIGRACOES) && MIGRACOES.length > 0, 'nenhuma migracao gerada');
assert.deepEqual(MIGRACOES.map(m => m.versao), MIGRACOES.map((_, i) => i + 1), 'numeracao de migracao deve ser continua');
assert.deepEqual(MIGRACOES.map(m => m.nome), ['0001_token_guard.sql', '0002_scan_jobs.sql']);
const arquivosSql = (await readdir(path.join(raiz, 'migrations'))).filter(nome => nome.endsWith('.sql')).sort();
assert.deepEqual(MIGRACOES.map(m => m.nome), arquivosSql, 'o modulo gerado tem que refletir as migracoes da pasta migrations/');
for (const migracao of MIGRACOES) {
  assert.ok(typeof migracao.sql === 'string' && migracao.sql.trim().length > 0, `migracao sem sql: ${migracao.nome}`);
  assert.ok(typeof migracao.slug === 'string' && migracao.slug.length > 0, `migracao sem slug: ${migracao.nome}`);
}

const sqlTexto = MIGRACOES.map(m => m.sql).join('\n');
for (const tabela of [TABELA_META, 'used', 'jobs', 'job_fontes']) {
  assert.ok(sqlTexto.includes(tabela), `tabela ausente nas migracoes: ${tabela}`);
}

// Nada de alvo, e-mail ou IP no schema (comentarios fora da conta).
const semComentarios = sqlTexto
  .split('\n')
  .filter(linha => !linha.trim().startsWith('--'))
  .join('\n');
assert.ok(!/\balvo\b|\be-?mail\b|\bip\b/i.test(semComentarios), 'as migracoes nao podem guardar alvo, e-mail ou IP');

// --- aplicacao --------------------------------------------------------------
const { sql, comandos, registradas } = criarSql();
const aplicadas = aplicarMigracoes(sql, MIGRACOES, 1000);
assert.deepEqual(aplicadas, [1, 2], 'a primeira execucao tem que aplicar as migracoes');
assert.deepEqual([...registradas.keys()], [1, 2]);
assert.ok(
  comandos.some(c => new RegExp(`CREATE TABLE IF NOT EXISTS ${TABELA_META}`, 'i').test(c.comando)),
  'a tabela de versionamento tem que ser criada'
);

// Ordem: a migracao 1 antes da 2.
const insercoes = comandos.filter(c => /^\s*INSERT OR REPLACE INTO\s+schema_meta/i.test(c.comando));
assert.deepEqual(insercoes.map(c => Number(c.params[0])), [1, 2], 'as migracoes tem que ser aplicadas em ordem');
assert.equal(Number(insercoes[0].params[2]), 1000, 'a data de aplicacao tem que ser registrada');

// Idempotencia: a segunda execucao nao aplica nada.
const repetidas = aplicarMigracoes(sql, MIGRACOES, 2000);
assert.deepEqual(repetidas, [], 'a segunda execucao nao pode reaplicar migracao');

// A partir de uma migracao nova, so a nova e aplicada.
const parcial = aplicarMigracoes(sql, [...MIGRACOES, { versao: 3, nome: '0003_teste.sql', slug: 'teste', sql: 'CREATE TABLE IF NOT EXISTS teste (id TEXT);' }], 3000);
assert.deepEqual(parcial, [3], 'apenas a migracao nova pode ser aplicada');

// --- entradas invalidas ----------------------------------------------------
assert.throws(() => aplicarMigracoes(null, MIGRACOES), /sql invalido/);
assert.throws(() => aplicarMigracoes({}, MIGRACOES), /sql invalido/);
assert.throws(() => aplicarMigracoes(sql, []), /nenhuma migracao/);
assert.throws(() => aplicarMigracoes(sql, [{ versao: 0, nome: 'x.sql', sql: 'SELECT 1;' }]), /versao/);

console.log(JSON.stringify({
  ok: true,
  migracoes: MIGRACOES.length,
  nomes: MIGRACOES.map(m => m.nome),
  aplicadas: aplicadas.length,
  idempotente: true
}));
