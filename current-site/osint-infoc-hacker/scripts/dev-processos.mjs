// Lista os processos node do servidor de desenvolvimento local.
//
// Fica num modulo proprio porque varios scripts precisam da mesma lista:
// `stop-dev-servers.mjs` (encerrar), `dev-status.mjs` (diagnostico) e
// `dev-instancia.mjs` (dono da porta).
// A listagem e por linha de comando: no Windows vem do PowerShell, no
// Linux/macOS vem do `ps`.
//
// Escopo: LOCAL ONLY. Leitura de processos do proprio usuario.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const ALVO = 'dev-server.mjs';

function rodar(comando, args) {
  const r = spawnSync(comando, args, { encoding: 'utf8', windowsHide: true });
  if (r.error) return '';
  return (r.stdout || '').trim();
}

function comoLista(dados) {
  if (!dados) return [];
  if (Array.isArray(dados)) return dados;
  return [dados];
}

// Todos os processos do sistema, em uma unica chamada. Um mapa PID -> pai
// permite montar a arvore de ancestrais sem uma chamada por processo.
export function listarProcessos() {
  if (process.platform === 'win32') {
    const comando = [
      'Get-CimInstance Win32_Process',
      '| Select-Object ProcessId,ParentProcessId,Name,CommandLine',
      '| ConvertTo-Json -Compress'
    ].join(' ');
    const saida = rodar('powershell.exe', ['-NoProfile', '-Command', comando]);
    if (!saida) return [];
    let dados;
    try { dados = JSON.parse(saida); } catch { return []; }
    return comoLista(dados)
      .filter(p => p && p.ProcessId)
      .map(p => ({
        pid: Number(p.ProcessId),
        ppid: Number(p.ParentProcessId) || null,
        nome: String(p.Name || ''),
        cmd: String(p.CommandLine || '')
      }))
      .filter(p => Number.isFinite(p.pid));
  }
  const saida = rodar('ps', ['-eo', 'pid=,ppid=,comm=,args=']);
  return saida
    .split('\n')
    .map(linha => linha.trim())
    .filter(Boolean)
    .map(linha => {
      const partes = linha.split(/\s+/);
      return {
        pid: Number(partes[0]),
        ppid: Number(partes[1]) || null,
        nome: String(partes[2] || ''),
        cmd: partes.slice(3).join(' ')
      };
    })
    .filter(p => Number.isFinite(p.pid));
}

// Processos node cuja linha de comando cita o servidor de desenvolvimento.
export function listarServidores(processos = listarProcessos()) {
  return processos
    .filter(p => p.cmd && p.cmd.includes(ALVO))
    .map(p => ({ pid: p.pid, ppid: p.ppid, nome: p.nome, cmd: p.cmd }));
}

// Um processo esta vivo? (kill(pid, 0) no Windows e no POSIX)
export function vivo(pid) {
  const alvo = Number(pid);
  if (!Number.isFinite(alvo) || alvo <= 0) return false;
  try {
    process.kill(alvo, 0);
    return true;
  } catch (erro) {
    return erro && erro.code === 'EPERM';
  }
}

// Mapa PID -> processo, para consultas O(1).
export function mapaDeProcessos(processos = listarProcessos()) {
  const mapa = new Map();
  for (const p of processos) mapa.set(p.pid, p);
  return mapa;
}

// Pai de um processo. No Windows vem do WMI (CIM); no Linux, do /proc.
export function paiDe(pid, mapa = null) {
  const alvo = Number(pid);
  if (!Number.isFinite(alvo) || alvo <= 0) return null;
  if (mapa && mapa.has(alvo)) {
    const pai = mapa.get(alvo).ppid;
    return Number.isFinite(pai) && pai > 0 ? pai : null;
  }
  if (process.platform === 'win32') {
    const comando = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${alvo}"`,
      'if ($p) { $p.ParentProcessId }'
    ].join('; ');
    const saida = rodar('powershell.exe', ['-NoProfile', '-Command', comando]);
    const numero = Number(saida);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }
  try {
    const stat = readFileSync(`/proc/${alvo}/stat`, 'utf8');
    // O campo 4 do /proc/<pid>/stat e o pid do pai. O nome do processo vem
    // entre parenteses e pode conter espacos: o que vem depois do ultimo
    // ')' e comecado pelo campo 3.
    const depois = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const numero = Number(depois[1]);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  } catch {
    return null;
  }
}

// Cadeia de ancestrais de um processo (pai, avo, bisavo...), com o estado
// de cada elo. Serve para descobrir se um servidor sobreviveu a queda do
// editor: o editor morre, os filhos ficam, e o elo quebrado aparece aqui.
// `eloQuebrado` marca o primeiro ancestral que nao existe mais.
export function cadeiaDe(pid, { mapa = null, profundidade = 6 } = {}) {
  const cadeia = [];
  let atual = paiDe(pid, mapa);
  for (let i = 0; i < profundidade && atual; i++) {
    const existe = mapa ? mapa.has(atual) : vivo(atual);
    cadeia.push({ pid: atual, vivo: existe });
    if (!existe) break;
    if (atual === 1) break;
    atual = paiDe(atual, mapa);
  }
  return cadeia;
}
