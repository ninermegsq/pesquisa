// Encerra os servidores de desenvolvimento locais.
//
// Politica de encerramento (importante para a previa do editor):
//
//   - Por padrao, encerra APENAS o servidor de fundo registrado no arquivo
//     de estado (%TEMP%\osint-dev-server.json) — o que o `dev:restart` subiu.
//   - A previa do editor tambem e um `node scripts/dev-server.mjs`. Encerrar
//     esse processo derruba a previa com "o servidor terminou antes de abrir
//     a previa". Por isso ele NAO e encerrado por padrao: com o servidor
//     caindo para outra porta livre, um servidor antigo segurando a porta
//     nao atrapalha mais a previa.
//   - `--todos` encerra todos os servidores, inclusive a previa do editor.
//     Use so quando quiser derrubar a previa de proposito.
//
//   npm run dev:stop                # encerra o servidor de fundo registrado
//   npm run dev:stop -- --todos     # encerra todos (inclusive a previa)
//   npm run dev:stop -- --limpar    # encerra so os orfaos, preservando a previa mais recente
//   npm run dev:stop -- --desatacados # encerra so os servidores desatacados (arvore morta)
//   npm run dev:stop -- --pid 1234  # encerra um PID especifico
//   npm run dev:stop -- --listar    # so lista, sem encerrar nada
//   npm run dev:stop -- --json      # saida em JSON (util em verificacoes)
//
// Escopo: LOCAL ONLY. Nao toca em rede, em arquivos do projeto nem em
// processos que nao sejam o servidor de desenvolvimento deste projeto.

import { spawnSync } from 'node:child_process';
import { lerEstado, limparEstado } from './dev-state.mjs';
import {
  instanciaDesatacada,
  listarInstancias,
  limparRegistrosMortos,
  portasCanonicas,
  processoVivo,
  removerInstancia
} from './dev-instancia.mjs';
import { mapaDeProcessos } from './dev-processos.mjs';

const ALVO = 'dev-server.mjs';
const json = process.argv.includes('--json');
const apenasListar = process.argv.includes('--listar');
const todos = process.argv.includes('--todos') || process.argv.includes('--all');
const limpar = process.argv.includes('--limpar');
const desatacados = process.argv.includes('--desatacados');
const pidsPedidos = [];
for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--pid' || arg === '--pids') {
    const bruto = String(process.argv[i + 1] || '').split(',').map(v => v.trim()).filter(Boolean);
    for (const p of bruto) if (/^\d+$/.test(p)) pidsPedidos.push(Number(p));
  } else if (arg.startsWith('--pid=') || arg.startsWith('--pids=')) {
    const bruto = arg.slice(arg.indexOf('=') + 1).split(',').map(v => v.trim()).filter(Boolean);
    for (const p of bruto) if (/^\d+$/.test(p)) pidsPedidos.push(Number(p));
  }
}
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
      '| Where-Object { $_.CommandLine -like ' + "'*" + ALVO + "*' }",
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

const estado = lerEstado();
const rastreado = estado && alvos.some(p => p.pid === estado.pid) ? estado.pid : null;

// Modo `--limpar`: mantem a instancia mais recente de cada porta canonica
// (a previa viva do editor) e encerra as mais antigas (os orfaos). E o que
// impede o acúmulo de servidores que so falta de porta para a previa.
const registradas = listarInstancias();
const maisRecentes = new Map();
for (const inst of registradas) {
  if (inst.invalido || !processoVivo(inst.pid)) continue;
  const porta = Number(inst.porta);
  if (!Number.isFinite(porta) || !portasCanonicas().includes(porta)) continue;
  const atual = maisRecentes.get(porta);
  if (!atual || String(inst.iniciado_em || '') > String(atual.iniciado_em || '')) maisRecentes.set(porta, inst);
}
const preservadosPorLimpeza = new Set([...maisRecentes.values()].map(i => i.pid));
const orfaos = registradas
  .filter(inst => !inst.invalido && processoVivo(inst.pid) && !preservadosPorLimpeza.has(inst.pid))
  .map(inst => inst.pid)
  .filter(pid => pid !== process.pid && pid !== process.ppid);

