// Registro das instancias do servidor de desenvolvimento local.
//
// Problema que este arquivo resolve:
// o preview do editor e um `node scripts/dev-server.mjs` igual aos demais.
// Quando o editor encerra a arvore que ele proprio iniciou, o processo do
// servidor sobrevive (o encadeamento npm -> npm -> node nao e derrubado por
// completo) e fica segurando uma das portas da lista da previa. A cada nova
// tentativa de preview, um servidor orfao a mais ocupa a lista; quando a
// lista acaba, o servidor termina e o editor mostra
// "o servidor terminou antes de abrir a previa".
//
// Solucao: cada instancia grava um arquivo em %TEMP% e, ao subir, encerra as
// instancias antigas do MESMO projeto que ainda seguram uma porta canonica.
// O servidor mais novo fica com a porta; o orfao morre. Como o servidor de
// fundo (`dev:restart`) usa porta efemera, fora da lista, ele nunca e
// atingido por essa limpeza.
//
// Escopo: LOCAL ONLY. Os arquivos ficam em %TEMP%, nao contem segredo e
// podem ser apagados a qualquer momento.

import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cadeiaDe, mapaDeProcessos } from './dev-processos.mjs';

// Portas usadas pelo preview do editor. A primeira livre e a canonica.
export const PORTAS_CANONICAS = [3000, 5173, 8080, 4173, 5000, 3001, 5174, 8000, 8888];

// Lista de portas da previa. Pode ser trocada por NEXUS_PORTAS_PREVIA para
// que as verificacoes automatizadas usem portas proprias e nao disputem a
// porta com a previa viva do editor.
export function portasCanonicas() {
  const bruto = String(process.env.NEXUS_PORTAS_PREVIA || '').trim();
  if (!bruto) return PORTAS_CANONICAS;
  const lista = bruto
    .split(/[,\s]+/)
    .map(v => Number(v))
    .filter(v => Number.isInteger(v) && v > 0 && v < 65536);
  return lista.length ? [...new Set(lista)] : PORTAS_CANONICAS;
}

const PREFIXO = 'osint-dev-instancia-';
const SUFIXO = '.json';
const PROJETO = 'osint-infoc-hacker';

const dormir = ms => new Promise(r => setTimeout(r, ms));

export const caminhoInstancia = (pid) => path.join(os.tmpdir(), `${PREFIXO}${pid}${SUFIXO}`);

export function registrarInstancia({ pid, porta, papel, url, ppid } = {}) {
  const dados = {
    projeto: PROJETO,
    pid: Number(pid),
    porta: Number(porta) || null,
    papel: papel || 'previa',
    url: url || '',
    // O processo que iniciou este servidor. Serve para saber se ele virou
    // orfao: o editor encerra a arvore que subiu, mas o `node scripts/dev-server.mjs`
    // sobrevive e continua segurando a porta.
    ppid: Number(ppid ?? process.ppid) || null,
    iniciado_em: new Date().toISOString()
  };
  try {
    writeFileSync(caminhoInstancia(pid), JSON.stringify(dados, null, 2), 'utf8');
  } catch { /* registro e apenas uma pista; a previa nao depende dele */ }
  return dados;
}

export function removerInstancia(pid) {
  try {
    const caminho = caminhoInstancia(pid);
    if (existsSync(caminho)) unlinkSync(caminho);
  } catch { /* ja removido */ }
}

export function listarInstancias() {
  let nomes = [];
  try {
    nomes = readdirSync(os.tmpdir()).filter(n => n.startsWith(PREFIXO) && n.endsWith(SUFIXO));
  } catch {
    return [];
  }
  const lista = [];
  for (const nome of nomes) {
    const arquivo = path.join(os.tmpdir(), nome);
    let dados = null;
    try {
      dados = JSON.parse(readFileSync(arquivo, 'utf8'));
    } catch {
      dados = null;
    }
    if (!dados || !Number.isFinite(Number(dados.pid))) {
      const pid = Number(nome.slice(PREFIXO.length, nome.length - SUFIXO.length));
      lista.push({ pid: Number.isFinite(pid) ? pid : 0, arquivo, invalido: true });
      continue;
    }
    lista.push({ ...dados, pid: Number(dados.pid), porta: Number(dados.porta) || null, arquivo });
  }
  return lista;
}

export function processoVivo(pid) {
  const alvo = Number(pid);
  if (!Number.isFinite(alvo) || alvo <= 0) return false;
  try {
    process.kill(alvo, 0);
    return true;
  } catch (erro) {
    // EPERM: o processo existe, mas nao temos permissao para sinaliza-lo.
    return erro && erro.code === 'EPERM';
  }
}

