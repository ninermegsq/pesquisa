// Gerador do catalogo operacional das fontes.
//
// Duas saidas, uma unica entrada:
//   - src/sources/registry.json  -> metadados (id, tipos, custo, TTL, credencial)
//   - src/sources/limites.json    -> limites, proxy e explicacoes de falha
// Saidas:
//   - src/admin/catalogo.meta.mjs  (runtime do Worker: nao le arquivos)
//   - db/migrations/0002_catalogo.sql (semente do banco)
//
// O conteudo e deterministico (sem data, sem hash de execucao): rodar duas
// vezes produz exatamente o mesmo arquivo, e o CI detecta desatualizacao com
// `git diff --exit-code`.
//
// Uso: node scripts/build-catalog.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MANIFESTO = 'src/sources/registry.json';
export const LIMITES = 'src/sources/limites.json';
export const GERADO = 'src/admin/catalogo.meta.mjs';
export const SQL = 'db/migrations/0002_catalogo.sql';

const texto = value => JSON.stringify(value);
const literalSql = value => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
};

// Array no dialeto do Postgres: `ARRAY['email']`.
// O formato JavaScript (`['email']`) NAO e valido em SQL: a semente quebrava
// na hora de aplicar no banco (erro de sintaxe na coluna `tipos`) e o painel
// ficava sem nenhuma fonte cadastrada. O erro so aparecia no banco, nunca
// no build, por isso o formato fica verificado em `verificarSemente`.
const literalArray = valores =>
  `ARRAY[${(valores || []).map(literalSql).join(', ')}]`;

// Junta manifesto + limites e falha quando os dois nao falarem sobre as
// mesmas fontes (fonte sem limite ou limite sem fonte).
export function montarCatalogo(manifesto, limites) {
  const ids = manifesto.fontes.map(f => f.id);
  const idsLimite = Object.keys(limites.fontes || {});
  const semLimite = ids.filter(id => !idsLimite.includes(id));
  const semFonte = idsLimite.filter(id => !ids.includes(id));
  if (semLimite.length) throw new Error(`fontes sem limite declarado: ${semLimite.join(', ')}`);
  if (semFonte.length) throw new Error(`limites sem fonte no manifesto: ${semFonte.join(', ')}`);

  const fontes = manifesto.fontes.map(f => {
    const l = limites.fontes[f.id];
    const limite = l.limite || {};
    const explicacoes = { ...(limites.padroes || {}), ...(l.explicacoes || {}) };
    return {
      id: f.id,
      titulo: f.titulo,
      tipos: f.tipos,
      custo: f.custo,
      ttl: f.ttl,
      proveniencia: f.provenance,
      requer_env: f.requer ? f.requer.env : null,
      requer_tipo: f.requer ? f.requer.tipo : null,
      limite_minuto: typeof limite.por_minuto === 'number' ? limite.por_minuto : null,
      limite_dia: typeof limite.por_dia === 'number' ? limite.por_dia : null,
      limite_texto: typeof limite.texto === 'string' ? limite.texto : '',
      limite_origem: typeof limite.origem === 'string' ? limite.origem : 'nao_publicado',
      usa_proxy: l.usa_proxy === true,
      observacao: typeof l.observacao === 'string' ? l.observacao : '',
      explicacoes
    };
  });

  const canonico = JSON.stringify({ fontes, padroes: limites.padroes || {} });
  return { fontes, padroes: limites.padroes || {}, digest: createHash('sha256').update(canonico).digest('hex') };
}

export function gerarModulo(catalogo) {
  const linhas = [];
  linhas.push('// GERADO por scripts/build-catalog.mjs a partir de src/sources/registry.json e src/sources/limites.json.');
  linhas.push('// Nao edite a mao: edite as entradas e rode `npm run build`.');
  linhas.push('// Conteudo deterministico: sem data de geracao, para que o build seja idempotente.');
  linhas.push('');
  linhas.push(`export const DIGEST_CATALOGO = ${texto(catalogo.digest)};`);
  linhas.push('');
  linhas.push('export const PADROES_DE_EXPLICACAO = Object.freeze({');
  for (const [codigo, texto_] of Object.entries(catalogo.padroes)) {
    linhas.push(`  ${texto(codigo)}: ${texto(texto_)},`);
  }
  linhas.push('});');
  linhas.push('');
  linhas.push('export const CATALOGO = Object.freeze([');
  for (const fonte of catalogo.fontes) {
    linhas.push('  Object.freeze({');
    for (const [chave, valor] of Object.entries(fonte)) {
      linhas.push(`    ${chave}: ${texto(valor)},`);
    }
    linhas.push('  }),');
  }
  linhas.push(']);');
  linhas.push('');
  linhas.push('export const porId = id => CATALOGO.find(f => f.id === id) || null;');
  linhas.push('');
  return linhas.join('\n');
}

