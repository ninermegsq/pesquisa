// Politica e SQL do limite de tentativas de login do painel admin.
//
// Este modulo e a fonte unica da verdade do limite: o mesmo SQL e a mesma
// politica rodam no Durable Object (Cloudflare) e no servidor local
// (node:sqlite), entao os dois caminhos se comportam igual.
//
// A reserva e feita em tres passos sem await no meio: ler a linha, calcular
// o novo total, gravar a linha. O runtime do Durable Object executa um
// objeto por vez, entao essa sequencia equivale a uma transacao: duas
// requisicoes simultaneas nao conseguem ler o mesmo total e passar as duas.
//
// A chave e sempre um identificador opaco (o HMAC do endereco de origem).
// O endereco em claro nao chega aqui, nem ao nome do objeto, nem ao SQL.

export const MAX_TENTATIVAS = 10;
// Janela deslizante: cada tentativa que conta renova o prazo.
export const JANELA_MS = 15 * 60 * 1000;
// O contador satura no limite + 1: e o que marca a origem como bloqueada.
export const TETO = MAX_TENTATIVAS + 1;

export const SQL_LER = 'SELECT tentativas, ate FROM login_tentativas WHERE chave = ?';
export const SQL_GRAVAR = 'INSERT OR REPLACE INTO login_tentativas (chave, tentativas, ate) VALUES (?, ?, ?)';
export const SQL_APAGAR = 'DELETE FROM login_tentativas WHERE chave = ?';
export const SQL_LIMPAR = 'DELETE FROM login_tentativas WHERE ate <= ?';
export const SQL_TOTAL = 'SELECT COUNT(*) AS origens, COALESCE(SUM(tentativas), 0) AS tentativas FROM login_tentativas WHERE ate > ?';
export const SQL_RESUMO = 'SELECT COUNT(*) AS origens, COALESCE(SUM(tentativas), 0) AS tentativas, MAX(ate) AS ate FROM login_tentativas WHERE ate > ?';
// A origem esta bloqueada quando ultrapassou o limite. O teto (TETO) e o
// valor em que o contador SATURA, nao o limiar do bloqueio: quem faz a
// 11a tentativa ja entra bloqueado (ver `calcularReserva`), e o contador
// para em 11. Por isso o filtro e `tentativas > MAX_TENTATIVAS`.
export const SQL_BLOQUEADAS = 'SELECT COUNT(*) AS origens FROM login_tentativas WHERE ate > ? AND tentativas > ?';

// Calcula o novo estado do contador a partir da linha atual.
//
// `atual` e a linha lida do banco (ou null quando a origem ainda nao
// tentou). A janela expirou quando `ate` ja passou: nesse caso o contador
// volta a zero antes de contar a tentativa nova.
export function calcularReserva(atual, agora, janelaMs = JANELA_MS) {
  const expirado = !atual || Number(atual.ate || 0) <= agora;
  const base = expirado ? 0 : Math.max(0, Number(atual.tentativas) || 0);
  // Ja saturado: nao renova a janela. Sem isso, quem insiste em tentar
  // manteria a origem bloqueada para sempre.
  if (base >= TETO) {
    return { tentativas: TETO, ate: Number(atual.ate) || agora, bloqueado: true, expirado };
  }
  const tentativas = base + 1;
  const janela = Math.max(1000, Number(janelaMs) || JANELA_MS);
  return {
    tentativas,
    ate: agora + janela,
    bloqueado: tentativas > MAX_TENTATIVAS,
    expirado
  };
}

// Reserva uma tentativa. `sql` precisa ter o mesmo contrato do storage do
// Durable Object: `exec(comando, ...bindings)` devolvendo um cursor com
// `toArray()`. Nao ha await entre a leitura e a escrita.
export function reservar(sql, chave, opcoes = {}) {
  const chaveNorm = String(chave || '').trim().slice(0, 64);
  if (!chaveNorm) return { ok: false, motivo: 'chave ausente', tentativas: 0, bloqueado: false };
  if (!sql || typeof sql.exec !== 'function') {
    return { ok: false, motivo: 'armazenamento indisponivel', tentativas: 0, bloqueado: false };
  }
  const agora = Number.isFinite(Number(opcoes.agora)) ? Number(opcoes.agora) : Date.now();
  const janelaMs = Number.isFinite(Number(opcoes.janela_ms)) ? Number(opcoes.janela_ms) : JANELA_MS;
  const atual = sql.exec(SQL_LER, chaveNorm).toArray()[0] || null;
  const calc = calcularReserva(atual, agora, janelaMs);
  sql.exec(SQL_GRAVAR, chaveNorm, calc.tentativas, calc.ate);
  return { ok: true, ...calc };
}

// Zera o contador de uma origem (login bem-sucedido).
export function zerar(sql, chave) {
  const chaveNorm = String(chave || '').trim().slice(0, 64);
  if (!chaveNorm || !sql || typeof sql.exec !== 'function') return false;
  sql.exec(SQL_APAGAR, chaveNorm);
  return true;
}

// Le o contador sem alterar nada (observabilidade).
export function ler(sql, chave) {
  const chaveNorm = String(chave || '').trim().slice(0, 64);
  if (!chaveNorm || !sql || typeof sql.exec !== 'function') return null;
  const linha = sql.exec(SQL_LER, chaveNorm).toArray()[0];
  if (!linha) return null;
  return { tentativas: Number(linha.tentativas) || 0, ate: Number(linha.ate) || 0 };
}

// Resumo agregado do limite, SEM identificar origem nenhuma.
//
// O painel precisa saber se a protecao esta viva. Antes nao havia como
// ver isso: o limite funcionava (ou nao) e o operador so descobria por
// tentativa e erro.
//
// Devolve apenas CONTAGENS: quantas origens estao na janela, quantas
// tentaram, quantas estao bloqueadas e quanto falta para a janela mais
// antiga expirar. Nenhuma chave, nenhuma origem, nenhum endereco.
//
// A chave e o HMAC da origem: expor a chave exporia um identificador
// estavel da origem, que e exatamente o que nao deve vazar.
export function resumo(sql, agoraMs = Date.now()) {
  if (!sql || typeof sql.exec !== 'function') return null;
  const agora = Number.isFinite(Number(agoraMs)) ? Number(agoraMs) : Date.now();
  const linha = sql.exec(SQL_RESUMO, agora).toArray()[0] || {};
  const bloqueadas = sql.exec(SQL_BLOQUEADAS, agora, MAX_TENTATIVAS).toArray()[0] || {};
  const ate = Number(linha.ate) || 0;
  return {
    origens: Number(linha.origens) || 0,
    tentativas: Number(linha.tentativas) || 0,
    bloqueadas: Number(bloqueadas.origens) || 0,
    max_tentativas: MAX_TENTATIVAS,
    janela_ms: JANELA_MS,
    // Quando a janela mais antiga expira (0 quando nao ha origem na janela).
    expira_em_ms: ate,
    expirado_em_segundos: ate ? Math.max(0, Math.round((ate - agora) / 1000)) : 0
  };
}
