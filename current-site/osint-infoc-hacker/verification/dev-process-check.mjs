// Sobe `node scripts/dev-server.mjs` como processo filho (o mesmo caminho de
// `npm run dev`), espera o aviso de "Server running", consulta a interface e
// encerra o processo. Verifica LOCAL ONLY, sem rede externa.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = 4321;
const child = spawn(process.execPath, ['scripts/dev-server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

const waitForServer = async timeoutMs => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (output.includes('Server running on')) return true;
    if (child.exitCode !== null) return false;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return false;
};

try {
  const started = await waitForServer(15000);
  assert.ok(started, `servidor nao subiu a tempo. Saida:\n${output}`);

  const base = `http://127.0.0.1:${port}`;
  const index = await fetch(`${base}/`, { headers: { origin: base } });
  const html = await index.text();
  assert.equal(index.status, 200);
  assert.ok(html.includes('osint-page'), 'interface nao servida');
  assert.ok(html.includes('window.turnstile'), 'shim local ausente');

  const token = await fetch(`${base}/.netlify/functions/token`, { headers: { origin: base } });
  assert.equal(token.status, 200);

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; processo npm run dev equivalente',
    porta: port,
    aviso: output.split('\n').filter(l => l.includes('Server running')).map(l => l.trim()),
    ui: index.status,
    tokenGet: token.status
  }));
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 300));
  if (child.exitCode === null) child.kill('SIGKILL');
}
