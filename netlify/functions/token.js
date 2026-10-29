import { createHmac, randomUUID } from 'node:crypto';

const headers = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };
const reply = (data, status = 200) => new Response(JSON.stringify(status >= 400 ? { success: false, ...data } : data), { status, headers });
const allowed = () => new Set((process.env.ALLOWED_ORIGINS || 'https://ostnt.online,https://ostnt.netlify.app').split(',').map(s => s.trim()).filter(Boolean));
const trusted = (req) => allowed().has(req.headers.get('origin') || '');
const hostnames = () => new Set((process.env.TURNSTILE_HOSTNAMES || 'ostnt.online,ostnt.netlify.app').split(',').map(s => s.trim()).filter(Boolean));

export default async (req, ctx) => {
  if (req.method === 'GET') {
    // Site key is intentionally public; the secret is never returned.
    const siteKey = '0x4AAAAAAFrCL8A3Pa1kzDsB';
    return reply({ siteKey });
  }
  if (req.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405);
  if (!trusted(req)) return reply({ error: 'Origem não permitida.' }, 403);
  if (!process.env.TURNSTILE_SECRET) return reply({ code: 'turnstile_secret_missing', error: 'TURNSTILE_SECRET não configurada nas Functions da Netlify.' }, 503);
  if (!process.env.HMAC_SECRET) return reply({ code: 'scan_secret_missing', error: 'HMAC_SECRET não configurada nas Functions da Netlify.' }, 503);
  let body;
  try { body = await req.json(); } catch { return reply({ error: 'JSON inválido.' }, 400); }
  // Accept the canonical field; retain compatibility with already-open clients.
  const cfToken = body?.['cf-turnstile-response'] ?? body?.cfToken;
  if (typeof cfToken !== 'string' || cfToken.length > 2048 || !cfToken.trim()) {
    return reply({ error: 'Verificação obrigatória.' }, 400);
  }
  try {
    const form = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: cfToken });
    if (ctx?.ip) form.set('remoteip', ctx.ip);
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form, signal: AbortSignal.timeout(10000)
    });
    if (!verification.ok) return reply({ success: false, error: 'Serviço de verificação indisponível.' }, 503);
    const verified = await verification.json();
    if (verified?.success !== true) {
      const codes = Array.isArray(verified?.['error-codes']) ? verified['error-codes'] : [];
      if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
        return reply({ code: 'turnstile_secret_invalid', error: 'A Cloudflare recusou TURNSTILE_SECRET. Configure na Netlify a Secret Key do mesmo widget da chave pública.' }, 503);
      }
      if (codes.includes('internal-error')) return reply({ code: 'turnstile_unavailable', error: 'Cloudflare temporariamente indisponível. Tente novamente.' }, 503);
      if (codes.includes('timeout-or-duplicate')) return reply({ code: 'turnstile_token_expired', error: 'Token Turnstile expirado ou já utilizado. Envie novamente para gerar outro.' }, 401);
      return reply({ code: 'turnstile_rejected', error: 'Verificação de segurança recusada. Tente novamente.' }, 401);
    }
    if (!hostnames().has(verified.hostname)) return reply({ code: 'turnstile_hostname_mismatch', error: 'O domínio verificado não está autorizado no backend. Confira TURNSTILE_HOSTNAMES na Netlify.' }, 403);
    if (verified.action !== 'scan') return reply({ code: 'turnstile_action_mismatch', error: 'A ação do Turnstile não corresponde ao formulário. Recarregue a página.' }, 403);
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60, ip: ctx?.ip || '', nonce: randomUUID() })).toString('base64url');
    const mac = createHmac('sha256', process.env.HMAC_SECRET).update(payload).digest('base64url');
    return reply({ success: true, token: `${payload}.${mac}` });
  } catch {
    return reply({ success: false, error: 'Serviço de verificação indisponível.' }, 503);
  }
};
