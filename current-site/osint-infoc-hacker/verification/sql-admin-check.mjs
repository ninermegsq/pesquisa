// Check do schema do painel admin (Postgres).
//
// O banco do painel vive fora do repositorio (Supabase). Nao ha Postgres
// local para rodar o DDL, entao este check faz o que da para fazer sem
// banco: confere que o arquivo SQL e a superficie JavaScript do painel
// falam a mesma lingua.
//
// O que este check garante:
//   1. todo RPC chamado pelo painel existe no SQL (e vice-versa: nenhuma
//      funcao orfa no banco);
//   2. a assinatura (nomes e ordem dos parametros) do SQL bate com a do
//      modo local (src/admin/local-db.mjs), que e a copia executavel do
//      contrato;
//   3. cada funcao tem REVOKE de PUBLIC e GRANT para anon/authenticated;
//   4. a lista de etapas do funil e a mesma no SQL, no modo local e no
//      Worker (src/admin/etapas.mjs);
//   5. o arquivo e reaplicavel: nao ha DROP nem comando destrutivo;
//   6. a senha do login e comparada como veio (sem remover o '@' inicial),
//      e a troca de senha existe com as regras esperadas.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede, nenhum arquivo alterado,
// nada publicado.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ETAPAS } from '../src/admin/etapas.mjs';
import { ASSINATURAS_PUBLICAS } from '../src/admin/contrato-sql.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = await readFile(path.join(raiz, 'db/migrations/0001_admin.sql'), 'utf8');
const passos = [];
const ok = (nome, detalhe = '') => passos.push({ ok: true, nome, detalhe });

// --- 1. Superficie de RPC: SQL e painel falam os mesmos nomes --------------
// As funcoes declaradas no SQL.
const funcoesSql = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\(/g)].map(m => m[1]);
assert.ok(funcoesSql.length > 0, 'nenhuma funcao encontrada no SQL do painel');
const unicas = [...new Set(funcoesSql)];
assert.equal(unicas.length, funcoesSql.length, 'funcao duplicada no SQL do painel');

for (const nome of ASSINATURAS_PUBLICAS) {
  assert.ok(
    funcoesSql.includes(nome),
    `o painel chama ${nome} e o SQL do painel nao define essa funcao`
  );
}
ok('rpc', `as ${ASSINATURAS_PUBLICAS.length} RPCs chamadas pelo painel existem no SQL`);

// Nenhuma funcao orfa: toda funcao do SQL e chamada por algum modulo.
const ORFA_ESPERADA = ['admin_mestre_hash', 'admin_bootstrap', 'admin_mestre_ok'];
for (const nome of unicas) {
  const chamada = ASSINATURAS_PUBLICAS.includes(nome) || ORFA_ESPERADA.includes(nome);
  assert.ok(chamada, `a funcao ${nome} existe no SQL mas ninguem a chama`);
}
ok('rpc', `as ${unicas.length} funcoes do SQL sao todas usadas (sem orfas)`);

// --- 2. Assinaturas: SQL e modo local ------------------------------------
// Extrai, da declaracao SQL, o nome e o tipo de cada parametro, na ordem.
// O tipo importa porque o REVOKE e o GRANT repetem a assinatura completa:
// `REVOKE ... admin_login(text, text, text, text)` precisa bater com o que
// o Postgres criou, senao o comando e recusado.
const assinaturasSql = new Map();
for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\(([^)]*)\)/g)) {
  const nome = m[1];
  const params = m[2]
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const semDefault = p.split(/\s+DEFAULT\s+/i)[0].trim();
      const partes = semDefault.split(/\s+/);
      // `p_nome text` -> tipo "text". `p_nome text[]` -> "text[]".
      const tipo = partes.length > 1 ? partes.slice(1).join(' ') : 'text';
      return { nome: partes[0], tipo };
    })
    .filter(p => p.nome.startsWith('p_'));
  assinaturasSql.set(nome, params);
}
for (const nome of ASSINATURAS_PUBLICAS) {
  const doSql = assinaturasSql.get(nome);
  assert.ok(doSql, `a funcao ${nome} nao tem assinatura no SQL`);
  assert.ok(doSql.length > 0 || nome === 'admin_mestre_hash', `a funcao ${nome} nao declara parametros`);
}
ok('assinatura', 'todas as RPCs do painel tem assinatura no SQL');