// Modo `--desatacados`: encerra so os servidores cuja arvore de ancestrais
// morreu (elo quebrado) e que por isso sobreviveram a sessao anterior. A
// previa viva do editor tem a arvore inteira de pe e nunca e tocada. E o
// modo que o `dev:status` recomenda quando a lista de portas da previa
// encheu de servidores orfaos.
const mapa = mapaDeProcessos();
const pidsDesatacados = registradas
  .filter(inst => !inst.invalido && processoVivo(inst.pid))
  .filter(inst => instanciaDesatacada(inst, { mapa }))
  .map(inst => inst.pid)
  .filter(pid => pid !== process.pid && pid !== process.ppid);

// Escolha de quem encerrar: por padrao, somente o servidor de fundo
// registrado; com `--pid`, os PIDs pedidos; com `--todos`, todos;
// com `--limpar`, apenas os orfaos (preservando a previa mais recente).
let selecionados;
let modo;
if (todos) {
  selecionados = alvos.map(p => p.pid);
  modo = 'todos';
} else if (limpar) {
  selecionados = orfaos;
  modo = 'limpar';
} else if (desatacados) {
  selecionados = pidsDesatacados;
  modo = 'desatacados';
} else if (pidsPedidos.length) {
  selecionados = alvos.map(p => p.pid).filter(pid => pidsPedidos.includes(pid));
  modo = 'pids';
} else if (rastreado) {
  selecionados = [rastreado];
  modo = 'registrado';
} else {
  selecionados = [];
  modo = 'registrado';
}

const protegidos = alvos.map(p => p.pid).filter(pid => !selecionados.includes(pid));

const encerrados = [];
const restantes = [];
if (!apenasListar) {
  for (const pid of selecionados) {
    if (encerrar(pid)) encerrados.push(pid);
    else restantes.push(pid);
  }
  // O registro da instancia so vale enquanto o processo estiver no ar.
  for (const inst of registradas) {
    if (encerrados.includes(inst.pid)) removerInstancia(inst.pid);
  }
  if (modo === 'todos') {
    for (const inst of registradas) removerInstancia(inst.pid);
  }
  // O arquivo de estado so vale enquanto o servidor registrado estiver no ar.
  if (estado) {
    const morreu = encerrados.includes(estado.pid);
    const jaNaoExiste = !alvos.some(p => p.pid === estado.pid);
    if (morreu || (modo === 'registrado' && jaNaoExiste)) limparEstado();
  }
}
const registrosMortos = apenasListar ? 0 : limparRegistrosMortos();

const resultado = {
  escopo: 'LOCAL ONLY; apenas processos node do servidor de desenvolvimento',
  modo,
  encontrados: alvos.length,
  pids: alvos.map(a => a.pid),
  rastreado,
  protegidos,
  apenasListar,
  encerrados,
  restantes,
  registrosMortos,
  erros
};

if (json) {
  console.log(JSON.stringify(resultado));
} else if (alvos.length === 0) {
  console.log('nenhum servidor de desenvolvimento em execucao');
} else if (apenasListar) {
  console.log('servidores de desenvolvimento em execucao: ' + alvos.map(a => a.pid).join(', '));
  console.log('  (servidor de fundo registrado: ' + (rastreado ?? 'nenhum') + ')');
  console.log('  (previa do editor e outros: ' + (protegidos.join(', ') || 'nenhum') + ')');
} else {
  console.log('modo: ' + modo);
  console.log('servidores encerrados: ' + (encerrados.join(', ') || 'nenhum'));
  if (restantes.length) console.log('nao foi possivel encerrar: ' + restantes.join(', '));
  if (modo === 'limpar') console.log('previa preservada: ' + ([...preservadosPorLimpeza].join(', ') || 'nenhuma'));
  if (modo === 'desatacados') {
    console.log('servidores desatacados encerrados: ' + (encerrados.join(', ') || 'nenhum'));
    console.log('  a previa viva (arvore de pe) foi preservada');
  }
  if (protegidos.length) {
    console.log('preservados (previa do editor ou servidores de outra sessao): ' + protegidos.join(', '));
    console.log('  para encerrar tambem: npm run dev:stop -- --todos');
  }
}
