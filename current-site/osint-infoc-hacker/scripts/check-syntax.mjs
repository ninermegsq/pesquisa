// Verificacao de sintaxe de todo o codigo JavaScript do projeto.
//
// Antes a lista vivia no package.json (35 entradas fixas): um arquivo novo
// passava sem nunca ser verificado. Aqui a lista e descoberta no disco, entao
// qualquer .js/.mjs novo em src/, scripts/ ou verification/ entra na
// verificacao sem ninguem precisar lembrar de editar o package.json.
import {readdirSync, existsSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const DIRETORIOS = ['src', 'scripts', 'verification'];
const ARQUIVOS = ['cloudflare-worker.mjs', 'public/app.js'];

const norm = caminho => caminho.split(sep).join('/');

function listar(dir) {
  const base = join(raiz, dir);
  if (!existsSync(base)) return [];
  const achados = [];
  for (const entrada of readdirSync(base, { withFileTypes: true })) {
    const caminho = join(base, entrada.name);
    if (entrada.isDirectory()) achados.push(...listar(norm(relative(raiz, caminho))));
    else if (/\.(mjs|cjs|js)$/.test(entrada.name)) achados.push(norm(relative(raiz, caminho)));
  }
  return achados;
}

const arquivos = [...new Set([...ARQUIVOS, ...DIRETORIOS.flatMap(listar)])]
  .filter(arquivo => existsSync(join(raiz, arquivo)))
  .sort();

const falhas = [];
for (const arquivo of arquivos) {
  const r = spawnSync(process.execPath, ['--check', join(raiz, arquivo)], { encoding: 'utf8' });
  if (r.status !== 0) {
    const stderr = (r.stderr || '').trim();
    falhas.push({ arquivo, erro: stderr.split(/\r?\n/).slice(0, 4).join(' | ') });
  }
}

const resumo = { escopo: 'sintaxe', arquivos: arquivos.length, falhas: falhas.length };
if (falhas.length) {
  console.error(JSON.stringify({ ...resumo, detalhes: falhas }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(resumo));
