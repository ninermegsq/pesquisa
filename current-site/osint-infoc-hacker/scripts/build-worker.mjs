import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
const workerPath = path.join(root, 'cloudflare-worker.mjs');
let worker = await readFile(workerPath, 'utf8');
// Fontes opcionais: quando o arquivo nao existe em public/, a constante do
// Worker e preservada (a versao publicada continua sendo a fonte de verdade).
const SOURCES = [['HTML', 'public/index.html'], ['APP_JS', 'public/app.js'], ['THANKS', 'public/obrigado.html'], ['FAVICON', 'public/favicon.svg'], ['ROBOTS', 'public/robots.txt'], ['SITEMAP', 'public/sitemap.xml'], ['SECURITY', 'public/.well-known/security.txt']];
let injected = 0;
for (const [name, file] of SOURCES) {
  const pattern = new RegExp('^const ' + name + ' = .*;$', 'm');
  if (!pattern.test(worker)) throw new Error('Worker constant missing: ' + name);
  let content;
  try { content = await read(file); } catch { console.warn('fonte ausente, constante preservada: ' + file); continue; }
  worker = worker.replace(pattern, 'const ' + name + ' = ' + JSON.stringify(content) + ';');
  injected++;
}
try {
  const og = (await readFile(path.join(root, 'public/og.png'))).toString('base64');
  if (/^const OG_PNG_BASE64 = .*;$/m.test(worker)) worker = worker.replace(/^const OG_PNG_BASE64 = .*;$/m, 'const OG_PNG_BASE64 = ' + JSON.stringify(og) + ';');
  injected++;
} catch { console.warn('fonte ausente, constante preservada: public/og.png'); }
await writeFile(workerPath, worker);
console.log('worker atualizado; fontes injetadas: ' + injected + '/' + (SOURCES.length + 1));
