// Gerador de src/lib/migrations.mjs a partir de migrations/*.sql.
//
// O Durable Object nao le arquivos no runtime, entao o SQL precisa chegar no
// bundle. Os arquivos .sql continuam sendo a fonte da verdade (revisaveis,
// aplicaveis fora do Workers) e este script os empacota em um modulo.
//
// O conteudo gerado e deterministico: sem data, ordem estavel (nome do
// arquivo) e sem espaco superfluo. Rodar duas vezes nao muda nada.
//
// Uso: node scripts/build-migrations.mjs

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PASTA = 'migrations';
export const GERADO = 'src/lib/migrations.mjs';

const NOME_MIGRACAO = /^(\d{4})_([a-z0-9_]+)\.sql$/;

// Le as migracoes da pasta e devolve a lista ordenada por versao.
export async function listarMigracoes(base = root) {
  const pasta = path.join(base, PASTA);
  const arquivos = (await readdir(pasta)).filter(nome => NOME_MIGRACAO.test(nome)).sort();
  if (!arquivos.length) throw new Error(`nenhuma migracao encontrada em ${PASTA}/`);
  const migracoes = [];
  for (const nome of arquivos) {
    const [, versaoTexto, slug] = nome.match(NOME_MIGRACAO);
    const versao = Number(versaoTexto);
    if (migracoes.some(m => m.versao === versao)) throw new Error(`versao de migracao duplicada: ${versao}`);
    const sql = await readFile(path.join(pasta, nome), 'utf8');
    if (!sql.trim()) throw new Error(`migracao vazia: ${nome}`);
    migracoes.push({ versao, nome, slug, sql: sql.trim() });
  }
  migracoes.sort((a, b) => a.versao - b.versao);
  for (let i = 0; i < migracoes.length; i++) {
    if (migracoes[i].versao !== i + 1) throw new Error(`numeracao de migracao continua esperada: ${migracoes[i].nome}`);
  }
  return migracoes;
}

// Conteudo deterministico do modulo gerado.
export function gerarModulo(migracoes) {
  const linhas = [];
  linhas.push('// GERADO por scripts/build-migrations.mjs a partir de migrations/*.sql.');
  linhas.push('// Nao edite a mao: edite o arquivo .sql e rode `npm run build`.');
  linhas.push('// Conteudo deterministico: sem data, para que o build seja idempotente.');
  linhas.push('');
  linhas.push('export const MIGRACOES = Object.freeze([');
  for (const migracao of migracoes) {
    linhas.push('  Object.freeze({');
    linhas.push(`    versao: ${migracao.versao},`);
    linhas.push(`    nome: ${JSON.stringify(migracao.nome)},`);
    linhas.push(`    slug: ${JSON.stringify(migracao.slug)},`);
    linhas.push(`    sql: ${JSON.stringify(migracao.sql)}`);
    linhas.push('  }),');
  }
  linhas.push(']);');
  linhas.push('');
  return linhas.join('\n');
}

export async function main() {
  const migracoes = await listarMigracoes();
  const conteudo = gerarModulo(migracoes);
  const destino = path.join(root, GERADO);
  let anterior = null;
  try { anterior = await readFile(destino, 'utf8'); } catch { /* ainda nao gerado */ }
  if (anterior === conteudo) {
    console.log(`migracoes: ${GERADO} ja esta atualizado (${migracoes.length} migracoes).`);
    return conteudo;
  }
  await writeFile(destino, conteudo);
  console.log(`migracoes: ${GERADO} gerado (${migracoes.length} migracoes).`);
  return conteudo;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
