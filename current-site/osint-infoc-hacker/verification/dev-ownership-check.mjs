// Verificacao da politica de posse dos servidores de desenvolvimento local.
//
// Escopo: LOCAL ONLY. Nao usa rede externa.
//
// O que e provado:
//   1. Um servidor NAO registrado (como a previa do editor) sobrevive ao
//      `dev:stop` padrao: encerrar a previa e o que produz "o servidor
//      terminou antes de abrir a previa".
//   2. `dev:stop -- --pid <n>` encerra o PID pedido.
//   3. `dev:restart` sobe o servidor de fundo em porta efemera, fora da
//      lista de portas que a previa usa, e registra o PID no arquivo de
//      estado.
//   4. `dev:stop` padrao encerra o servidor registrado e limpa o registro.
//
// Nenhum PID da maquina e encerrado sem ser explicito: o "--todos" nao e
// exercitado aqui porque derrubaria a previa do editor em uso.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhoEstado, lerEstado } from '../scripts/dev-state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Portas que a previa do editor usa. O servidor de fundo tem de ficar fora
// delas, senao a previa abriria em outra porta sem necessidade.
const PORTAS_DA_PREVIA = [3000, 5173, 8080, 4173, 5000, 3001, 5174, 8000, 8888];

const dormir = ms => new Promise(r => setTimeout(r, ms));

const portaLivre = async () => {
  const srv = createServer(() => {});
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const livre = srv.address().port;
  await new Promise(resolve => srv.close(resolve));
  return livre;
};

const rodar = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    encoding: 'utf8',
    windowsHide: true
  });
  let dados = {};
  try { dados = JSON.parse(r.stdout || '{}'); } catch { /* saida nao-JSON */ }
  return { dados, stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
};

const responder = async url => {
  try {
    const r = await fetch(url + '/', { redirect: 'manual' });
    await r.text();
    return r.status;
  } catch {
    return 0;
  }
};

