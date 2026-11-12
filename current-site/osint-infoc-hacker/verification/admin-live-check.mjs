// Verificacao ao vivo do painel admin contra o banco de verdade.
//
// Online de proposito: entra com as credenciais do operador, le o painel
// (admin_painel) e compara, campo a campo, as 32 fontes gravadas no banco
// com o catalogo gerado em src/admin/catalogo.meta.mjs. Serve para provar
// que o que o operador ve no painel e o que o catalogo manda (e que nada
// foi digitado a mao na hora de semear).
//
// Nao entra na cadeia `npm test`: precisa de rede e de credenciais.
//   node verification/admin-live-check.mjs

import { rpc } from '../src/admin/db.mjs';
import { CATALOGO } from '../src/admin/catalogo.meta.mjs';
import { ambienteDoPainel } from '../scripts/lib/painel-env.mjs';

const CAMPOS = [
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
];

function igual(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((v, i) => String(v) === String(b[i]));
  }
  if (typeof a === 'object' || typeof b === 'object') {
    if (!a || !b) return false;
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join('|') !== kb.join('|')) return false;
    return ka.every(k => String(a[k]) === String(b[k]));
  }
  return String(a) === String(b);
}

async function main() {
  const { env, usuario, senha } = await ambienteDoPainel();
  const login = await rpc(env, 'admin_login', {
    p_usuario: usuario,
    p_senha: senha,
    p_agente: 'verificacao-admin',
    p_ip: '127.0.0.1'
  });
  if (!login?.ok || !login?.token) {
    throw new Error(`login recusado: ${login?.motivo || 'sem token'}`);
  }
  const painel = await rpc(env, 'admin_painel', { p_token: String(login.token), p_dias: 30 });
  if (!painel?.ok) throw new Error(`painel recusado: ${painel?.motivo || 'sem motivo'}`);

  const linhas = new Map((painel.fontes || []).map(l => [String(l.id), l]));
  const divergencias = [];
  for (const base of CATALOGO) {
    const linha = linhas.get(String(base.id));
    if (!linha) {
      divergencias.push({ id: base.id, campo: 'id', esperado: base.id, recebido: null });
      continue;
    }
    for (const campo of CAMPOS) {
      if (!igual(base[campo], linha[campo])) {
        divergencias.push({
          id: base.id,
          campo,
          esperado: base[campo],
          recebido: linha[campo]
        });
      }
    }
    if (!igual(base.explicacoes, linha.explicacoes)) {
      divergencias.push({ id: base.id, campo: 'explicacoes', esperado: '(objeto)', recebido: '(diferente)' });
    }
  }
  const sobrando = [...linhas.keys()].filter(id => !CATALOGO.some(f => f.id === id));

  const resultado = {
    ok: divergencias.length === 0 && sobrando.length === 0,
    usuario: login.usuario,
    fontes_catalogo: CATALOGO.length,
    fontes_banco: linhas.size,
    divergencias: divergencias.slice(0, 20),
    fora_do_catalogo: sobrando,
    com_proxy: CATALOGO.filter(f => f.usa_proxy).map(f => f.id),
    master_key_configurada: !!painel.mestre_configurado,
    funil: Object.keys(painel.visitas || {}).length
      ? painel.visitas
      : 'sem visitas registradas ainda'
  };
  console.log(JSON.stringify(resultado));
  if (!resultado.ok) process.exitCode = 1;
}

main().catch(e => {
  console.error(JSON.stringify({ ok: false, motivo: String(e?.message || e) }));
  process.exitCode = 1;
});