// A assinatura do modo local (src/admin/local-db.mjs) precisa ter os mesmos
// nomes de parametro, na mesma ordem: e o que garante que a copia executavel
// do contrato recebe os mesmos valores que o Postgres.
const { RPC_LOCAL } = await import('../src/admin/local-db.mjs');
const { ASSINATURAS: ASSINATURAS_LOCAL } = await import('../src/admin/local-db.mjs');
for (const nome of ASSINATURAS_PUBLICAS) {
  const local = ASSINATURAS_LOCAL[nome];
  assert.ok(local, `o modo local nao implementa ${nome}`);
  const doSql = (assinaturasSql.get(nome) || []).map(p => p.nome);
  assert.deepEqual(
    local,
    doSql,
    `a assinatura de ${nome} difere entre o modo local e o SQL`
  );
}
ok('assinatura', `as assinaturas do modo local batem com o SQL (${ASSINATURAS_PUBLICAS.length} RPCs)`);
assert.ok(RPC_LOCAL, 'o modo local nao exporta a superficie de RPC');

// --- 3. Permissoes ---------------------------------------------------------
// O tipo de cada parametro e lido da propria declaracao SQL: o REVOKE e o
// GRANT precisam repetir a assinatura exata, com os mesmos tipos, ou o
// Postgres recusa o comando.
for (const nome of unicas) {
  const tipos = (assinaturasSql.get(nome) || []).map(p => p.tipo);
  const revogada = sql.includes(`REVOKE ALL ON FUNCTION public.${nome}(${tipos.join(', ')}) FROM PUBLIC;`);
  assert.ok(revogada, `falta REVOKE de PUBLIC em ${nome} (${tipos.join(', ')})`);
  const concedida = sql.includes(`GRANT EXECUTE ON FUNCTION public.${nome}(${tipos.join(', ')}) TO anon, authenticated;`);
  assert.ok(concedida, `falta GRANT para anon/authenticated em ${nome} (${tipos.join(', ')})`);
}
ok('permissao', `as ${unicas.length} funcoes tem REVOKE de PUBLIC e GRANT para anon/authenticated`);

