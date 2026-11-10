// Confere que o build e idempotente e que a arvore do repositorio fica
// exatamente como estava depois do build.
//
// Por que um script e nao um `git diff` solto no YAML da CI:
//   - `git diff -- <caminho>` ignora caminho que nao existe: se um artefato
//     derivado fosse apagado ou renomeado, a CI continuaria verde;
//   - `git diff` so enxerga arquivo versionado: um artefato novo criado pelo
//     build escaparia da conferencia;
//   - `git status --porcelain` enxerga os tres casos (alterado, apagado ou
//     criado) e nao depende de lista de caminhos repetida no YAML.
//
// Alem disso o check roda o build de novo e exige que a arvore continue igual:
// e isso que prova a idempotencia, e nao apenas que o build foi aplicado.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede, nada publicado, nenhum
// arquivo do repositorio alterado por este check (ele so le o estado do git
// e roda o build, que por sua vez reescreve os artefatos ja versionados).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(aqui, '..');

// Artefatos derivados que o build reescreve (caminho relativo ao site).
const DERIVADOS = [
  'src/sources/registry.meta.mjs',
  'src/lib/migrations.mjs',
  'cloudflare-worker.mjs'
];

const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};

// A raiz do repositorio vem do proprio git: o check funciona em qualquer
// clone, em qualquer pasta, e falha com mensagem clara fora de um repositorio.
const top = git(['rev-parse', '--show-toplevel'], SITE);
if (top.status !== 0) {
  console.error('build-idempotence-check: este check precisa de um repositorio git (git rev-parse --show-toplevel falhou).');
  process.exit(1);
}
const RAIZ = top.stdout.trim();
const prefixo = path.relative(RAIZ, SITE).split(path.sep).join('/');
const artefatos = DERIVADOS.map(p => `${prefixo}/${p}`);

// 1. Os artefatos derivados existem em disco e estao versionados. Um
//    artefato apagado ou nunca versionado precisa aparecer aqui: sem isso o
//    `git diff` do CI passaria em silencio.
for (const artefato of artefatos) {
  assert.ok(
    existsSync(path.join(RAIZ, artefato)),
    `artefato derivado ausente: ${artefato} (rode "npm run build")`
  );
  const rastreado = git(['ls-files', '--error-unmatch', '--', artefato], RAIZ);
  assert.equal(
    rastreado.status,
    0,
    `artefato derivado nao versionado: ${artefato} (${rastreado.stderr.trim() || 'git ls-files falhou'})`
  );
}

// 2. Nenhum diff nos artefatos e nenhuma alteracao na arvore (incluindo
//    arquivo novo, que o `git diff` nao enxerga).
const conferirArvore = momento => {
  const diff = git(['diff', '--exit-code', '--', ...artefatos], RAIZ);
  assert.equal(
    diff.status,
    0,
    `os artefatos derivados mudaram (${momento}):\n${diff.stdout}${diff.stderr}`
  );
  const status = git(['status', '--porcelain', '--untracked-files=all'], RAIZ);
  assert.equal(status.status, 0, `git status falhou (${momento}): ${status.stderr}`);
  assert.equal(
    status.stdout.trim(),
    '',
    `a arvore do repositorio esta suja (${momento}):\n${status.stdout.trim()}\n` +
    'Rode "npm run build" e versione o resultado antes de commitar.'
  );
};

conferirArvore('depois do build');

// 3. Roda o build de novo: a arvore tem de continuar igual. E o que prova que
//    o build e idempotente (e nao so que ele foi aplicado uma vez).
//    No Windows o npm e um .cmd: ele e chamado pelo `cmd.exe` para nao
//    depender de `shell: true` (que o Node sinaliza como inseguro).
const build = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: SITE, encoding: 'utf8' })
  : spawnSync('npm', ['run', 'build'], { cwd: SITE, encoding: 'utf8' });
if (build.status !== 0) {
  console.error(build.stdout || '');
  console.error(build.stderr || '');
}
assert.equal(build.status, 0, `"npm run build" falhou no segundo build (codigo ${build.status})`);

conferirArvore('depois do segundo build');

console.log(JSON.stringify({
  ok: true,
  escopo: 'LOCAL ONLY; nenhum arquivo publicado',
  artefatos,
  arvoreLimpa: true,
  buildDeterministico: true
}));
