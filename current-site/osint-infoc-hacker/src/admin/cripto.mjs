// Cifra das credenciais de API antes de elas irem para o banco.
//
// Onde fica o segredo:
//   - a chave mestra (CREDENCIAIS_MASTER_KEY) e um segredo do Worker: ela
//     nunca sai do Worker e nunca e gravada no banco;
//   - o banco recebe apenas o SHA-256 da chave mestra, para conferir que quem
//     esta perguntando e o mesmo Worker de antes;
//   - cada credencial e cifrada com AES-256-GCM, com IV aleatorio por
//     gravacao e a chave de 256 bits derivada do SHA-256 da chave mestra.
//
// A GCM garante integridade: se o texto cifrado for alterado no banco, a
// decifragem falha em vez de devolver lixo.

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const PREFIXO = 'v1';
export const TAMANHO_IV = 12;
export const TAMANHO_TAG = 16;

// SHA-256 da chave mestra: e o que vai para o banco (admin_config).
export function hashMestre(chaveMestre) {
  return createHash('sha256').update(String(chaveMestre)).digest('hex');
}

// Chave AES de 256 bits derivada da chave mestra.
function derivar(chaveMestre) {
  return createHash('sha256').update(String(chaveMestre)).digest();
}

// A chave mestra do ambiente, quando existe e tem tamanho utilizavel.
export function chaveMestreDe(env) {
  const chave = env?.CREDENCIAIS_MASTER_KEY;
  return typeof chave === 'string' && chave.length >= 16 ? chave : null;
}

// Compara dois hashes sem vazar o tempo de comparacao.
export function hashIgual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Cifra um valor. Formato: v1.<iv>.<tag>.<texto cifrado> (base64url).
export function cifrar(valor, chaveMestre) {
  const texto = String(valor ?? '');
  if (!chaveMestre) throw new Error('chave mestra ausente');
  const iv = randomBytes(TAMANHO_IV);
  const cifrador = createCipheriv('aes-256-gcm', derivar(chaveMestre), iv);
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  return [PREFIXO, iv.toString('base64url'), tag.toString('base64url'), cifrado.toString('base64url')].join('.');
}

// Decifra um valor. Devolve null quando o texto nao e decifravel (chave
// trocada, texto alterado no banco, formato desconhecido).
export function decifrar(textoCifrado, chaveMestre) {
  if (typeof textoCifrado !== 'string' || !textoCifrado) return null;
  if (!chaveMestre) return null;
  const partes = textoCifrado.split('.');
  if (partes.length !== 4 || partes[0] !== PREFIXO) return null;
  try {
    const iv = Buffer.from(partes[1], 'base64url');
    const tag = Buffer.from(partes[2], 'base64url');
    const cifrado = Buffer.from(partes[3], 'base64url');
    if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) return null;
    const decifrador = createDecipheriv('aes-256-gcm', derivar(chaveMestre), iv);
    decifrador.setAuthTag(tag);
    const claro = Buffer.concat([decifrador.update(cifrado), decifrador.final()]);
    return claro.toString('utf8');
  } catch {
    return null;
  }
}

// Impressao digital de um valor: mostra que a chave mudou sem mostrar a
// chave. Serve para conferir se a chave em uso e a mesma cadastrada.
export function impressao(valor) {
  if (valor == null || valor === '') return null;
  return createHash('sha256').update(String(valor)).digest('hex').slice(0, 12);
}

// Mascaramento para a interface: mostra o começo e o fim, nunca o miolo.
export function mascarar(valor) {
  const texto = String(valor ?? '');
  if (!texto) return '';
  if (texto.length <= 8) return '•'.repeat(texto.length);
  return `${texto.slice(0, 3)}${'•'.repeat(Math.min(12, texto.length - 6))}${texto.slice(-3)}`;
}
