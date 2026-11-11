// Reinicia o servidor de desenvolvimento local em segundo plano.
//
// Por que existe: o editor abre a previa com `npm run dev`. Um processo
// antigo do servidor continua segurando a porta e mantendo o codigo velho em
// memoria (os modulos ESM sao carregados uma vez por processo). Como o
// servidor local cai para outra porta livre quando a pedida esta ocupada,
// a previa nunca morre por causa de porta ocupada — e por isso este script
// NAO precisa derrubar a previa do editor para liberar a porta.
//
// Este script encerra apenas o servidor de fundo que ele mesmo subiu
// (registrado em %TEMP%\osint-dev-server.json), sobe um servidor novo
// solto (desacoplado deste processo, para sobreviver ao fim do script),
// espera a linha NEXUS_PREVIEW_URL= e confere que a pagina responde 200.
//
// O servidor de fundo sobe em porta efemera, fora da lista de portas que a
// previa usa (3000, 5173, ...). Assim os dois convivem sem disputar porta.
//
//   npm run dev:restart                  # reinicia e imprime a URL
//   npm run dev:restart -- --porta 4000  # porta fixa
//   npm run dev:restart -- --host 127.0.0.1
//
// Escopo: LOCAL ONLY. Nao toca em rede externa, em arquivos do projeto nem
// em processos que nao sejam o servidor de desenvolvimento deste projeto.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caminhoLog, gravarEstado } from './dev-state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(here, '..');
const log = caminhoLog();

const argumentos = process.argv.slice(2);
const opcao = nome => {
  for (let i = 0; i < argumentos.length; i++) {
    if (argumentos[i] === `--${nome}`) return argumentos[i + 1] ?? '';
    if (argumentos[i].startsWith(`--${nome}=`)) return argumentos[i].slice(nome.length + 3);
  }
  return '';
};
const porta = (opcao('porta') || opcao('port')).trim();
const host = opcao('host').trim();

const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  // 1. Encerrar SO o servidor de fundo registrado no arquivo de estado. A
  //    previa do editor e preservada: encerra-la derruba a previa aberta.
  const parada = spawnSync(process.execPath, [path.join(here, 'stop-dev-servers.mjs'), '--json'], {
    encoding: 'utf8',
    windowsHide: true
  });
  let encerrados = [];
  let protegidos = [];
  try {
    const dados = JSON.parse(parada.stdout || '{}');
    encerrados = dados.encerrados || [];
    protegidos = dados.protegidos || [];
  } catch {
    // O relatorio e informativo: a parada acontece de todo jeito.
  }

  // 2. Subir o servidor novo, desacoplado, com a saida no arquivo de log.
  try { if (existsSync(log)) unlinkSync(log); } catch { /* log antigo nao impede nada */ }
  const descritor = openSync(log, 'a');
  const args = [path.join(here, 'dev-server.mjs')];
  if (porta) args.push('--port', porta);
  else args.push('--efemera');
  if (host) args.push('--host', host);
  const filho = spawn(process.execPath, args, {
    cwd: raiz,
    detached: true,
    stdio: ['ignore', descritor, descritor],
    windowsHide: true
  });
  // O processo filho herda o descritor; o pai nao precisa mais dele.
  closeSync(descritor);
  filho.unref();

  // 3. Esperar a URL no log (o servidor imprime logo depois de subir).
  let url = '';
  let diagnostico = '';
  for (let tentativa = 0; tentativa < 80 && !url; tentativa++) {
    await dormir(250);
    let texto = '';
    try {
      texto = readFileSync(log, 'utf8');
      diagnostico = 'log lido: ' + texto.length + ' bytes';
    } catch (erro) {
      diagnostico = 'falha ao ler o log: ' + erro.message;
    }
    // A linha do log vem indentada com dois espacos.
    const linha = texto.split('\n').map(l => l.trim()).find(l => l.startsWith('NEXUS_PREVIEW_URL='));
    if (linha) url = linha.slice('NEXUS_PREVIEW_URL='.length).trim();
  }
  if (!url) {
    let conteudo = '';
    try { conteudo = readFileSync(log, 'utf8'); } catch { /* o log nao existe */ }
    console.error('[dev:restart] o servidor nao imprimiu NEXUS_PREVIEW_URL. Log em ' + log);
    console.error('[dev:restart] ' + diagnostico);
    if (conteudo.trim()) console.error('[dev:restart] conteudo do log:\n' + conteudo.trim());
    process.exitCode = 1;
    return;
  }

  // 4. Conferir que a pagina responde com o codigo novo.
  let status = 0;
  let assets = {};
  try {
    const r = await fetch(url + '/', { redirect: 'manual' });
    status = r.status;
    await r.text();
    for (const caminho of ['/favicon.svg', '/robots.txt', '/sitemap.xml', '/.well-known/security.txt', '/obrigado.html']) {
      const resp = await fetch(url + caminho, { redirect: 'manual' });
      await resp.text();
      assets[caminho] = resp.status;
    }
  } catch (erro) {
    console.error('[dev:restart] falha ao consultar o servidor local: ' + erro.message);
  }

  // 5. Registrar o servidor de fundo, para o dev:stop saber o que encerrar
  //    sem encostar na previa do editor.
  const portaReal = Number(new URL(url).port || 0);
  gravarEstado({
    pid: filho.pid,
    url,
    porta: portaReal,
    modo: porta ? 'porta-fixa' : 'efemera'
  });

  console.log(JSON.stringify({
    escopo: 'LOCAL ONLY; servidor de desenvolvimento local',
    pid: filho.pid,
    url,
    porta: portaReal,
    statusRaiz: status,
    estaticos: assets,
    encerradosAntes: encerrados,
    preservados: protegidos,
    log
  }));
}

await main();
