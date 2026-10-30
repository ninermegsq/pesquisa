import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
const workerPath = path.join(root, 'cloudflare-worker.mjs');
let worker = await readFile(workerPath, 'utf8');
for (const [name, file] of [['HTML', 'public/index.html'], ['APP_JS', 'public/app.js'], ['THANKS', 'public/obrigado.html'], ['FAVICON', 'public/favicon.svg'], ['ROBOTS', 'public/robots.txt'], ['SITEMAP', 'public/sitemap.xml'], ['SECURITY', 'public/.well-known/security.txt']]) {
  const pattern = new RegExp('^const ' + name + ' = .*;$', 'm');
  if (!pattern.test(worker)) throw new Error('Worker constant missing: ' + name);
  worker = worker.replace(pattern, 'const ' + name + ' = ' + JSON.stringify(await read(file)) + ';');
}
await writeFile(workerPath, worker);