export function encerrarProcesso(pid) {
  const alvo = Number(pid);
  if (!Number.isFinite(alvo) || alvo <= 0) return false;
  if (alvo === process.pid) return false;
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/PID', String(alvo), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
    return r.status === 0;
  }
  try {
    process.kill(-alvo, 'SIGTERM');
    return true;
  } catch { /* o processo pode nao ser lider de um grupo */ }
  try {
    process.kill(alvo, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

// Encera as instancias do projeto que ainda seguram uma porta canonica,
// liberando a porta para o servidor que esta subindo agora.
// O servidor de fundo usa porta efemera e, por isso, nunca e atingido.
// Uma instancia e ORFA quando o processo que a iniciou ja morreu. E o unico
// caso em que um servidor pode assumir a porta de outro: um servidor VIVO
// (a previa do editor, ou o servidor de fundo de outra sessao) nunca e
// derrubado por outro servidor. Derrubar uma previa viva e o que produz
// "o servidor terminou antes de abrir a previa".
//
// Caso extra (Windows): o pai imediato pode estar VIVO mesmo com a arvore
// morta acima dele, porque o Windows nao reparenta os filhos. O editor
// encerra o processo que subiu a arvore, os intermediarios (cmd.exe, npm)
// sobrevivem e o servidor continua segurando a porta. Nesse caso o sinal
// esta no elo quebrado da cadeia de ancestrais: `instanciaDesatacada`.
export function instanciaOrfa(instancia, { mapa = null } = {}) {
  const ppid = Number(instancia?.ppid);
  if (Number.isFinite(ppid) && ppid > 0) {
    // Linux: o processo orfao e reparentado para o init (pid 1).
    if (ppid === 1) return true;
    if (!processoVivo(ppid)) return true;
  }
  return instanciaDesatacada(instancia, { mapa });
}

// Idade minima para tratar uma instancia como "desatacada". Uma previa
// recem-inaugurada nunca e derrubada por este caminho: o editor ainda pode
// estar subindo a arvore de ancestrais e um elo morto ali seria normal.
export const MINUTOS_DESATACADO = 15;

// A instancia esta DESATACADA quando a arvore de ancestrais que a subiu
// morreu e ela sobreviveu: o elo quebrado aparece na cadeia (o primeiro
// ancestral que nao existe mais). E o sinal que identifica os servidores
// que sobraram de uma sessao anterior e continuam segurando as portas.
export function instanciaDesatacada(instancia, { mapa = null } = {}) {
  const pid = Number(instancia?.pid);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  const inicio = Date.parse(String(instancia?.iniciado_em || ''));
  if (Number.isFinite(inicio) && Date.now() - inicio < MINUTOS_DESATACADO * 60_000) return false;
  // O mapa de processos custa uma chamada ao PowerShell no Windows: e
  // construido uma vez por operacao e reaproveitado.
  const m = typeof mapa === 'function' ? mapa() : (mapa || mapaDeProcessos());
  return cadeiaDe(pid, { mapa: m }).some(elo => !elo.vivo);
}

// Encerra as instancias do projeto que ainda seguram uma porta canonica,
// liberando a porta para o servidor que esta subindo agora.
//
// Politica de posse (por padrao, `apenasOrfas = true`): so uma instancia
// orfa e encerrada. Com `apenasOrfas = false`, o operador esta assumindo a
// porta de proposito (flag `--assumir` do servidor) e a instancia registrada
// e encerrada mesmo que esteja viva.
// O servidor de fundo usa porta efemera e, por isso, nunca e atingido.
export async function liberarPortasCanicas({ portas = portasCanonicas(), excetoPid = process.pid, apenasOrfas = true } = {}) {
  const encerrados = [];
  // Um unico mapa de processos por operacao (o custo e uma chamada ao
  // PowerShell no Windows).
  let cacheMapa = null;
  const mapa = () => { if (!cacheMapa) cacheMapa = mapaDeProcessos(); return cacheMapa; };
  for (const instancia of listarInstancias()) {
    if (instancia.invalido) {
      removerInstancia(instancia.pid);
      continue;
    }
    if (instancia.pid === excetoPid) continue;
    if (!processoVivo(instancia.pid)) {
      removerInstancia(instancia.pid);
      continue;
    }
    const porta = Number(instancia.porta);
    if (!Number.isFinite(porta) || !portas.includes(porta)) continue;
    const orfa = instanciaOrfa(instancia, { mapa });
    if (apenasOrfas && !orfa) continue;
    if (!encerrarProcesso(instancia.pid)) continue;
    for (let i = 0; i < 60; i++) {
      if (!processoVivo(instancia.pid)) break;
      await dormir(50);
    }
    removerInstancia(instancia.pid);
    encerrados.push({ pid: instancia.pid, porta, papel: instancia.papel || 'previa', orfa });
  }
  return encerrados;
}

// Remove os arquivos de registro cujo processo ja morreu.
export function limparRegistrosMortos() {
  let removidos = 0;
  for (const instancia of listarInstancias()) {
    if (instancia.invalido || !processoVivo(instancia.pid)) {
      removerInstancia(instancia.pid);
      removidos++;
    }
  }
  return removidos;
}
