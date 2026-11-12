// Configuracao compartilhada dos scripts que falam com o painel admin.
//
// Reune a leitura do ambiente (variaveis de processo ou .local/admin.json)
// e do wrangler.toml [vars] para que o semeador e a verificacao ao vivo
// usem exatamente a mesma origem de dados do Worker.
//
// A senha do painel NUNCA vem de arquivo versionado: ela vem do ambiente
// ou de .local/admin.json, que o .gitignore ja exclui.

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const RAIZ_DO_SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function lerVarDoToml(nome) {
  const arquivo = join(RAIZ_DO_SITE, 'wrangler.toml');
  if (!existsSync(arquivo)) return '';
  const texto = readFileSync(arquivo, 'utf8');
  const re = new RegExp(`^${nome}\\s*=\\s*"([^"]*)"`, 'm');
  const achado = re.exec(texto);
  return achado ? achado[1] : '';
}

export async function credenciaisLocais() {
  const arquivo = join(RAIZ_DO_SITE, '.local', 'admin.json');
  if (!existsSync(arquivo)) return { usuario: '', senha: '' };
  try {
    const dados = JSON.parse(await readFile(arquivo, 'utf8'));
    return { usuario: String(dados.usuario || ''), senha: String(dados.senha || '') };
  } catch (e) {
    throw new Error(`.local/admin.json invalido: ${String(e?.message || e)}`);
  }
}

// Ambiente minimo para as chamadas PostgREST do painel.
export async function ambienteDoPainel() {
  const local = await credenciaisLocais();
  const env = {
    SUPABASE_URL: String(process.env.SUPABASE_URL || lerVarDoToml('SUPABASE_URL')),
    SUPABASE_PUBLISHABLE_KEY: String(
      process.env.SUPABASE_PUBLISHABLE_KEY || lerVarDoToml('SUPABASE_PUBLISHABLE_KEY')
    )
  };
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      'SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY ausentes: defina no ambiente ou em wrangler.toml [vars].'
    );
  }
  const usuario = String(process.env.ADMIN_USUARIO || local.usuario || '');
  const senha = String(process.env.ADMIN_SENHA || local.senha || '');
  if (!usuario || !senha) {
    throw new Error(
      'credenciais do painel ausentes: use ADMIN_USUARIO/ADMIN_SENHA no ambiente ou .local/admin.json.'
    );
  }
  return { env, usuario, senha };
}
