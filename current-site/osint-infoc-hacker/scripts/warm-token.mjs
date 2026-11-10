// Emite um token de operacao (aquecimento ou saude).
//
//   node scripts/warm-token.mjs --escopo operador --ttl 3600
//   node scripts/warm-token.mjs --escopo aquecimento --alvo alvo@exemplo.com --ttl 900
//   WARM_SECRET=<segredo> node scripts/warm-token.mjs --escopo operador
//
// O segredo nunca e impresso: o token sai assinado e o operador guarda o
// segredo no ambiente do Worker (HMAC_SECRET) ou em WARM_SECRET.
//
// Uso no servidor local:
//   WARM_SECRET=<segredo> node scripts/dev-server.mjs --port 3000

import { assinarTokenCalor, ESCOPOS, MAX_TTL_SEGUNDOS } from '../src/lib/warm.mjs';

const argv = process.argv.slice(2);
const opcao = (nome, alias) => {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === `--${nome}` || (alias && arg === `--${alias}`)) return argv[i + 1] ?? '';
    if (arg.startsWith(`--${nome}=`)) return arg.slice(nome.length + 3);
  }
  return '';
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log([
    'uso: node scripts/warm-token.mjs --escopo <operador|aquecimento> [--alvo <alvo>] [--ttl <segundos>] [--segredo <segredo>]',
    '',
    'o segredo vem de --segredo, de WARM_SECRET ou de HMAC_SECRET.',
    `ttl maximo: ${MAX_TTL_SEGUNDOS} segundos. escopos: ${ESCOPOS.join(', ')}.`
  ].join('\n'));
  process.exit(0);
}

const escopo = opcao('escopo', 'scope') || 'operador';
if (!ESCOPOS.includes(escopo)) {
  console.error(`escopo invalido: ${escopo}. Use ${ESCOPOS.join(' ou ')}.`);
  process.exit(1);
}

const alvo = opcao('alvo', 'target');
if (escopo === 'aquecimento' && !alvo.trim()) {
  console.error('o escopo de aquecimento exige --alvo (o token fica amarrado ao alvo).');
  process.exit(1);
}

const ttl = Number(opcao('ttl', 'exp') || 900);
if (!Number.isFinite(ttl) || ttl <= 0) {
  console.error('ttl invalido.');
  process.exit(1);
}

const segredo = opcao('segredo', 'secret') || process.env.WARM_SECRET || process.env.HMAC_SECRET || '';
if (typeof segredo !== 'string' || segredo.length < 16) {
  console.error('segredo ausente: use --segredo, WARM_SECRET ou HMAC_SECRET (minimo de 16 caracteres).');
  process.exit(1);
}

try {
  const emitido = assinarTokenCalor({ alvo: alvo.trim() || null, segredo, escopo, ttlSegundos: ttl });
  console.log(JSON.stringify({
    escopo: emitido.payload.escopo,
    exp: emitido.payload.exp,
    expira_em: emitido.expira_em,
    alvo_hash: emitido.payload.alvo_hash || null,
    token: emitido.token
  }, null, 2));
} catch (erro) {
  console.error(`falha ao assinar: ${erro.message}`);
  process.exit(1);
}
