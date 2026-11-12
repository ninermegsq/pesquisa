// Credenciais de API: leitura, gravacao e a sobreposicao do banco sobre o
// ambiente do Worker.
//
// Precedencia (a mais forte vence):
//   1. banco (painel admin) — valor cifrado com AES-256-GCM;
//   2. variavel de ambiente do Worker (secret do Cloudflare);
//   3. ausente — a fonte responde com o codigo de contrato "sem_chave".
//
// O valor em claro nunca e devolvido pela leitura: a interface recebe a
// mascara (primeiros e ultimos caracteres) e a impressao digital (SHA-256
// parcial), que bastam para o operador conferir qual chave esta em uso.

import { rpc, rpcSegura, modoDoBanco, MODO_DESLIGADO } from './db.mjs';
import { chaveMestreDe, hashMestre, cifrar, decifrar, mascarar, impressao } from './cripto.mjs';
import { CATALOGO, porId } from './catalogo.meta.mjs';

export const STATUS = Object.freeze(['ativa', 'inativa', 'expirada', 'sem_chave']);

// Cache curto das credenciais decifradas: um scan nao deve ler o banco a
// cada requisicao de fonte. 30 segundos e o prazo; o painel invalida o cache
// quando grava ou remove uma chave.
let cacheChaves = { expira: 0, valores: {} };

export function invalidarCredenciais() {
  cacheChaves = { expira: 0, valores: {} };
}

// A chave mestra do Worker (ou a efemera do modo local).
export function chaveMestreDeEnv(env) {
  return chaveMestreDe(env);
}

// Hash da chave mestra: e o que o banco guarda para conferir a identidade.
export function hashDoEnv(env) {
  const chave = chaveMestreDe(env);
  return chave ? hashMestre(chave) : null;
}

// Garante que o banco conheca o hash da chave mestra (idempotente).
export async function asegurarMestre(env) {
  const hash = hashDoEnv(env);
  if (!hash) return { ok: false, motivo: 'chave mestra ausente' };
  const r = await rpcSegura(env, 'admin_bootstrap', { p_hash: hash });
  return r?.ok ? r : { ok: false, motivo: r?.motivo || 'bootstrap recusado' };
}

// Registro do hash da chave mestra no banco, uma vez por isolate.
//
// Sem isso, `admin_credenciais_leitura` recusa a leitura (o banco compara o
// hash recebido com o hash ja registrado) e o painel mostra todas as chaves
// como ausentes, mesmo com a credencial gravada. O bootstrap e idempotente:
// so grava quando o banco ainda nao tem hash; depois disso so devolve
// verdadeiro quando o hash bate.
let mestreRegistrado = { hash: '', ok: false };

export function invalidarMestre() {
  mestreRegistrado = { hash: '', ok: false };
}

async function garantirMestreRegistrado(env) {
  const hash = hashDoEnv(env);
  if (!hash) return false;
  if (mestreRegistrado.hash === hash) return mestreRegistrado.ok;
  const r = await rpcSegura(env, 'admin_bootstrap', { p_hash: hash });
  const ok = Boolean(r?.ok);
  mestreRegistrado = { hash, ok };
  return ok;
}

// Lista as credenciais por fonte, juntando banco, ambiente e catalogo.
export async function listarCredenciais(env) {
  const modo = modoDoBanco(env);
  const hash = hashDoEnv(env);
  let doBanco = [];
  let erroBanco = null;
  if (modo !== MODO_DESLIGADO && hash) {
    await garantirMestreRegistrado(env);
    const r = await rpcSegura(env, 'admin_credenciais_leitura', { p_hash: hash });
    if (r?.ok) doBanco = Array.isArray(r.credenciais) ? r.credenciais : [];
    else erroBanco = r?.motivo || 'leitura recusada';
  }

  const porFonte = new Map();
  for (const c of doBanco) {
    const claro = decifrar(c.ciphertext, chaveMestreDeEnv(env));
    porFonte.set(c.fonte, {
      fonte: c.fonte,
      envname: c.envname,
      status: c.status || 'ativa',
      origem: 'banco',
      decifravel: claro !== null,
      mascara: claro === null ? null : mascarar(claro),
      impressao: claro === null ? null : impressao(claro),
      limite_minuto: c.limite_minuto ?? null,
      limite_dia: c.limite_dia ?? null,
      observacao: c.observacao ?? null,
      ultimo_uso: c.ultimo_uso ?? null,
      total_usos: c.total_usos ?? 0
    });
  }

  // Fontes do catalogo que pedem credencial: mostram o estado real, mesmo
  // quando a chave esta no ambiente em vez do banco.
  for (const entrada of CATALOGO) {
    if (!entrada.requer_env) continue;
    if (porFonte.has(entrada.id)) continue;
    const doAmbiente = String(env?.[entrada.requer_env] || '').trim();
    porFonte.set(entrada.id, {
      fonte: entrada.id,
      envname: entrada.requer_env,
      status: doAmbiente ? 'ativa' : 'sem_chave',
      origem: doAmbiente ? 'ambiente' : 'ausente',
      decifravel: false,
      mascara: doAmbiente ? mascarar(doAmbiente) : null,
      impressao: doAmbiente ? impressao(doAmbiente) : null,
      limite_minuto: entrada.limite_minuto ?? null,
      limite_dia: entrada.limite_dia ?? null,
      observacao: entrada.observacao || null,
      ultimo_uso: null,
      total_usos: 0
    });
  }

  const lista = [...porFonte.values()].sort((a, b) => a.fonte.localeCompare(b.fonte));
  return { credenciais: lista, erro: erroBanco, banco: modo };
}

