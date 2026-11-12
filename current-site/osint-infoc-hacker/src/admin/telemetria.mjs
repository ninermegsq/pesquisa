// Telemetria: o fluxo de visitas, o fluxo de falhas e os eventos do painel.
//
// O que entra no funil:
//   visita        -> a pessoa abriu o site;
//   scan          -> a pessoa iniciou um scan;
//   scan_concluido-> o scan terminou (com ou sem falha);
//   falha         -> uma fonte falhou (com o codigo do contrato);
//   exportacao    -> o resultado foi exportado.
//
// O IP nunca e gravado em claro: entra apenas o SHA-256 do IP com sal (o
// segredo HMAC do Worker), que serve para contar visitantes distintos sem
// guardar endereco.

import { createHash, createHmac } from 'node:crypto';
import { rpcSegura } from './db.mjs';
import { hashDoEnv } from './credenciais.mjs';

export const ETAPAS = Object.freeze(['visita', 'scan', 'scan_concluido', 'falha', 'exportacao']);

export function hashIp(ip, env) {
  const bruto = String(ip || '').trim();
  if (!bruto) return null;
  const sal = String(env?.HMAC_SECRET || env?.WARM_SECRET || 'osint-local');
  return createHmac('sha256', sal).update(bruto).digest('hex').slice(0, 32);
}

// Registra uma etapa do funil. Best effort: nunca lanca, nunca demora.
export async function registrar(env, dados = {}) {
  const hash = hashDoEnv(env);
  if (!hash) return { ok: false, motivo: 'chave mestra ausente' };
  const etapa = String(dados.etapa || '').slice(0, 40);
  if (!ETAPAS.includes(etapa)) return { ok: false, motivo: 'etapa invalida' };
  try {
    return await rpcSegura(env, 'admin_registrar_visita', {
      p_hash: hash,
      p_etapa: etapa,
      p_alvo_tipo: dados.alvo_tipo ? String(dados.alvo_tipo).slice(0, 40) : null,
      p_fonte: dados.fonte ? String(dados.fonte).slice(0, 64) : null,
      p_codigo: dados.codigo ? String(dados.codigo).slice(0, 40) : null,
      p_ok: dados.ok === undefined || dados.ok === null ? null : !!dados.ok,
      p_ms: Number.isFinite(Number(dados.ms)) ? Number(dados.ms) : null,
      p_job_id: dados.job_id || null,
      p_ip_hash: hashIp(dados.ip, env),
      p_agente: dados.agente ? String(dados.agente).slice(0, 200) : null
    });
  } catch (e) {
    return { ok: false, motivo: String(e?.message || e) };
  }
}

// Registra um evento do painel (erro de origem, credencial ausente etc.).
export async function registrarEvento(env, dados = {}) {
  const hash = hashDoEnv(env);
  if (!hash) return { ok: false, motivo: 'chave mestra ausente' };
  try {
    return await rpcSegura(env, 'admin_registrar_evento', {
      p_hash: hash,
      p_tipo: String(dados.tipo || 'evento').slice(0, 40),
      p_fonte: dados.fonte ? String(dados.fonte).slice(0, 64) : null,
      p_codigo: dados.codigo ? String(dados.codigo).slice(0, 40) : null,
      p_mensagem: dados.mensagem ? String(dados.mensagem).slice(0, 300) : null,
      p_detalhe: dados.detalhe ?? null
    });
  } catch (e) {
    return { ok: false, motivo: String(e?.message || e) };
  }
}

// Dispara o registro sem esperar (usado no caminho quente do scan).
export function registrarEmBackground(env, dados, waitUntil = null) {
  const promessa = registrar(env, dados).catch(() => ({ ok: false }));
  if (typeof waitUntil === 'function') {
    try { waitUntil(promessa); return null; } catch { /* segue sem waitUntil */ }
  }
  return promessa;
}