// Auto-teste da semente: garante que o SQL gerado e aplicavel no Postgres
// sem edicao manual. Cobre a classe de erro que ja passou (array no formato
// JS, invalido em SQL) e a ordem/quantidade das linhas.
export function verificarSemente(sql, fontes) {
  const linhas = sql.split('\n').filter(linha => linha.startsWith('  ('));
  if (linhas.length !== fontes.length) {
    throw new Error(`semente com ${linhas.length} linhas, esperado ${fontes.length}`);
  }
  const ids = linhas.map(linha => (/^  \('([^']*)'/.exec(linha) || [])[1]);
  const esperados = fontes.map(f => f.id);
  if (ids.join('|') !== esperados.join('|')) {
    throw new Error(`semente com ids fora de ordem: ${ids.join(', ')}`);
  }
  for (const linha of linhas) {
    if (!/^  \('[^']*', '[^']*', ARRAY\[/.test(linha)) {
      throw new Error(
        `linha da semente fora do formato do Postgres (tipos tem que ser ARRAY[...]): ${linha.slice(0, 90)}`
      );
    }
  }
  if (!/ON CONFLICT \(id\) DO UPDATE/.test(sql)) {
    throw new Error('a semente precisa ser idempotente (ON CONFLICT DO UPDATE)');
  }
  return sql;
}

export function gerarSql(catalogo) {
  const linhas = [];
  linhas.push('-- GERADO por scripts/build-catalog.mjs. Nao edite a mao.');
  linhas.push('-- Semente do catalogo operacional das fontes no painel admin.');
  linhas.push('');
  linhas.push('INSERT INTO public.admin_fontes (');
  linhas.push('  id, titulo, tipos, custo, ttl, proveniencia, requer_env, requer_tipo,');
  linhas.push('  limite_minuto, limite_dia, limite_texto, limite_origem, usa_proxy, observacao, explicacoes');
  linhas.push(') VALUES');
  const valores = catalogo.fontes.map(f => {
    const tipos = literalArray(f.tipos);
    const explicacoes = texto(f.explicacoes);
    return `  (${literalSql(f.id)}, ${literalSql(f.titulo)}, ${tipos}, ${f.custo}, ${f.ttl}, ${literalSql(f.proveniencia)}, ${literalSql(f.requer_env)}, ${literalSql(f.requer_tipo)}, ${f.limite_minuto === null ? 'NULL' : f.limite_minuto}, ${f.limite_dia === null ? 'NULL' : f.limite_dia}, ${literalSql(f.limite_texto)}, ${literalSql(f.limite_origem)}, ${f.usa_proxy}, ${literalSql(f.observacao)}, ${literalSql(explicacoes)}::jsonb)`;
  });
  linhas.push(valores.join(',\n'));
  linhas.push('ON CONFLICT (id) DO UPDATE SET');
  linhas.push('  titulo = EXCLUDED.titulo,');
  linhas.push('  tipos = EXCLUDED.tipos,');
  linhas.push('  custo = EXCLUDED.custo,');
  linhas.push('  ttl = EXCLUDED.ttl,');
  linhas.push('  proveniencia = EXCLUDED.proveniencia,');
  linhas.push('  requer_env = EXCLUDED.requer_env,');
  linhas.push('  requer_tipo = EXCLUDED.requer_tipo,');
  linhas.push('  limite_minuto = EXCLUDED.limite_minuto,');
  linhas.push('  limite_dia = EXCLUDED.limite_dia,');
  linhas.push('  limite_texto = EXCLUDED.limite_texto,');
  linhas.push('  limite_origem = EXCLUDED.limite_origem,');
  linhas.push('  usa_proxy = EXCLUDED.usa_proxy,');
  linhas.push('  observacao = EXCLUDED.observacao,');
  linhas.push('  explicacoes = EXCLUDED.explicacoes;');
  linhas.push('');
  return verificarSemente(linhas.join('\n'), catalogo.fontes);
}

export async function main() {
  const manifesto = JSON.parse(await readFile(path.join(root, MANIFESTO), 'utf8'));
  const limites = JSON.parse(await readFile(path.join(root, LIMITES), 'utf8'));
  const catalogo = montarCatalogo(manifesto, limites);

  const modulo = gerarModulo(catalogo);
  const destinoModulo = path.join(root, GERADO);
  let anterior = null;
  try { anterior = await readFile(destinoModulo, 'utf8'); } catch { /* ainda nao gerado */ }
  if (anterior !== modulo) {
    await mkdir(path.dirname(destinoModulo), { recursive: true });
    await writeFile(destinoModulo, modulo);
    console.log(`catalogo: ${GERADO} gerado a partir de ${MANIFESTO} e ${LIMITES}.`);
  } else {
    console.log(`catalogo: ${GERADO} ja esta atualizado.`);
  }

  const sql = gerarSql(catalogo);
  const destinoSql = path.join(root, SQL);
  let anteriorSql = null;
  try { anteriorSql = await readFile(destinoSql, 'utf8'); } catch { /* ainda nao gerado */ }
  if (anteriorSql !== sql) {
    await mkdir(path.dirname(destinoSql), { recursive: true });
    await writeFile(destinoSql, sql);
    console.log(`catalogo: ${SQL} gerado.`);
  } else {
    console.log(`catalogo: ${SQL} ja esta atualizado.`);
  }
  return { catalogo, modulo, sql };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