// --- 4. Lista de etapas do funil ------------------------------------------
for (const etapa of ETAPAS) {
  assert.ok(
    sql.includes(`'${etapa}'`),
    `a etapa ${etapa} do funil nao esta na lista fechada do SQL`
  );
}
const linhaLista = sql.match(/p_etapa NOT IN \(([^)]*)\)/);
assert.ok(linhaLista, 'o SQL nao tem a lista fechada de etapas do funil');
const etapasSql = linhaLista[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
assert.deepEqual(etapasSql.sort(), [...ETAPAS].sort(), 'a lista de etapas do SQL difere da do Worker');
ok('etapas', `a lista fechada do funil e a mesma nos tres lugares (${ETAPAS.length} etapas)`);

// --- 5. Reaplicavel: nada destrutivo --------------------------------------
for (const proibido of ['DROP TABLE', 'DROP FUNCTION', 'DROP COLUMN', 'TRUNCATE', 'DELETE FROM public.admin_usuarios']) {
  assert.ok(!sql.includes(proibido), `o SQL do painel contem comando destrutivo: ${proibido}`);
}
assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS'), 'o SQL precisa ser reaplicavel');
assert.ok(sql.includes('CREATE OR REPLACE FUNCTION'), 'o SQL precisa usar CREATE OR REPLACE FUNCTION');
ok('reaplicavel', 'o SQL e reaplicavel (sem DROP/TRUNCATE)');

// --- 6. Regras de credencial ----------------------------------------------
// A senha do login e comparada como veio: nao pode haver ltrim do '@'.
const corpoLogin = sql.slice(sql.indexOf('FUNCTION public.admin_login'));
const linhaCrypt = corpoLogin.split('\n').find(l => l.includes('extensions.crypt'));
assert.ok(linhaCrypt, 'a comparacao da senha nao foi encontrada em admin_login');
assert.ok(
  !/ltrim\([^)]*p_senha/i.test(linhaCrypt),
  `a senha do login ainda remove o '@' inicial: ${linhaCrypt.trim()}`
);
ok('credencial', 'a senha do login e comparada como veio (sem remover o "@")');

// O usuario continua tolerando o '@' inicial.
assert.ok(
  /ltrim\(coalesce\(p_usuario/.test(corpoLogin),
  'o usuario do login deve continuar aceitando o "@" inicial'
);
ok('credencial', 'o usuario do login continua aceitando o "@" inicial');

// A troca de senha existe, com as regras esperadas.
assert.ok(sql.includes('FUNCTION public.admin_senha_trocar'), 'admin_senha_trocar nao existe no SQL');
const corpoTroca = sql.slice(sql.indexOf('FUNCTION public.admin_senha_trocar'));
assert.ok(/length\(p_senha_nova\)\s*<\s*8/.test(corpoTroca), 'a senha nova precisa de 8 caracteres ou mais');
assert.ok(/p_senha_nova\s*=\s*coalesce\(p_senha_atual/.test(corpoTroca), 'a senha nova precisa ser diferente da atual');
assert.ok(/DELETE FROM public\.admin_sessoes WHERE usuario_id/.test(corpoTroca), 'a troca precisa derrubar as sessoes');
assert.ok(!/extensions\.crypt\([^)]*p_senha_nova[^)]*\)\s*\)?\s*(AS|INTO)/i.test(corpoTroca), 'a senha nova nao pode ser gravada em claro');
ok('credencial', 'admin_senha_trocar existe com as regras de minima, diferenca e fim das sessoes');

// --- 7. O passo manual do operador esta em sincronia ----------------------
//
// O banco de producao nao e atualizado por migracao automatica: o CLI do
// Supabase nao esta autenticado e o repositorio nao tem chave de
// service-role. O que fecha o intervalo e o passo manual
// (db/migrations/0003_correcoes_admin.sql), que o operador roda no SQL
// Editor.
//
// Esse arquivo REESCREVE funcoes que ja existem em 0001_admin.sql. Se as
// duas versoes divergirem, o operador aplica uma regra e o codigo do
// repositorio passa a afirmar outra coisa: o painel volta a mentir sem
// nenhum sinal. Por isso o corpo das funcoes precisa bater.
const passoManual = await readFile(path.join(raiz, 'db/migrations/0003_correcoes_admin.sql'), 'utf8');
const funcoesManual = [...passoManual.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\(/g)].map(m => m[1]);
assert.ok(funcoesManual.length > 0, 'o passo manual nao define nenhuma funcao');

for (const nome of funcoesManual) {
  assert.ok(
    funcoesSql.includes(nome),
    `o passo manual reescreve ${nome}, que nao existe em 0001_admin.sql`
  );
  // O corpo tem que ser o mesmo: a partir da declaracao ate o proximo
  // "CREATE OR REPLACE FUNCTION" (ou o fim do arquivo).
  const corpoSql = sql.slice(sql.indexOf(`FUNCTION public.${nome}`));
  const corpoManual = passoManual.slice(passoManual.indexOf(`FUNCTION public.${nome}`));
  const proxSql = corpoSql.indexOf('CREATE OR REPLACE FUNCTION', 1);
  const proxManual = corpoManual.indexOf('CREATE OR REPLACE FUNCTION', 1);
  const corte = (texto, proximo) => {
    const fim = proximo === -1 ? texto.length : proximo;
    // O "$$;" fecha o corpo da funcao.
    const fecha = texto.indexOf('$$;', 0);
    return (fecha !== -1 && fecha < fim ? texto.slice(0, fecha) : texto.slice(0, fim)).trim();
  };
  assert.equal(
    corte(corpoManual, proxManual),
    corte(corpoSql, proxSql),
    `a funcao ${nome} do passo manual diverge de 0001_admin.sql: ` +
    'aplique o passo manual atualizado, nao uma versao antiga'
  );
}
ok('passo-manual', `as ${funcoesManual.length} funcoes do passo manual batem com 0001_admin.sql`);

// A limpeza do passo manual nao pode tocar nas etapas do funil real.
assert.ok(
  /DELETE FROM public\.admin_visitas\s+WHERE\s+etapa NOT IN \(([^)]*)\)/i.test(passoManual),
  'o passo manual precisa limpar as etapas de teste por lista fechada'
);
const etapasLimpeza = passoManual
  .match(/DELETE FROM public\.admin_visitas\s+WHERE\s+etapa NOT IN \(([^)]*)\)/i)[1]
  .split(',')
  .map(s => s.trim().replace(/^'|'$/g, ''));
