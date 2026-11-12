// Garante que src/sources/registry.meta.mjs esteja em dia com o manifesto
// (src/sources/registry.json) antes do servidor local carregar o motor de
// fontes.
//
// Problema que este arquivo resolve:
// o manifesto e o que o operador edita e o modulo gerado e o que o runtime
// consome. Se o manifesto muda sem o build rodar, o modulo gerado fica
// velho e o carregamento falha com "fonte sem manifesto: <id>" (ou
// "credencial divergente do manifesto: <id>"). O erro acontece no import:
// o processo morre antes de abrir a porta e a previa do editor abre com
// "o servidor terminou antes de abrir a previa".
//
// A solucao e sincronizar o modulo gerado no start do servidor local. A
// operacao nunca pode derrubar o servidor: o manifesto invalido ou o
// filesystem somente-leitura sao registrados e o modulo gerado e carregado
// como estiver.
//
// A escrita e atomica (arquivo temporario + rename): um processo morto no
// meio da escrita nunca deixa o modulo pela metade.

import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GERADO, MANIFESTO, gerarMeta, root } from './build-registry.mjs';
import { GERADO as GERADO_CATALOGO, LIMITES, gerarModulo, montarCatalogo } from './build-catalog.mjs';

// Sincroniza o modulo gerado com o manifesto.
// Devolve { atualizado: boolean, motivo: string } e nunca lanca.
export async function sincronizarManifesto({ silencioso = false } = {}) {
  const destino = path.join(root, GERADO);
  try {
    const manifesto = JSON.parse(await readFile(path.join(root, MANIFESTO), 'utf8'));
    const conteudo = gerarMeta(manifesto);
    let anterior = null;
    try { anterior = await readFile(destino, 'utf8'); } catch { /* ainda nao gerado */ }
    if (anterior === conteudo) return { atualizado: false, motivo: 'em dia' };
    const temporario = `${destino}.tmp`;
    await writeFile(temporario, conteudo, 'utf8');
    await rename(temporario, destino);
    if (!silencioso) console.error(`[dev] registro: ${GERADO} regerado a partir de ${MANIFESTO}.`);
    return { atualizado: true, motivo: 'manifesto sincronizado' };
  } catch (erro) {
    // Falha aqui nao pode derrubar o servidor: o modulo gerado e carregado
    // como estiver e o proprio modulo explica o problema exato.
    if (!silencioso) console.error(`[dev] registro: nao foi possivel sincronizar ${GERADO}: ${erro.message}`);
    return { atualizado: false, motivo: erro.message };
  }
}

// Sincroniza o catalogo operacional (src/admin/catalogo.meta.mjs) a partir do
// manifesto e dos limites declarados.
//
// Motivo: o modulo e importado por src/scan.mjs. Se ele nao existir, o motor
// de fontes nao carrega, o processo morre antes de abrir a porta e a previa do
// editor abre com "o servidor terminou antes de abrir a previa".
export async function sincronizarCatalogo({ silencioso = false } = {}) {
  const destino = path.join(root, GERADO_CATALOGO);
  try {
    const manifesto = JSON.parse(await readFile(path.join(root, MANIFESTO), 'utf8'));
    const limites = JSON.parse(await readFile(path.join(root, LIMITES), 'utf8'));
    const conteudo = gerarModulo(montarCatalogo(manifesto, limites));
    let anterior = null;
    try { anterior = await readFile(destino, 'utf8'); } catch { /* ainda nao gerado */ }
    if (anterior === conteudo) return { atualizado: false, motivo: 'em dia' };
    const temporario = `${destino}.tmp`;
    await writeFile(temporario, conteudo, 'utf8');
    await rename(temporario, destino);
    if (!silencioso) console.error(`[dev] registro: ${GERADO_CATALOGO} regerado a partir de ${MANIFESTO} e ${LIMITES}.`);
    return { atualizado: true, motivo: 'catalogo sincronizado' };
  } catch (erro) {
    if (!silencioso) console.error(`[dev] registro: nao foi possivel sincronizar ${GERADO_CATALOGO}: ${erro.message}`);
    return { atualizado: false, motivo: erro.message };
  }
}
