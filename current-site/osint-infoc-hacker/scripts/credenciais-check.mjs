// Diagnostico das credenciais do operador.
//
// Este script NAO consulta a rede e NAO imprime nenhum valor de credencial.
// Ele responde apenas "a variavel esta definida?" para cada credencial
// declarada no manifesto de fontes, para que o operador saiba o que ainda
// falta configurar antes de rodar a sondagem real.
//
//   node scripts/credenciais-check.mjs
//
// Saida: JSON com uma entrada por credencial, no formato
// { nome, definida: true|false, comprimento: <n> }.
//
// O comprimento e informativo (permite confirmar que a variavel nao foi
// truncada) e nao expoe o segredo. A variavel e lida do ambiente do
// processo; nenhum arquivo do projeto guarda o valor.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(here, '..');

let credenciais = [];
try {
  const manifesto = JSON.parse(readFileSync(path.join(raiz, 'src/sources/registry.json'), 'utf8'));
  credenciais = manifesto.fontes
    .filter(f => f?.requer?.env)
    .map(f => ({ id: f.id, tipo: f.requer.tipo, env: f.requer.env }));
} catch (erro) {
  console.error(`[credenciais] manifesto ilegivel: ${erro.message}`);
  process.exit(1);
}

const linhas = credenciais.map(({ id, tipo, env }) => {
  const valor = process.env[env];
  const definida = typeof valor === 'string' && valor.trim().length > 0;
  return {
    id,
    tipo,
    env,
    definida,
    comprimento: definida ? valor.trim().length : 0
  };
});

const ausentes = linhas.filter(l => !l.definida).map(l => l.env);

console.log(JSON.stringify({
  escopo: 'LOCAL ONLY; le o ambiente, nao consulta a rede e nao imprime segredos',
  total: linhas.length,
  definidas: linhas.filter(l => l.definida).length,
  ausentes,
  credenciais: linhas
}, null, 2));

if (ausentes.length) {
  console.error(`\n[credenciais] faltam no ambiente: ${ausentes.join(', ')}`);
  console.error('[credenciais] a fonte responde sem_chave/sem_token ate a variavel existir.');
}
