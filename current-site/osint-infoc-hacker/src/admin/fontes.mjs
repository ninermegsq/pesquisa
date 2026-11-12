// Fontes do OSINT: o catalogo (documentacao gerada no build) unido ao que o
// operador gravou no banco (o que vale de verdade em producao).
//
// Precedencia por campo:
//   1. banco    — o que o operador gravou no painel vale;
//   2. catalogo — o que o operador nao tocou (documentacao, custo, TTL,
//                  proveniencia e as explicacoes de falha).
//
// Por que existe: o painel precisa conseguir dizer "a fonte X sai pelo pool
// de proxies" e o scan precisa obedecer. Sem esta juncao, o `usa_proxy` do
// painel seria decorativo e o scan continuaria usando o valor estatico do
// catalogo.
//
// O cache e curto (60 s) porque a leitura custa uma ida ao banco. O painel
// invalida o cache no instante em que grava uma fonte.

import { CATALOGO } from './catalogo.meta.mjs';
import { rpcSegura, modoDoBanco, MODO_DESLIGADO } from './db.mjs';
import { hashDoEnv } from './credenciais.mjs';

// Campos que o operador pode mudar pelo painel. `explicacoes` fica de fora:
// a explicacao de cada codigo de falha e documentacao, mora no catalogo.
const CAMPOS = Object.freeze([
  'titulo',
  'tipos',
  'custo',
  'ttl',
  'proveniencia',
  'requer_env',
  'requer_tipo',
  'limite_minuto',
  'limite_dia',
  'limite_texto',
  'limite_origem',
  'usa_proxy',
  'observacao'
]);

const TTL_CACHE_MS = 60000;

let cache = { expira: 0, linhas: null };

export function invalidarFontes() {
  cache = { expira: 0, linhas: null };
}

// Junta o catalogo com as linhas do banco, campo a campo.
// Uma linha que nao existe no banco mantem o catalogo intacto.
// Com `comPadrao`, cada fonte ganha tambem o valor do catalogo nos campos
// que o painel edita: e o que o botao "restaurar padrao" usa.
export function mesclarFontes(catalogo, linhas, opcoes = {}) {
  const mapa = new Map((linhas || []).map(l => [String(l.id), l]));
  return (catalogo || []).map(base => {
    const linha = mapa.get(String(base.id));
    if (!linha) {
      const soCatalogo = { ...base, ajustado: false };
      if (opcoes.comPadrao) soCatalogo.padrao = padraoDe(base);
      return soCatalogo;
    }
    const saida = { ...base, ajustado: true };
    for (const campo of CAMPOS) {
      const valor = linha[campo];
      if (valor === undefined || valor === null) continue;
      saida[campo] = valor;
    }
    const expl = linha.explicacoes;
    if (expl && typeof expl === 'object' && !Array.isArray(expl) && Object.keys(expl).length) {
      saida.explicacoes = expl;
    }
    if (opcoes.comPadrao) saida.padrao = padraoDe(base);
    return saida;
  });
}

function padraoDe(base) {
  return {
    titulo: base.titulo,
    custo: base.custo,
    ttl: base.ttl,
    limite_minuto: base.limite_minuto ?? null,
    limite_dia: base.limite_dia ?? null,
    limite_texto: base.limite_texto ?? null,
    usa_proxy: Boolean(base.usa_proxy),
    observacao: base.observacao ?? null
  };
}

// Le as fontes gravadas no banco. Falha de banco nao derruba o painel:
// devolve lista vazia e o motivo, e o catalogo segue valendo.
export async function listarFontesDoBanco(env, opcoes = {}) {
  const modo = modoDoBanco(env);
  const hash = hashDoEnv(env);
  if (modo === MODO_DESLIGADO) return { linhas: [], erro: 'banco nao configurado' };
  if (!hash) return { linhas: [], erro: 'chave mestra ausente' };
  if (!opcoes.forcar && cache.expira > Date.now() && cache.linhas) {
    return { linhas: cache.linhas, erro: null };
  }
  const r = await rpcSegura(env, 'admin_fontes_leitura', { p_hash: hash });
  if (!r?.ok) return { linhas: [], erro: r?.motivo || 'leitura recusada' };
  const linhas = Array.isArray(r.fontes) ? r.fontes : [];
  cache = { expira: Date.now() + TTL_CACHE_MS, linhas };
  return { linhas, erro: null };
}

// As 32 fontes como valem agora: catalogo + operacao do painel.
export async function fontesEfetivas(env, opcoes = {}) {
  const { linhas } = await listarFontesDoBanco(env, opcoes);
  return mesclarFontes(CATALOGO, linhas, opcoes);
}

// Ids das fontes que devem sair pelo pool de proxies.
export async function fontesComProxy(env, opcoes = {}) {
  const fontes = await fontesEfetivas(env, opcoes);
  return new Set(fontes.filter(f => f.usa_proxy).map(f => f.id));
}

// Uma fonte usa proxy? O banco responde; sem banco, vale o catalogo.
export async function usaProxyDe(env, id) {
  const { linhas, erro } = await listarFontesDoBanco(env);
  if (!erro) {
    const linha = (linhas || []).find(l => String(l.id) === String(id));
    if (linha && linha.usa_proxy !== null && linha.usa_proxy !== undefined) {
      return Boolean(linha.usa_proxy);
    }
  }
  const base = CATALOGO.find(f => f.id === id);
  return Boolean(base?.usa_proxy);
}
