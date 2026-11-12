// Configura a chave mestra das credenciais do painel.
//
// O que este script resolve
// -------------------------
// A chave mestra (CREDENCIAIS_MASTER_KEY) e o segredo que cifra as chaves de
// API gravadas no painel. Ela vive em DUAS lugares, e nenhum dos dois e o
// repositorio:
//   1. como segredo do Worker (Cloudflare), para que o codigo de producao
//      possa decifrar e usar as credenciais durante um scan;
//   2. como arquivo local ignorado pelo git (.local/mestre.key), para que o
//      operador nao perca o valor e possa conferir a impressao digital.
//
// O banco nunca guarda a chave: guarda apenas o SHA-256 dela (admin_config,
// chave 'mestre'), que serve para provar que quem esta falando e o mesmo
// Worker de antes.
//
// Uso
//   node scripts/configurar-mestre.mjs            // cria se preciso e aplica
//   node scripts/configurar-mestre.mjs --so-chave // so garante o arquivo local
//   node scripts/configurar-mestre.mjs --forcar    // regrava o hash no banco
//
// O script nao imprime a chave: apenas a impressao digital (SHA-256 em 12
// caracteres), que identifica o valor sem revelar nada.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_LOCAL = join(RAIZ, '.local');
const ARQ_MESTRE = join(DIR_LOCAL, 'mestre.key');
const ARQ_TOML = join(RAIZ, 'wrangler.toml');

const argumentos = process.argv.slice(2);
const soChave = argumentos.includes('--so-chave');
const forcar = argumentos.includes('--forcar');

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function lerVarDoToml(nome) {
  if (!existsSync(ARQ_TOML)) return '';
  const texto = readFileSync(ARQ_TOML, 'utf8');
  const achado = new RegExp(`^${nome}\\s*=\\s*"([^"]*)"`, 'm').exec(texto);
  return achado ? achado[1] : '';
}

const hex = bytes => Buffer.from(bytes).toString('hex');
const hash = valor => createHash('sha256').update(String(valor)).digest('hex');
const digito = valor => hash(valor).slice(0, 12);

function comandoNpm() {
  const cli = process.env.npm_execpath;
  if (cli && existsSync(cli)) return { cmd: process.execPath, prefixo: [cli] };
  return { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefixo: [] };
}

// Roda o wrangler pelo npm (sem instalar nada no repositorio).
function rodarWrangler(args, timeout = 600000) {
  const { cmd, prefixo } = comandoNpm();
  const r = spawnSync(cmd, [...prefixo, 'exec', '--yes', 'wrangler@4', '--', ...args], {
    cwd: RAIZ,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  });
  return {
    status: r.status,
    saida: `${r.stdout || ''}${r.stderr || ''}`.trim()
  };
}

// ---------------------------------------------------------------------------
// 1. Chave mestra local
// ---------------------------------------------------------------------------

if (!existsSync(DIR_LOCAL)) mkdirSync(DIR_LOCAL, { recursive: true });

let mestre = '';
if (existsSync(ARQ_MESTRE)) mestre = readFileSync(ARQ_MESTRE, 'utf8').trim();

if (!mestre) {
  mestre = hex(randomBytes(32)); // 256 bits de aleatoriedade
  writeFileSync(ARQ_MESTRE, mestre + '\n', { mode: 0o600 });
  console.log(`chave mestra gerada em .local/mestre.key (${digito(mestre)})`);
} else {
  console.log(`chave mestra existente em .local/mestre.key (${digito(mestre)})`);
}

const hashMestre = hash(mestre);
console.log(`SHA-256 (vai para o banco): ${hashMestre}`);

// ---------------------------------------------------------------------------
// 2. Registro do hash no banco
// ---------------------------------------------------------------------------

const url = String(process.env.SUPABASE_URL || lerVarDoToml('SUPABASE_URL')).replace(/\/+$/, '');
const chave = String(process.env.SUPABASE_PUBLISHABLE_KEY || lerVarDoToml('SUPABASE_PUBLISHABLE_KEY'));

if (!url || !chave) {
  console.error('SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY ausentes: defina no ambiente ou em wrangler.toml [vars].');
  process.exitCode = 1;
} else {
  const chamar = async (nome, params) => {
    const r = await fetch(`${url}/rest/v1/rpc/${nome}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: chave,
        authorization: `Bearer ${chave}`
      },
      body: JSON.stringify(params || {})
    });
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto.slice(0, 200); }
    return { status: r.status, dados };
  };

  const registrado = await chamar('admin_mestre_hash', {});
  const hashNoBanco = typeof registrado.dados === 'string' ? registrado.dados.trim() : '';
  const jaExiste = hashNoBanco.length > 0;
  const bate = jaExiste && hashNoBanco === hashMestre;

  if (bate) {
    console.log('banco: o hash da chave mestra ja esta registrado e confere.');
  } else if (jaExiste && !forcar) {
    console.error('banco: ja existe um hash de chave mestra diferente do valor local.');
    console.error('        O Worker precisa do MESMO valor: refaca o secret put com .local/mestre.key');
    console.error('        ou rode com --forcar para regravar o hash deste arquivo no banco.');
    process.exitCode = 1;
  } else {
    const boot = await chamar('admin_bootstrap', { p_hash: hashMestre });
    if (boot.dados?.ok) {
      console.log('banco: hash da chave mestra registrado.');
    } else {
      console.error(`banco: bootstrap recusado (${boot.status}): ${boot.dados?.motivo || 'sem motivo'}`);
      process.exitCode = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Segredo do Worker
// ---------------------------------------------------------------------------

if (soChave) {
  console.log('fim (--so-chave: o segredo do Worker nao foi tocado).');
} else {
  const ARQ_SECRETS = join(DIR_LOCAL, 'secrets.json');
  writeFileSync(ARQ_SECRETS, JSON.stringify({ CREDENCIAIS_MASTER_KEY: mestre }, null, 2));
  try {
    const r = rodarWrangler(['secret', 'bulk', ARQ_SECRETS]);
    console.log(`wrangler secret bulk: status ${r.status}`);
    if (r.status !== 0) {
      console.error(r.saida.slice(-1500));
      console.error('O segredo do Worker NAO foi gravado. Rode de novo depois de `npx wrangler login`.');
      process.exitCode = 1;
    } else {
      console.log(r.saida.split('\n').slice(-6).join('\n'));
      console.log('Worker: CREDENCIAIS_MASTER_KEY gravada como segredo.');
    }
  } finally {
    if (existsSync(ARQ_SECRETS)) rmSync(ARQ_SECRETS, { force: true });
  }
}

console.log(`impressao digital da chave: ${digito(mestre)}`);
