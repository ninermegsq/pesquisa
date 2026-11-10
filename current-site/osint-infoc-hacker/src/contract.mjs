// Contrato de resultado das fontes e taxonomia de erros.
//
// Um unico lugar define:
//   - o formato de uma fonte consultada (id, status, erro, dados, pivos, ...);
//   - os codigos de erro possiveis e como classificar uma excecao;
//   - o que conta como falha real (relatorio parcial) contra o que e apenas
//     configuracao ausente do operador (sem chave, sem token).
//
// O contrato e validado em tempo de carga do registro e coberto por
// verification/contract-check.mjs. Nenhum modulo aqui fala com a rede.

import {ehAbort} from './lib/http.mjs';

// Codigos de erro do contrato. O valor vai para o relatorio e para o log.
export const CODIGOS_ERRO = Object.freeze([
  'sem_chave',   // credencial do operador ausente (fonte opcional)
  'sem_token',   // token de uso unico ausente, expirado ou reutilizado
  'erro_rede',   // falha de DNS, conexao ou TLS com o provedor
  'timeout',     // prazo da consulta estourado
  'http',        // o provedor respondeu com status HTTP inesperado
  'formato',     // a resposta chegou, mas nao no formato esperado
  'erro'         // qualquer outra falha
]);

// Falhas de configuracao: a fonte nao rodou porque a credencial opcional
// nao esta configurada. O restante do relatorio continua valendo e o
// resultado nao e marcado como parcial.
export const CODIGOS_DE_CONFIGURACAO = Object.freeze(['sem_chave', 'sem_token']);

export const STATUS_VALIDOS = Object.freeze(['ok', 'erro', 'timeout']);

// Erro de configuracao de uma fonte opcional. `env` e o nome da variavel
// que o operador precisa configurar no Worker.
export class FaltaChaveError extends Error {
  constructor(nomeEnv) {
    super(`sem chave: ${nomeEnv}`);
    this.name = 'FaltaChaveError';
    this.codigo = 'sem_chave';
    this.env = nomeEnv;
  }
}

// Ausencia de token de uso unico. Nao e falha de fonte: e falha de sessao.
export class FaltaTokenError extends Error {
  constructor(motivo) {
    super(motivo || 'sem token');
    this.name = 'FaltaTokenError';
    this.codigo = 'sem_token';
  }
}

const mensagemDe = e => String(e?.message || e || 'Erro desconhecido.').slice(0, 220);

// Converte qualquer excecao em {codigo, mensagem} do contrato.
export function classificarErro(e) {
  if (!e) return { codigo: 'erro', mensagem: 'Erro desconhecido.' };
  const proprio = typeof e.codigo === 'string' && CODIGOS_ERRO.includes(e.codigo) ? e.codigo : null;
  if (proprio) return { codigo: proprio, mensagem: mensagemDe(e) };
  if (ehAbort(e)) return { codigo: 'timeout', mensagem: mensagemDe(e) };
  if (Number.isFinite(e.status)) return { codigo: 'http', mensagem: mensagemDe(e) };
  const texto = mensagemDe(e);
  if (/fetch failed|failed to fetch|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|socket hang up|network error/i.test(texto))
    return { codigo: 'erro_rede', mensagem: texto };
  if (/nao-JSON|não-JSON|formato inesperado|formato invalido|invalid json/i.test(texto))
    return { codigo: 'formato', mensagem: texto };
  return { codigo: 'erro', mensagem: texto };
}

// Falha de configuracao nao vira timeout: o status continua sendo erro,
// mas com o codigo proprio, para o relatorio distinguir as duas situacoes.
export function statusDeCodigo(codigo) {
  return codigo === 'timeout' ? 'timeout' : 'erro';
}

export const ehConfiguracao = codigo => CODIGOS_DE_CONFIGURACAO.includes(String(codigo || ''));

// Aplica o contrato a um resultado de fonte. Devolve um objeto novo,
// sempre com os mesmos campos, mesmo quando o resultado veio incompleto.
export function normalizarFonte(bruto) {
  const r = bruto && typeof bruto === 'object' ? bruto : {};
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  if (!id) throw new Error('Resultado de fonte sem id.');
  const status = STATUS_VALIDOS.includes(r.status) ? r.status : 'erro';
  const codigo = typeof r.erro_codigo === 'string' && CODIGOS_ERRO.includes(r.erro_codigo) ? r.erro_codigo : null;
  const erro = r.erro == null ? null : String(r.erro).slice(0, 220);
  const dados = r.dados && typeof r.dados === 'object' && !Array.isArray(r.dados) ? r.dados : null;
  const pivos = Array.isArray(r.pivos)
    ? r.pivos
        .filter(p => p && typeof p === 'object')
        .map(p => ({ tipo: String(p.tipo || 'nome').slice(0, 32), valor: String(p.valor ?? '').slice(0, 254) }))
        .filter(p => p.valor)
    : [];
  return {
    id,
    status,
    erro,
    erro_codigo: status === 'ok' ? null : codigo,
    dados: status === 'ok' ? dados : null,
    pivos,
    provenance: typeof r.provenance === 'string' ? r.provenance : '',
    timestamp: typeof r.timestamp === 'string' ? r.timestamp : new Date().toISOString(),
    ms: Number.isFinite(r.ms) ? r.ms : 0,
    cache: r.cache === 'hit' ? 'hit' : 'miss'
  };
}

// Saude por fonte de um scan: o que respondeu, o que falhou e por que.
// `parcial` e verdadeiro somente quando houve falha real (nao por falta de
// credencial opcional do operador).
export function saudeDe(fontes) {
  const lista = Array.isArray(fontes) ? fontes : [];
  const porFonte = {};
  const indisponiveis = [];
  const porConfiguracao = [];
  let ok = 0;
  let falhas = 0;
  for (const f of lista) {
    const s = normalizarFonte(f);
    porFonte[s.id] = s.status === 'ok' ? 'ok' : s.erro_codigo || s.status;
    if (s.status === 'ok') { ok++; continue; }
    if (ehConfiguracao(s.erro_codigo)) porConfiguracao.push(s.id);
    else { falhas++; indisponiveis.push(s.id); }
  }
  return {
    por_fonte: porFonte,
    ok,
    indisponiveis,
    por_configuracao: porConfiguracao,
    parcial: falhas > 0
  };
}
