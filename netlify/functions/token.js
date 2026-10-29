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
  if (!process.env.TURNSTILE_SECRET || !process.env.HMAC_SECRET) {
    return reply({ error: 'Variáveis de segurança não configuradas.' }, 503);
  }
  let body;
  try { body = await req.json(); } catch { return reply({ error: 'JSON inválido.' }, 400); }
  if (typeof body?.cfToken !== 'string' || body.cfToken.length > 2048 || !body.cfToken.trim()) {
    return reply({ error: 'Verificação obrigatória.' }, 400);
  }
  try {
    const form = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: body.cfToken });
    if (ctx?.ip) form.set('remoteip', ctx.ip);
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(7000)
    });
    if (!verification.ok) return reply({ success: false, error: 'Serviço de verificação indisponível.' }, 503);
    const verified = await verification.json();
    if (verified?.success !== true || !hostnames().has(verified.hostname) || verified.action !== 'scan') {
      return reply({ success: false, error: 'Verificação de segurança recusada. Tente novamente.' }, 401);
    }
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60, ip: ctx?.ip || '', nonce: randomUUID() })).toString('base64url');
    const mac = createHmac('sha256', process.env.HMAC_SECRET).update(payload).digest('base64url');
    return reply({ success: true, token: `${payload}.${mac}` });
  } catch {
    return reply({ success: false, error: 'Serviço de verificação indisponível.' }, 503);
  }
};
