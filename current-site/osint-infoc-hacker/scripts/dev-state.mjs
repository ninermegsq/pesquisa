// Estado compartilhado do servidor de desenvolvimento local.
//
// O arquivo guarda o PID e a URL do servidor de fundo que o `dev:restart`
// subiu. Ele existe para que o `dev:stop` consiga encerrar exatamente
// aquele servidor, sem encostar na previa do editor (que e um
// `node scripts/dev-server.mjs` igual aos outros e morre com a mensagem
// "o servidor terminou antes de abrir a previa").
//
// Escopo: LOCAL ONLY. O arquivo fica em %TEMP%, nao contem segredo e pode
// ser apagado a qualquer momento.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const caminhoEstado = () => path.join(os.tmpdir(), 'osint-dev-server.json');
export const caminhoLog = () => path.join(os.tmpdir(), 'osint-dev-server.log');

export function lerEstado() {
  try {
    const dados = JSON.parse(readFileSync(caminhoEstado(), 'utf8'));
    if (!dados || typeof dados !== 'object') return null;
    if (!Number.isFinite(Number(dados.pid))) return null;
    return { ...dados, pid: Number(dados.pid) };
  } catch {
    return null;
  }
}

export function gravarEstado(dados) {
  writeFileSync(
    caminhoEstado(),
    JSON.stringify({ ...dados, gravado_em: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

export function limparEstado() {
  try { if (existsSync(caminhoEstado())) unlinkSync(caminhoEstado()); } catch { /* ja removido */ }
}
