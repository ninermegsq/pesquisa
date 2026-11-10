// Encerra os servidores de desenvolvimento deixados em segundo plano.
//
// Por que existe: o editor abre a previa com `npm run dev`. Se um processo
// antigo continua no ar, ele segura a porta pedida e a proxima previa falha
// com "o servidor terminou antes de abrir a previa". Este script localiza
// apenas processos `node ... dev-server.mjs` e encerra a arvore de cada um.
//
// Escopo: LOCAL ONLY. Nao toca em rede, em arquivos nem em processos que
// nao sejam o servidor de desenvolvimento deste projeto.
//
//   npm run dev:stop            # encerra todos os dev-server deste projeto
//   npm run dev:stop -- --listar  # so lista, sem encerrar nada
//   npm run dev:stop -- --json  # saida em JSON (util em verificacoes)

import { spawnSync } from 'node:child_process';

const ALVO = 'dev-server.mjs';
const json = process.argv.includes('--json');
const apenasListar = process.argv.includes('--listar');
const erros = [];

function rodar(comando, args) {
  const r = spawnSync(comando, args, { encoding: 'utf8', windowsHide: true });
  if (r.error) { erros.push(r.error.message); return ''; }
  return (r.stdout || '').trim();
}

// Lista os processos node cuja linha de comando cita o arquivo do servidor.
// No Windows a listagem vem do PowerShell; no Linux/macOS, do `ps`.
function listar() {
  if (process.platform === 'win32') {
    const comando = [
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"",
      '| Where-Object { $_.CommandLine -like ' + "'*" + ALVO + "*'" + ' }',
      '| Select-Object ProcessId,CommandLine',
      '| ConvertTo-Json -Compress'
    ].join(' ');
    const saida = rodar('powershell.exe', ['-NoProfile', '-Command', comando]);
    if (!saida) return [];
    let dados;
    try { dados = JSON.parse(saida); } catch { return []; }
    const lista = Array.isArray(dados) ? dados : [dados];
    return lista
      .filter(p => p && p.ProcessId)
      .map(p => ({ pid: Number(p.ProcessId), cmd: String(p.CommandLine || '') }));
  }
  const saida = rodar('ps', ['-eo', 'pid=,args=']);
  return saida
    .split('\n')
    .map(linha => linha.trim())
    .filter(Boolean)
    .filter(linha => linha.includes(ALVO))
    .map(linha => {
      const espaco = linha.indexOf(' ');
      return { pid: Number(linha.slice(0, espaco)), cmd: linha.slice(espaco + 1) };
    })
    .filter(p => Number.isFinite(p.pid));
}

function encerrar(pid) {
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
    return r.status === 0;
  }
  try { process.kill(-pid, 'SIGTERM'); return true; } catch { /* grupo pode nao existir */ }
  try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; }
}

const alvos = listar()
  // Nunca encerra o proprio processo nem o pai: sao o runner do script.
  .filter(p => p.pid !== process.pid && p.pid !== process.ppid);

const encerrados = [];
const restantes = [];
for (const alvo of alvos) {
  if (apenasListar) continue;
  if (encerrar(alvo.pid)) encerrados.push(alvo.pid);
  else restantes.push(alvo.pid);
}

const resultado = {
  escopo: 'LOCAL ONLY; apenas processos node do servidor de desenvolvimento',
  encontrados: alvos.length,
  pids: alvos.map(a => a.pid),
  apenasListar,
  encerrados,
  restantes,
  erros
};

if (json) {
  console.log(JSON.stringify(resultado));
} else if (alvos.length === 0) {
  console.log('nenhum servidor de desenvolvimento em execucao');
} else if (apenasListar) {
  console.log('servidores de desenvolvimento em execucao: ' + alvos.map(a => a.pid).join(', '));
} else {
  console.log('servidores encerrados: ' + (encerrados.join(', ') || 'nenhum'));
  if (restantes.length) console.log('nao foi possivel encerrar: ' + restantes.join(', '));
}
