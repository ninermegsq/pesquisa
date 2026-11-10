// Sobe `node scripts/dev-server.mjs` como processo filho (o mesmo caminho de
// `npm run dev`), espera o aviso de "Server running", consulta a interface e
// encerra o processo. Verifica LOCAL ONLY, sem rede externa.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const port = 4321;

// Porta livre agora: abre um servidor efemero, anota a porta e fecha.
const portaLivre = async () => {
  const srv = createServer(() => {});
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const livre = srv.address().port;
  await new Promise(resolve => srv.close(resolve));
  return livre;
};
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
  assert.ok(html.includes('AMBIENTE LOCAL · Turnstile simulado'), 'faixa de Turnstile simulado ausente');
  const dataStats = html.match(/data-stats="([^"]*)"/);
  assert.ok(dataStats, 'data-stats ausente');
  const decodeAttr = v => v.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const stats = JSON.parse(decodeAttr(dataStats[1]));
  assert.deepEqual(stats, { total: 24, email: 12, categorias: 6, keys: 0 });
  assert.ok(/id="scan-log"/.test(html), '#scan-log ausente');

  // Portas esgotadas: PORT explicito ocupado em IPv4 e IPv6 deve listar as
  // tentativas e sair com 1.
  const blocker4 = createServer(() => {});
  const blocker6 = createServer(() => {});
  await new Promise(resolve => blocker4.listen(0, '127.0.0.1', resolve));
  const busyPort = blocker4.address().port;
  let blocker6Up = false;
  try { await new Promise((resolve, reject) => { blocker6.once('error', reject); blocker6.listen(busyPort, '::1', resolve); }); blocker6Up = true; } catch { /* IPv6 indisponivel nesta maquina */ }
  // --sem-fallback: modo estrito, em que a porta pedida e obrigatoria.
  const busy = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(busyPort), '--sem-fallback'], {
    cwd: root,
    env: { ...process.env, PORT: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  busy.unref();
  let busyOut = '';
  busy.stdout.on('data', chunk => { busyOut += chunk.toString(); });
  busy.stderr.on('data', chunk => { busyOut += chunk.toString(); });
  const busyCode = await new Promise(resolve => {
    const timer = setTimeout(() => { busy.kill('SIGKILL'); resolve(null); }, 8000);
    busy.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(busyCode, 1, `servidor com porta ocupada deveria sair com 1; saida:\n${busyOut}`);
  assert.ok(busyOut.includes(`Portas tentadas: ${busyPort}`), `mensagem sem lista de portas tentadas; saida:\n${busyOut}`);
  assert.ok(busyOut.includes('PORT='), `mensagem sem instrucao de PORT; saida:\n${busyOut}`);

  // Modo normal (padrao do preview): com a porta pedida ocupada, o servidor
  // NAO termina: ele cai para outra porta livre e continua no ar. E o que
  // evita o erro "o servidor terminou antes de abrir a previa".
  const fallback = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(busyPort)], {
    cwd: root,
    env: { ...process.env, PORT: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let fallbackOut = '';
  fallback.stdout.on('data', chunk => { fallbackOut += chunk.toString(); });
  fallback.stderr.on('data', chunk => { fallbackOut += chunk.toString(); });
  let fallbackPort = 0;
  let fallbackUi = 0;
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const match = fallbackOut.match(/Server running on http:\/\/localhost:(\d+)/);
      if (match) { fallbackPort = Number(match[1]); break; }
      if (fallback.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(fallback.exitCode, null, `o servidor terminou com a porta ocupada. Saida:\n${fallbackOut}`);
    assert.ok(fallbackPort > 0, `sem aviso de "Server running" no fallback. Saida:\n${fallbackOut}`);
    assert.notEqual(fallbackPort, busyPort, 'o fallback deveria usar outra porta');
    assert.ok(fallbackOut.includes(`NEXUS_PREVIEW_URL=http://localhost:${fallbackPort}`), `NEXUS_PREVIEW_URL sem a porta real. Saida:\n${fallbackOut}`);
    const fallbackBase = `http://127.0.0.1:${fallbackPort}`;
    const fbPage = await fetch(`${fallbackBase}/`, { headers: { origin: fallbackBase } });
    fallbackUi = fbPage.status;
    assert.equal(fallbackUi, 200, 'interface do fallback nao respondeu 200');
  } finally {
    fallback.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 400));
    if (fallback.exitCode === null) fallback.kill('SIGKILL');
  }
  await new Promise(resolve => blocker4.close(resolve));
  if (blocker6Up) await new Promise(resolve => blocker6.close(resolve));

  const token = await fetch(`${base}/.netlify/functions/token`, { headers: { origin: base } });
  assert.equal(token.status, 200);

  // Caminho do preview do editor: `npm run dev` na raiz do repositorio.
  // Duas garantias: (1) o script da raiz encaminha os argumentos para o
  // servidor local (e nao engole --port); (2) o processo do servidor
  // permanece vivo, imprime a URL da previa e serve a interface. Se ele
  // terminar, o preview abre com "servidor terminou antes de abrir".
  const repoRoot = path.resolve(root, '..', '..');
  const raizPkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const scriptDev = raizPkg?.scripts?.dev || '';
  assert.ok(
    scriptDev.includes('run dev --'),
    `o script "dev" da raiz precisa encaminhar os argumentos (esperado "run dev --"). Encontrado: ${scriptDev}`
  );

  const previewPort = await portaLivre();
  const preview = spawn(
    process.execPath,
    [path.join(root, 'scripts', 'dev-server.mjs'), '--port', String(previewPort)],
    {
      cwd: repoRoot,
      env: { ...process.env, PORT: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  let previewOut = '';
  preview.stdout.on('data', chunk => { previewOut += chunk.toString(); });
  preview.stderr.on('data', chunk => { previewOut += chunk.toString(); });
  let previewUi = 0;
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (/Server running on http:\/\/localhost:\d+/.test(previewOut)) break;
      if (preview.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(preview.exitCode, null, `o servidor local terminou antes da previa. Saida:\n${previewOut}`);
    assert.ok(/Server running on http:\/\/localhost:\d+/.test(previewOut), `sem aviso de "Server running". Saida:\n${previewOut}`);
    assert.ok(previewOut.includes(`NEXUS_PREVIEW_URL=http://localhost:${previewPort}`), `sem NEXUS_PREVIEW_URL na porta pedida. Saida:\n${previewOut}`);
    const previewBase = `http://127.0.0.1:${previewPort}`;
    const page = await fetch(`${previewBase}/`, { headers: { origin: previewBase } });
    previewUi = page.status;
    assert.equal(previewUi, 200, 'interface da previa nao respondeu 200');
  } finally {
    preview.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 400));
    if (preview.exitCode === null) preview.kill('SIGKILL');
  }

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; processo npm run dev equivalente',
    porta: port,
    aviso: output.split('\n').filter(l => l.includes('Server running')).map(l => l.trim()),
    ui: index.status,
    tokenGet: token.status,
    dataStats: stats,
    scanLog: true,
    turnstileSimulado: true,
    portasEsgotadas: { codigo: busyCode, listouPortas: true },
    fallbackDePorta: { portaOcupada: busyPort, portaUsada: fallbackPort, ui: fallbackUi, permaneceuVivo: true },
    previaRaiz: { scriptDev, porta: previewPort, ui: previewUi, permaneceuVivo: true }
  }));
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 300));
  if (child.exitCode === null) child.kill('SIGKILL');
}