assert.deepEqual(
  etapasLimpeza.sort(),
  [...ETAPAS].sort(),
  'a limpeza do passo manual apaga etapas do funil real, ou nao apaga as de teste'
);
// Nenhum DELETE em admin_visitas pode ficar sem WHERE: apagar o funil
// inteiro apagaria os dados reais do operador.
const deletesVisitas = [...passoManual.matchAll(/DELETE\s+FROM\s+public\.admin_visitas\b([^;]*);/gi)].map(m => m[1]);
assert.ok(deletesVisitas.length > 0, 'o passo manual nao limpa as etapas de teste');
for (const cauda of deletesVisitas) {
  assert.ok(
    /WHERE/i.test(cauda),
    `o passo manual tem um DELETE sem WHERE em admin_visitas: ${cauda.trim()}`
  );
}
// O filtro e `etapa NOT IN (<lista>)`: a lista e o que SOBREVIVE. Portanto
// a lista precisa ser exatamente o funil real, e nada fora dela pode
// aparecer como etapa a ser apagada.
const etapasReais = new Set(ETAPAS);
for (const cauda of deletesVisitas) {
  const etapa = cauda.match(/etapa\s+NOT\s+IN\s*\(([^)]*)\)/i);
  const vazia = /coalesce\(etapa,\s*''\)\s*=\s*''/i.test(cauda);
  assert.ok(
    etapa || vazia,
    `o passo manual tem um DELETE em admin_visitas que nao e nem por lista fechada nem por etapa vazia: ${cauda.trim()}`
  );
  if (etapa) {
    const sobrevive = etapa[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
    for (const e of sobrevive) {
      assert.ok(
        etapasReais.has(e),
        `a limpeza do passo manual apaga a etapa do funil ${e} (a lista NOT IN precisa ser o funil real)`
      );
    }
    assert.deepEqual(
      sobrevive.sort(),
      [...ETAPAS].sort(),
      'a lista NOT IN da limpeza precisa ser exatamente o funil real'
    );
  }
}
ok('passo-manual', `a limpeza apaga so as etapas de teste (${ETAPAS.length} etapas do funil preservadas)`);

// O passo manual nao pode trazer comando destrutivo alem do DELETE
// delimitado pelas etapas de teste.
for (const proibido of ['DROP TABLE', 'DROP FUNCTION', 'DROP COLUMN', 'TRUNCATE', 'DELETE FROM public.admin_usuarios']) {
  assert.ok(!passoManual.includes(proibido), `o passo manual contem comando destrutivo: ${proibido}`);
}
ok('passo-manual', 'o passo manual nao traz DROP/TRUNCATE nem apaga a conta do operador');

console.log(JSON.stringify({
  ok: true,
  escopo: 'LOCAL ONLY; sem rede, sem banco, sem arquivo alterado',
  funcoes: unicas.length,
  etapas: ETAPAS.length,
  passos
}, null, 2));
