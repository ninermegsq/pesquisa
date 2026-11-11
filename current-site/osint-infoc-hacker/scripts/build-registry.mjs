// Gerador de src/sources/registry.meta.mjs a partir de src/sources/registry.json.
//
// Por que existe: o Worker nao consegue ler arquivos no runtime e importar
// JSON com `import ... with {type:'json'}` exige Node >= 20.10 e pode
// quebrar o empacotador do Wrangler. O manifesto continua sendo um JSON
// legivel e editavel; o modulo gerado e o que o runtime consome.
//
// O arquivo gerado e deterministico (sem data, sem hash de execucao): rodar o
// gerador duas vezes produz exatamente o mesmo conteudo, e por isso o CI
// consegue detectar manifesto desatualizado com `git diff --exit-code`.
//
// Uso: node scripts/build-registry.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MANIFESTO = 'src/sources/registry.json';
export const GERADO = 'src/sources/registry.meta.mjs';

// Tipos de alvo suportados pelo scanner (src/lib/alvo.mjs).
export const TIPOS_VALIDOS = Object.freeze(['email', 'telefone', 'dominio', 'ip', 'cnpj', 'cpf', 'placa', 'nome']);
export const TIPOS_DE_CREDENCIAL = Object.freeze(['chave', 'token']);

const texto = value => JSON.stringify(value);

// Valida o manifesto e devolve a lista normalizada das fontes.
// Lanca Error com mensagem objetiva quando algo esta inconsistente.
export function validarManifesto(manifesto) {
  if (!manifesto || typeof manifesto !== 'object') throw new Error('manifesto invalido: objeto esperado');
  if (!Number.isInteger(manifesto.versao) || manifesto.versao < 1) throw new Error('manifesto invalido: versao ausente');
  if (!Array.isArray(manifesto.fontes) || manifesto.fontes.length === 0) throw new Error('manifesto invalido: fontes vazias');

  const vistos = new Set();
  const fontes = manifesto.fontes.map((fonte, indice) => {
    const onde = `fonte #${indice}`;
    if (!fonte || typeof fonte !== 'object') throw new Error(`${onde}: objeto esperado`);
    const id = typeof fonte.id === 'string' ? fonte.id.trim() : '';
    if (!/^[a-z0-9_]{2,32}$/.test(id)) throw new Error(`${onde}: id invalido (${JSON.stringify(fonte.id)})`);
    if (vistos.has(id)) throw new Error(`${onde}: id duplicado (${id})`);
    vistos.add(id);
    if (!Array.isArray(fonte.tipos) || fonte.tipos.length === 0) throw new Error(`${id}: tipos ausentes`);
    for (const tipo of fonte.tipos) {
      if (!TIPOS_VALIDOS.includes(tipo)) throw new Error(`${id}: tipo invalido (${tipo})`);
    }
    if (!Number.isInteger(fonte.custo) || fonte.custo < 0) throw new Error(`${id}: custo invalido`);
    if (!Number.isInteger(fonte.ttl) || fonte.ttl < 0) throw new Error(`${id}: ttl invalido`);
    if (typeof fonte.provenance !== 'string' || !fonte.provenance.trim()) throw new Error(`${id}: provenance ausente`);
    if (typeof fonte.chave !== 'boolean') throw new Error(`${id}: campo "chave" deve ser booleano`);
    let requer = null;
    if (fonte.requer != null) {
      const tipo = fonte.requer?.tipo;
      const env = fonte.requer?.env;
      if (!TIPOS_DE_CREDENCIAL.includes(tipo)) throw new Error(`${id}: requer.tipo invalido (${tipo})`);
      if (typeof env !== 'string' || !/^[A-Z][A-Z0-9_]{2,40}$/.test(env)) throw new Error(`${id}: requer.env invalido (${env})`);
      // `opcional: true` marca a credencial que apenas melhora o resultado:
      // a fonte continua funcionando pelo caminho publico quando ela falta.
      requer = { tipo, env, opcional: fonte.requer?.opcional === true };
    }
    return {
      id,
      titulo: typeof fonte.titulo === 'string' && fonte.titulo.trim() ? fonte.titulo.trim() : id,
      tipos: [...fonte.tipos],
      custo: fonte.custo,
      ttl: fonte.ttl,
      provenance: fonte.provenance.trim(),
      chave: fonte.chave,
      requer
    };
  });

  const chavesVisitante = fontes.filter(f => f.chave === true);
  if (chavesVisitante.length) {
    throw new Error(`o manifesto exige chave do visitante em ${chavesVisitante.map(f => f.id).join(', ')}: o produto nao pede chave ao visitante`);
  }

  const ids = fontes.map(f => f.id);
  if (new Set(ids).size !== ids.length) throw new Error('ids duplicados no manifesto');
  return { versao: manifesto.versao, fontes };
}

// Conteudo deterministico do modulo gerado.
export function gerarMeta(manifesto) {
  const { versao, fontes } = validarManifesto(manifesto);
  const canonico = JSON.stringify({ versao, fontes });
  const digest = createHash('sha256').update(canonico).digest('hex');
  const linhas = [];
  linhas.push('// GERADO por scripts/build-registry.mjs a partir de src/sources/registry.json.');
  linhas.push('// Nao edite a mao: edite o manifesto e rode `npm run build`.');
  linhas.push('// Conteudo deterministico: sem data de geracao, para que o build seja idempotente.');
  linhas.push('');
  linhas.push(`export const REGISTRY_META = Object.freeze({`);
  linhas.push(`  versao: ${versao},`);
  linhas.push(`  digest: ${texto(digest)},`);
  linhas.push('  fontes: Object.freeze({');
  for (const fonte of fontes) {
    linhas.push(`    ${texto(fonte.id)}: Object.freeze({`);
    linhas.push(`      id: ${texto(fonte.id)},`);
    linhas.push(`      titulo: ${texto(fonte.titulo)},`);
    linhas.push(`      tipos: Object.freeze(${texto(fonte.tipos)}),`);
    linhas.push(`      custo: ${fonte.custo},`);
    linhas.push(`      ttl: ${fonte.ttl},`);
    linhas.push(`      provenance: ${texto(fonte.provenance)},`);
    linhas.push(`      chave: ${fonte.chave},`);
    linhas.push(`      requer: ${fonte.requer === null ? 'null' : `Object.freeze(${texto(fonte.requer)})`}`);
    linhas.push('    }),');
  }
  linhas.push('  })');
  linhas.push('});');
  linhas.push('');
  return linhas.join('\n');
}

export async function main() {
  const manifesto = JSON.parse(await readFile(path.join(root, MANIFESTO), 'utf8'));
  const conteudo = gerarMeta(manifesto);
  const destino = path.join(root, GERADO);
  let anterior = null;
  try { anterior = await readFile(destino, 'utf8'); } catch { /* ainda nao gerado */ }
  if (anterior === conteudo) {
    console.log(`registro: ${GERADO} ja esta atualizado.`);
    return conteudo;
  }
  await writeFile(destino, conteudo);
  console.log(`registro: ${GERADO} gerado a partir de ${MANIFESTO}.`);
  return conteudo;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