// Sobe um servidor de desenvolvimento "nao registrado", como a previa do
// editor: nao ha arquivo de estado apontando para ele.
async function subirNaoRegistrado(porta) {
  const filho = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(porta)], {
    cwd: root,
    env: { ...process.env, PORT: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let saida = '';
  filho.stdout.on('data', c => { saida += c.toString(); });
  filho.stderr.on('data', c => { saida += c.toString(); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (saida.includes('Server running on')) break;
    if (filho.exitCode !== null) break;
    await dormir(150);
  }
  return { filho, saida };
}

const checks = {};

try {
  // 1. Servidor nao registrado (previa do editor) sobrevive ao dev:stop padrao.
  const porta = await portaLivre();
  const naoRegistrado = await subirNaoRegistrado(porta);
  assert.ok(naoRegistrado.saida.includes('Server running on'), `o servidor de teste nao subiu. Saida:\n${naoRegistrado.saida}`);
  const pidNaoRegistrado = naoRegistrado.filho.pid;

  const paradaPadrao = rodar('stop-dev-servers.mjs', ['--json']);
  const modo = paradaPadrao.dados.modo;
  const protegidos = paradaPadrao.dados.protegidos || [];
  assert.ok(
    protegidos.includes(pidNaoRegistrado) || (paradaPadrao.dados.encerrados || []).includes(pidNaoRegistrado) === false,
    `o servidor nao registrado deveria estar preservado. Saida: ${paradaPadrao.stdout}`
  );
  assert.ok(
    !(paradaPadrao.dados.encerrados || []).includes(pidNaoRegistrado),
    `o dev:stop padrao nao pode encerrar a previa do editor. Saida: ${paradaPadrao.stdout}`
  );
  const vivoDepois = await responder(`http://127.0.0.1:${porta}`);
  assert.equal(vivoDepois, 200, 'o servidor nao registrado deveria continuar no ar apos o dev:stop padrao');
  checks.previaPreservada = { pid: pidNaoRegistrado, modo, protegidos: protegidos.length, vivo: vivoDepois === 200 };

  // 2. O --pid encerra exatamente o PID pedido.
  const porPid = rodar('stop-dev-servers.mjs', ['--json', '--pid', String(pidNaoRegistrado)]);
  assert.ok((porPid.dados.encerrados || []).includes(pidNaoRegistrado), `o --pid deveria encerrar o processo. Saida: ${porPid.stdout}`);
  await dormir(700);
  const vivoAposPid = await responder(`http://127.0.0.1:${porta}`);
  assert.equal(vivoAposPid, 0, 'o servidor deveria estar encerrado depois do --pid');
  checks.encerrarPorPid = { pid: pidNaoRegistrado, encerrado: true };

  // 3. O dev:restart sobe o servidor de fundo em porta efemera e o registra.
  const antes = lerEstado();
  const restart = spawnSync(process.execPath, [path.join(root, 'scripts', 'dev-restart.mjs')], {
    encoding: 'utf8',
    windowsHide: true
  });
  assert.equal(restart.status, 0, `o dev:restart falhou. Saida:\n${restart.stdout}\n${restart.stderr}`);
  const saidaRestart = JSON.parse(restart.stdout.trim().split('\n').filter(l => l.trim().startsWith('{')).pop());
  assert.ok(saidaRestart.url, 'o dev:restart nao devolveu a URL');
  assert.equal(saidaRestart.statusRaiz, 200, 'a pagina do servidor de fundo nao respondeu 200');
  const portaFundo = Number(new URL(saidaRestart.url).port || 0);
  assert.ok(portaFundo > 0, 'o servidor de fundo deveria ter uma porta');
  assert.ok(
    !PORTAS_DA_PREVIA.includes(portaFundo),
    `o servidor de fundo não pode disputar a porta da previa (${portaFundo} esta na lista ${PORTAS_DA_PREVIA.join(', ')})`
  );
  const estado = lerEstado();
  assert.ok(estado, 'o arquivo de estado do servidor de fundo nao foi gravado');
  assert.equal(estado.pid, saidaRestart.pid, 'o PID registrado difere do PID do servidor');
  assert.ok(existsSync(caminhoEstado()), 'o arquivo de estado deveria existir');
  checks.servidorDeFundo = {
    url: saidaRestart.url,
    porta: portaFundo,
    foraDaListaDaPrevia: true,
    registrado: true,
    trocouServidorAnterior: Boolean(antes) ? antes.pid !== estado.pid : true
  };

  // 4. O dev:stop padrao encerra o servidor registrado e limpa o registro.
  const paradaFinal = rodar('stop-dev-servers.mjs', ['--json']);
  assert.equal(paradaFinal.dados.modo, 'registrado', `o modo padrao deveria ser "registrado". Saida: ${paradaFinal.stdout}`);
  assert.ok((paradaFinal.dados.encerrados || []).includes(estado.pid), `o servidor registrado deveria ter sido encerrado. Saida: ${paradaFinal.stdout}`);
  await dormir(700);
  const vivoAposStop = await responder(saidaRestart.url);
  assert.equal(vivoAposStop, 0, 'o servidor de fundo deveria estar encerrado');
  assert.equal(lerEstado(), null, 'o arquivo de estado deveria ter sido limpo');
  checks.servidorDeFundoEncerrado = { pid: estado.pid, encerrado: true, registroLimpo: true };

  console.log(JSON.stringify({
    scope: 'LOCAL ONLY; politica de posse dos servidores de desenvolvimento',
    ...checks
  }));
} finally {
  // Rede de seguranca: encerra apenas o servidor de teste desta verificacao.
  try {
    const pids = lerEstado()?.pid;
    if (pids) rodar('stop-dev-servers.mjs', ['--json', '--pid', String(pids)]);
  } catch { /* nada a encerrar */ }
}
