// Verificacao de regressao do manifesto gerado e da previa do editor.
//
// Sintoma original: "A previa nao iniciou: o servidor terminou antes de abrir
// a previa", com o log do processo mostrando "fonte sem manifesto:
// placa_consultarplaca". Causa real: src/sources/registry.meta.mjs (o
// artefato gerado a partir de src/sources/registry.json) ficava velho depois
// de uma edicao do manifesto. O modulo do registro valida a implementacao
// contra o manifesto no carregamento e lancava erro nesse import: o processo
// morria antes de abrir a porta e a previa do editor nao tinha o que
// consultar.
//
// O que esta verificacao prova (LOCAL ONLY, sem rede externa):
//   1. O servidor local sincroniza o artefato gerado antes de carregar o
//      motor de fontes (scripts/garantir-manifesto.mjs).
//   2. Com o artefato gerado desatualizado, a previa abre do mesmo jeito:
//      HTTP 200 na porta que o editor reservou.
//   3. O arquivo volta a ser byte a byte o que o build gera.
//
// A verificacao altera o artefato gerado de proposito e o restaura no fim
// (o proprio servidor restaura; o `finally` e a rede de seguranca).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarMeta } from '../scripts/build-registry.mjs';
import { sincronizarManifesto } from '../scripts/garantir-manifesto.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(aqui, '..');
const manifesto = path.join(root, 'src', 'sources', 'registry.json');
const gerado = path.join(root, 'src', 'sources', 'registry.meta.mjs');

const dormir = ms => new Promise(r => setTimeout(r, ms));

const portaLivre = async () => {
  const srv = createServer(() => {});
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const livre = srv.address().port;
  await new Promise(resolve => srv.close(resolve));
  return livre;
};

const original = await readFile(gerado, 'utf8');
const conteudoEsperado = gerarMeta(JSON.parse(await readFile(manifesto, 'utf8')));
assert.equal(original, conteudoEsperado, 'o artefato gerado ja esta fora do manifesto antes do teste');

const checks = {};

// 1. O manifesto desatualizado e corrigido pelo sincronizador.
const desatualizado = original.replace(/digest: "[a-f0-9]+"/, 'digest: "0000000000000000000000000000000000000000000000000000000000000000"');
assert.notEqual(desatualizado, original, 'nao foi possivel deixar o artefato gerado desatualizado');
await writeFile(gerado, desatualizado, 'utf8');
const sincronizado = await sincronizarManifesto({ silencioso: true });
assert.equal(sincronizado.atualizado, true, 'o sincronizador nao regenerate o artefato gerado');
assert.equal(await readFile(gerado, 'utf8'), conteudoEsperado, 'o artefato gerado nao ficou igual ao que o build gera');
const emDia = await sincronizarManifesto({ silencioso: true });
assert.equal(emDia.atualizado, false, 'o sincronizador nao pode reescrever um artefato que ja esta em dia');
checks.sincronizador = { regerou: sincronizado.atualizado, emDia: !emDia.atualizado };

// 2. Com o artefato desatualizado, a previa do editor abre mesmo assim:
//    o servidor sincroniza antes de carregar o motor de fontes.
await writeFile(gerado, desatualizado, 'utf8');
const porta = await portaLivre();
const filho = spawn(process.execPath, ['scripts/dev-server.mjs'], {
  cwd: root,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(porta), BROWSER: 'none' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let saida = '';
filho.stdout.on('data', c => { saida += c.toString(); });
filho.stderr.on('data', c => { saida += c.toString(); });

let status = 0;
try {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/`);
      status = r.status;
      if (status >= 200 && status <= 399) break;
    } catch { /* ainda subindo */ }
    if (filho.exitCode !== null) break;
    await dormir(200);
  }
  assert.equal(filho.exitCode, null, `o servidor terminou antes da previa. Saida:\n${saida}`);
  assert.equal(status, 200, `a previa nao respondeu 200 na porta reservada. Saida:\n${saida}`);
  assert.ok(saida.includes('Server running on'), `sem aviso de "Server running". Saida:\n${saida}`);
  assert.equal(await readFile(gerado, 'utf8'), conteudoEsperado, 'o servidor nao regenerou o artefato gerado');
  checks.previaComManifestoVelho = { porta, status, regenerou: true };
} finally {
  filho.kill('SIGTERM');
  await dormir(400);
  if (filho.exitCode === null) filho.kill('SIGKILL');
  // Rede de seguranca: o artefato gerado volta ao estado que o build produz.
  await writeFile(gerado, conteudoEsperado, 'utf8');
}

console.log(JSON.stringify({
  escopo: 'LOCAL ONLY; manifesto gerado e previa do editor',
  ...checks
}));
