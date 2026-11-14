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

// Campos que o operador pode mudar pelo painel.
//
// `explicacoes` NAO entra nesta lista: e um objeto indexado por codigo de
// falha, e nao um campo escalar. Ele tem um bloco proprio (abaixo), que mescla
// por codigo em vez de substituir. Incluir o nome aqui seria inerte (o bloco
// proprio roda depois e sobrescreveria o valor) e perigoso, porque uma
// substituicao integral apagaria a documentacao dos codigos que o operador
// nao tocou. O catalogo continua sendo a base: cada codigo de falha que o
// operador nao mexeu mantem a documentacao original.
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
//
// `ajustado` significa "o valor efetivo difere do catalogo". A tabela
// `admin_fontes` e populada pela semente com os mesmos valores do catalogo,
// entao a presenca da linha nao prova que o operador mexeu em algo: sem essa
// distincao o painel anunciaria "32 de 32 ajustadas" num banco intocado.
export function mesclarFontes(catalogo, linhas, opcoes = {}) {
  const mapa = new Map((linhas || []).map(l => [String(l.id), l]));
  return (catalogo || []).map(base => {
    const linha = mapa.get(String(base.id));
    if (!linha) {
      const soCatalogo = { ...base, ajustado: false };
      if (opcoes.comPadrao) soCatalogo.padrao = padraoDe(base);
      return soCatalogo;
    }
    const saida = { ...base };
    let alterado = false;
    for (const campo of CAMPOS) {
      const valor = linha[campo];
      if (valor === undefined || valor === null) continue;
      if (!mesmoValor(valor, base[campo])) alterado = true;
      saida[campo] = valor;
    }
    const expl = linha.explicacoes;
    if (expl && typeof expl === 'object' && !Array.isArray(expl) && Object.keys(expl).length) {
      // Mesclagem por codigo: o que o operador gravou para um codigo de falha
      // vale sobre o catalogo; os codigos que ele nao tocou continuam com a
      // documentacao original. Substituir o objeto inteiro apagaria a
      // documentacao dos codigos que o operador nao conhece.
      const fundido = { ...(base.explicacoes || {}), ...expl };
      if (!mesmoValor(fundido, base.explicacoes)) alterado = true;
      saida.explicacoes = fundido;
    }
    saida.ajustado = alterado;
    if (opcoes.comPadrao) saida.padrao = padraoDe(base);
    return saida;
  });
}

// Compara dois valores de campo como o banco os devolve (arrays de texto,
// numeros, booleanos) contra o catalogo. Sem normalizacao, `['email']` e
// `['email']` vindos de JSON diferentes seriam comparados como diferentes.
function mesmoValor(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => String(v) === String(b[i]));
  }
  // Objetos (as explicacoes de falha, indexadas por codigo): sem este ramo o
  // fallback `String(a) === String(b)` compararia "[object Object]" com
  // "[object Object]" e devolveria sempre verdadeiro. O resultado era uma
  // fonte cujo texto de explicacao mudou continuar marcada como nao
  // ajustada, e o contador de fontes ajustadas do painel nunca contava nada.
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    return ka.every((k, i) => kb[i] === k && mesmoValor(a[k], b[k]));
  }
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a) === String(b);
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
    observacao: base.observacao ?? null,
    // As explicacoes de falha tambem voltam ao texto do catalogo: o painel
    // anuncia "restaurar padrao" para o conjunto de campos da fonte.
    explicacoes: { ...(base.explicacoes || {}) }
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
