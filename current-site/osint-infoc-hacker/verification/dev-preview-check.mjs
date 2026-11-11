// Verificacao de regressao da previa do editor.
//
// Sintoma original: "A previa nao iniciou: o servidor terminou antes de abrir
// a previa". Causa: cada tentativa de preview deixava um servidor orfao
// segurando uma das portas da lista da previa (o editor encerra a arvore que
// iniciou, mas o `node scripts/dev-server.mjs` sobrevive). Com a lista
// esgotada, o servidor novo terminava.
//
// O que esta verificacao prova (LOCAL ONLY, sem rede externa):
//   1. Uma instancia nova ASSUME a porta canonica: a instancia antiga que a
//      segurava e encerrada e a nova responde 200 na MESMA porta.
//   2. O servidor de fundo (porta efemera, fora da lista) NAO e atingido.
//   3. A interface responde 200 na porta canonica apos a troca.
//   4. O registro de instancias fica com um unico dono por porta canonica.
//   5. Ao encerrar, o registro e removido (nada fica pendurado em %TEMP%).
//
// As portas usadas aqui sao proprias (NEXUS_PORTAS_PREVIA), para nao
// disputar a porta com a previa viva do editor durante `npm test`.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listarInstancias, processoVivo } from '../scripts/dev-instancia.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const PORTA = 4300;
const env = { ...process.env, PORT: '', NEXUS_PORTAS_PREVIA: String(PORTA) };

const dormir = ms => new Promise(r => setTimeout(r, ms));

function subir(args = []) {
  const filho = spawn(process.execPath, ['scripts/dev-server.mjs', ...args], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let saida = '';
  filho.stdout.on('data', c => { saida += c.toString(); });
  filho.stderr.on('data', c => { saida += c.toString(); });
  filho.saida = () => saida;
  return filho;
}

async function esperarUrl(filho, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = filho.saida().match(/Server running on http:\/\/localhost:(\d+)/);
    if (m) return Number(m[1]);
    if (filho.exitCode !== null) return 0;
    await dormir(120);
  }
  return 0;
}

async function encerrar(filho) {
  if (!filho || filho.exitCode !== null) return;
  filho.kill('SIGTERM');
  await dormir(400);
  if (filho.exitCode === null) filho.kill('SIGKILL');
  await dormir(200);
}

const instA = subir(['--port', String(PORTA)]);
const instFundo = subir(['--efemera']);
let instB = null;
let resultado = {};

try {
  const urlA = await esperarUrl(instA);
  assert.equal(urlA, PORTA, `a primeira instancia nao subiu na porta canonica. Saida:\n${instA.saida()}`);

  const urlFundo = await esperarUrl(instFundo);
  assert.ok(urlFundo > 0, `o servidor de fundo nao subiu. Saida:\n${instFundo.saida()}`);
  assert.notEqual(urlFundo, PORTA, 'o servidor de fundo deveria usar porta efemera');

  // Instancia nova na mesma porta: deve assumir a porta e encerrar a antiga.
  instB = subir(['--port', String(PORTA)]);
  const urlB = await esperarUrl(instB);
  assert.equal(urlB, PORTA, `a nova instancia nao assumiu a porta canonica. Saida:\n${instB.saida()}`);
  assert.ok(
    instB.saida().includes(`porta ${PORTA} liberada`),
    `sem aviso de assuncao de porta. Saida:\n${instB.saida()}`
  );

  // A instancia antiga tem de estar morta: e ela que segurava a porta.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && instA.exitCode === null) await dormir(120);
  assert.notEqual(instA.exitCode, null, 'a instancia antiga continuou viva segurando a porta');

  // O servidor de fundo (porta efemera) continua vivo: a limpeza nao pode
  // derrubar o servidor de fundo do `dev:restart`.
  assert.equal(instFundo.exitCode, null, 'o servidor de fundo foi encerrado pela assuncao de porta');
  const fundoUrl = await fetch(`http://127.0.0.1:${urlFundo}/`, { headers: { origin: `http://127.0.0.1:${urlFundo}` } });
  await fundoUrl.text();
  assert.equal(fundoUrl.status, 200, 'a interface do servidor de fundo nao respondeu 200');

  // A interface responde na porta canonica, agora com o dono novo.
  const base = `http://127.0.0.1:${PORTA}`;
  const pagina = await fetch(`${base}/`, { headers: { origin: base } });
  const html = await pagina.text();
  assert.equal(pagina.status, 200, 'a interface nao respondeu 200 na porta canonica');
  assert.ok(html.includes('osint-page'), 'interface nao servida na porta canonica');

  // Registro: um unico dono por porta canonica, e o de fundo intacto.
  const registradas = listarInstancias().filter(i => !i.invalido && processoVivo(i.pid));
  const donosCanonicas = registradas.filter(i => Number(i.porta) === PORTA);
  assert.equal(donosCanonicas.length, 1, `esperado um unico dono da porta canonica;utto: ${JSON.stringify(registradas)}`);
  assert.equal(donosCanonicas[0].pid, instB.pid, 'o registro nao aponta para a instancia nova');
  const donoFundo = registradas.find(i => Number(i.porta) === urlFundo);
  assert.ok(donoFundo, 'o servidor de fundo sumiu do registro');

  resultado = {
    escopo: 'LOCAL ONLY; assuncao da porta canonica da previa',
    portaCanonica: PORTA,
    portaEfemera: urlFundo,
    instanciaAntigaEncerrada: true,
    servidorDeFundoPreservado: true,
    interfaceNaPortaCanonica: pagina.status,
    donosDaPortaCanonica: donosCanonicas.length
  };
} finally {
  await encerrar(instB);
  await encerrar(instA);
  await encerrar(instFundo);
  await dormir(300);
  // Nada pendurado: nenhum processo vivo continua registrado.
  const vivos = listarInstancias().filter(i => !i.invalido && processoVivo(i.pid));
  const pendurados = vivos.filter(i => i.pid === instB?.pid || i.pid === instFundo?.pid || i.pid === instA?.pid);
  assert.equal(pendurados.length, 0, `instancia viva continua registrada: ${JSON.stringify(pendurados)}`);
  // No Windows o encerramento e abrupto (TerminateProcess) e o arquivo de
  // registro fica pendurado; o proximo servidor remove o registro do processo
  // morto. E o que prova `limparRegistrosMortos`.
  const { limparRegistrosMortos } = await import('../scripts/dev-instancia.mjs');
  limparRegistrosMortos();
  const depois = listarInstancias().filter(i => !i.invalido && processoVivo(i.pid));
  assert.equal(depois.length, vivos.length, 'a limpeza nao devia remover registros de processos vivos');
}

console.log(JSON.stringify(resultado));
