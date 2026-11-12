// Semeia o catalogo operacional das fontes no banco do painel admin.
//
// Por que este script existe
// -------------------------
// A semente SQL (db/migrations/0002_catalogo.sql) e gerada por
// scripts/build-catalog.mjs e serve para bancos novos. Para um banco que ja
// existe, aplicar o arquivo inteiro exige transcrever 44 KB de SQL na mao:
// qualquer virgula a mais quebra o VALUES ("VALUES lists must all be the same
// length") e um texto digitado errado entra no banco sem ninguem perceber.
//
// Este script faz o mesmo trabalho pelo caminho que o painel usa de verdade:
// PostgREST -> admin_login -> admin_fontes_salvar. O catalogo vem do modulo
// gerado (src/admin/catalogo.meta.mjs), nunca de SQL digitado a mao, entao nao
// existe classe de erro de transcricao.
//
// Uso
// ---
//   ADMIN_USUARIO=... ADMIN_SENHA=... node scripts/semear-catalogo.mjs
//   node scripts/semear-catalogo.mjs --dry-run
//
// Se ADMIN_USUARIO/ADMIN_SENHA nao estiverem no ambiente, o script le
// .local/admin.json (ignorado pelo git) no formato:
//   { "usuario": "Gui170pretty", "senha": "..." }
//
// A senha NUNCA e lida de arquivo versionado e nunca e impressa: o script
// mostra somente o usuario e o resultado.

import { rpc } from '../src/admin/db.mjs';
import { CATALOGO } from '../src/admin/catalogo.meta.mjs';
import { ambienteDoPainel } from './lib/painel-env.mjs';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { env, usuario, senha } = await ambienteDoPainel();

  if (dryRun) {
    console.log(
      JSON.stringify({
        ok: true,
        modo: 'dry-run',
        usuario,
        banco: env.SUPABASE_URL,
        fontes: CATALOGO.length
      })
    );
    return;
  }

  const login = await rpc(env, 'admin_login', {
    p_usuario: usuario,
    p_senha: senha,
    p_agente: 'semeador-catalogo',
    p_ip: '127.0.0.1'
  });
  if (!login?.ok || !login?.token) {
    throw new Error(`login recusado: ${login?.motivo || 'sem token'}`);
  }
  const token = String(login.token);

  const falhas = [];
  let gravadas = 0;
  for (const fonte of CATALOGO) {
    const r = await rpc(env, 'admin_fontes_salvar', {
      p_token: token,
      p_id: String(fonte.id),
      p_titulo: fonte.titulo == null ? null : String(fonte.titulo),
      p_tipos: Array.isArray(fonte.tipos) ? fonte.tipos.map(String) : null,
      p_custo: fonte.custo == null ? null : Number(fonte.custo),
      p_ttl: fonte.ttl == null ? null : Number(fonte.ttl),
      p_proveniencia: fonte.proveniencia == null ? null : String(fonte.proveniencia),
      p_requer_env: fonte.requer_env == null ? null : String(fonte.requer_env),
      p_requer_tipo: fonte.requer_tipo == null ? null : String(fonte.requer_tipo),
      p_limite_minuto: fonte.limite_minuto == null ? null : Number(fonte.limite_minuto),
      p_limite_dia: fonte.limite_dia == null ? null : Number(fonte.limite_dia),
      p_limite_texto: fonte.limite_texto == null ? null : String(fonte.limite_texto),
      p_limite_origem: fonte.limite_origem == null ? null : String(fonte.limite_origem),
      p_usa_proxy: fonte.usa_proxy == null ? null : !!fonte.usa_proxy,
      p_observacao: fonte.observacao == null ? null : String(fonte.observacao),
      p_explicacoes:
        fonte.explicacoes && typeof fonte.explicacoes === 'object' ? fonte.explicacoes : null
    });
    if (r?.ok) gravadas += 1;
    else falhas.push({ id: fonte.id, motivo: r?.motivo || 'recusada' });
  }

  console.log(
    JSON.stringify({
      ok: falhas.length === 0,
      usuario: login.usuario,
      fontes: CATALOGO.length,
      gravadas,
      falhas
    })
  );
  if (falhas.length) process.exitCode = 1;
}

main().catch(e => {
  console.error(JSON.stringify({ ok: false, motivo: String(e?.message || e) }));
  process.exitCode = 1;
});