// Sobrescreve o ambiente com as credenciais do banco.
// Devolve um env novo (o original nao e alterado) e o relatorio do que veio
// de onde.
export async function aplicarCredenciais(env) {
  const hash = hashDoEnv(env);
  if (!hash) return { env, aplicadas: [], motivo: 'chave mestra ausente' };
  if (cacheChaves.expira > Date.now()) {
    const novo = { ...env };
    const aplicadas = [];
    for (const [envname, valor] of Object.entries(cacheChaves.valores)) {
      novo[envname] = valor;
      aplicadas.push({ envname });
    }
    return { env: novo, aplicadas, motivo: null };
  }
  await garantirMestreRegistrado(env);
  const r = await rpcSegura(env, 'admin_credenciais_leitura', { p_hash: hash });
  if (!r?.ok) return { env, aplicadas: [], motivo: r?.motivo || 'leitura recusada' };
  const novo = { ...env };
  const aplicadas = [];
  const valores = {};
  for (const c of Array.isArray(r.credenciais) ? r.credenciais : []) {
    if (c.status === 'inativa') continue;
    const claro = decifrar(c.ciphertext, chaveMestreDeEnv(env));
    if (claro === null) continue;
    novo[c.envname] = claro;
    valores[c.envname] = claro;
    aplicadas.push({ fonte: c.fonte, envname: c.envname });
  }
  cacheChaves = { expira: Date.now() + 30000, valores };
  return { env: novo, aplicadas, motivo: null };
}

// Grava (ou substitui) a credencial de uma fonte.
export async function salvarCredencial(env, token, dados) {
  const chave = chaveMestreDeEnv(env);
  if (!chave) return { ok: false, motivo: 'CREDENCIAIS_MASTER_KEY nao configurada no Worker.' };
  const fonte = String(dados?.fonte || '').trim();
  if (!fonte) return { ok: false, motivo: 'fonte obrigatoria' };
  const valor = String(dados?.valor ?? '');
  if (!valor) return { ok: false, motivo: 'valor da credencial obrigatorio' };
  const entrada = porId(fonte);
  const envname = String(dados?.envname || entrada?.requer_env || fonte).trim();
  const ciphertext = cifrar(valor, chave);
  const status = STATUS.includes(dados?.status) ? dados.status : 'ativa';
  const r = await rpcSegura(env, 'admin_credenciais_salvar', {
    p_token: token,
    p_fonte: fonte,
    p_envname: envname,
    p_ciphertext: ciphertext,
    p_status: status,
    p_limite_minuto: Number.isFinite(Number(dados?.limite_minuto)) ? Number(dados.limite_minuto) : null,
    p_limite_dia: Number.isFinite(Number(dados?.limite_dia)) ? Number(dados.limite_dia) : null,
    p_observacao: dados?.observacao ? String(dados.observacao).slice(0, 300) : null
  });
  if (!r?.ok) return { ok: false, motivo: r?.motivo || 'gravacao recusada' };
  invalidarCredenciais();
  return { ok: true, fonte, envname, status };
}

// Remove a credencial de uma fonte (volta a depender do ambiente).
export async function removerCredencial(env, token, fonte) {
  const r = await rpcSegura(env, 'admin_credenciais_apagar', { p_token: token, p_fonte: String(fonte || '') });
  if (!r?.ok) return { ok: false, motivo: r?.motivo || 'exclusao recusada' };
  invalidarCredenciais();
  return { ok: true };
}

// Conta o uso de uma credencial (chamada best effort durante o scan).
export async function registrarUso(env, fonte) {
  const hash = hashDoEnv(env);
  if (!hash) return { ok: false };
  return rpcSegura(env, 'admin_credenciais_uso', { p_hash: hash, p_fonte: String(fonte || '') });
}
