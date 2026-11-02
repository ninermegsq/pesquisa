import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const headers = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
const sha256 = s => createHash('sha256').update(s).digest('hex');
const emailRegex = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const allowed = () => new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
const array = x => Array.isArray(x) ? x : [];
const n = x => Number.isFinite(Number(x)) ? Number(x) : 0;
function validToken(token, ip) {
  if (typeof token !== 'string' || !process.env.HMAC_SECRET || token.length > 2000) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[\w-]+$/.test(parts[0]) || !/^[\w-]+$/.test(parts[1])) return false;
  const expected = createHmac('sha256', process.env.HMAC_SECRET).update(parts[0]).digest();
  const received = Buffer.from(parts[1], 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(expected, received)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return payload.ip === ip && Number.isFinite(payload.exp) && payload.exp >= Math.floor(Date.now() / 1000);
  } catch { return false; }
}
const external = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(5500) })
  .then(async r => ({ ok: r.ok, status: r.status, data: r.ok ? await r.json() : null }))
  .catch(() => null);
const txt = a => array(a?.Answer).map(r => String(r.data || '').replace(/^"|"$/g, '').replace(/\\"/g, '"'));
const safeList = x => array(x).slice(0, 70).map(v => String(v).slice(0, 240));
function normalizeXon(raw) {
  const details = array(raw?.ExposedBreaches?.breaches_details);
  const strength = array(raw?.BreachMetrics?.passwords_strength)[0] || {};
  const risk = array(raw?.BreachMetrics?.risk)[0] || {};
  return {
    breaches: details.slice(0, 100).map(b => ({
      name: String(b.breach || 'Fonte não identificada').slice(0, 140),
      year: String(b.xposed_date || '—').slice(0, 12),
      data: String(b.xposed_data || 'Não informado').slice(0, 350),
      records: n(b.xposed_records),
      passwordRisk: String(b.password_risk || 'não informado').slice(0, 60),
      domain: String(b.domain || '').slice(0, 150)
    })),
    pastes: n(raw?.PastesSummary?.cnt),
    metrics: {
      plaintext: n(strength.PlainText), weak: n(strength.EasyToCrack), strong: n(strength.StrongHash),
      risk_score: Math.max(0, n(risk.risk_score))
    }
  };
}

export default async (req, ctx) => {
  if (req.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405);
  // All four gates run before any paid or external lookup.
  if (!allowed().has(req.headers.get('origin') || '')) return reply({ error: 'Origem não permitida.' }, 403);
  let body;
  try { body = await req.json(); } catch { return reply({ error: 'JSON inválido.' }, 400); }
  const ip = ctx.ip || '';
  if (!validToken(body?.token, ip)) return reply({ error: 'Token expirado ou inválido.' }, 401);

  let store;
  try {
    store = getStore({ name: 'scan-cache', consistency: 'strong' });
    const key = `rl:${ip}`;
    const now = Date.now();
    const rl = await store.get(key, { type: 'json' });
    const recent = rl && rl.until > now ? Number(rl.count || 0) : 0;
    if (recent >= 20) return reply({ error: 'Limite de 20 consultas por hora atingido.' }, 429);
    await store.setJSON(key, { count: recent + 1, until: rl?.until > now ? rl.until : now + 3600000 }, { metadata: { expiration: now + 3600000 } });
  } catch {
    return reply({ error: 'Controle de requisições indisponível. Tente novamente.' }, 503);
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!emailRegex.test(email) || email.length > 254) return reply({ error: 'E-mail inválido.' }, 400);
  const host = email.split('@')[1];
  const ck = `e:${sha256(email)}`;
  try {
    const cached = await store.get(ck, { type: 'json' });
    if (cached && cached.cacheExpiresAt > Date.now()) {
      const { cacheExpiresAt, ...rest } = cached;
      return reply({ ...rest, cached: true });
    }
    if (cached) await store.delete(ck).catch(() => null);
  } catch { /* Cache is best-effort; continue without it. */ }

  const enc = encodeURIComponent(email);
  const md5 = createHash('md5').update(email).digest('hex');
  // Server-side fanout; client cannot learn private API keys.
  const fetchGravatar = fetch(`https://www.gravatar.com/avatar/${md5}?d=404`, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
    .then(r => r.status === 200).catch(() => null);
  const requests = [
    external(`https://api.xposedornot.com/v1/check-email/${enc}`),
    external(`https://api.xposedornot.com/v1/breach-analytics?email=${enc}`),
    external(`https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${enc}`),
    process.env.EMAILREP_KEY ? external(`https://emailrep.io/${enc}`, { headers: { Key: process.env.EMAILREP_KEY, Accept: 'application/json' } }) : Promise.resolve(null),
    external(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=TXT`),
    external(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=MX`),
    external(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`),
    external(`https://dns.google/resolve?name=${encodeURIComponent('_dmarc.' + host)}&type=TXT`),
    external(`https://api.github.com/search/users?q=${enc}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'osint-infoc-hacker' } }),
    external(`https://keybase.io/_/api/1.0/user/lookup.json?emails=${enc}`),
    fetchGravatar
  ];
  const [check, analytic, hudson, rep, dnsTxt, dnsMx, dnsA, dnsDmarc, gh, keybase, gravatar] = await Promise.all(requests);
  const ipAddrs = array(dnsA?.data?.Answer).filter(a => a.type === 1 && /^\d{1,3}(\.\d{1,3}){3}$/.test(a.data)).map(a => a.data);
  const db = ipAddrs.length ? await external(`https://internetdb.shodan.io/${ipAddrs[0]}`) : null;
  const xon = normalizeXon(analytic?.data);
  // A summary-only answer is not treated as a detailed breach report.
  const summary = array(check?.data?.breaches).flat().filter(v => typeof v === 'string');
  if (!xon.breaches.length && summary.length) {
    xon.breaches = summary.slice(0, 100).map(name => ({ name, year: '—', data: 'Detalhes indisponíveis', records: 0, passwordRisk: 'não informado', domain: '' }));
  }
  const txtRecords = txt(dnsTxt?.data);
  const dmarcRecords = txt(dnsDmarc?.data);
  const mxRecords = array(dnsMx?.data?.Answer).map(a => String(a.data || '').slice(0, 200));
  const dnsOK = Boolean(dnsTxt?.ok && dnsMx?.ok && dnsA?.ok && dnsDmarc?.ok);
  const data = {
    email, breaches: xon.breaches, pastes: xon.pastes, metrics: xon.metrics,
    // Return only summary metadata; never forward recovered credentials or raw stealer logs.
    stealer: hudson?.ok ? { detected: Boolean(hudson.data?.stealers?.length || hudson.data?.total || hudson.data?.found), count: Math.max(0, n(hudson.data?.stealers?.length || hudson.data?.total)) } : null,
    reputation: rep?.ok ? { reputation: String(rep.data?.reputation || 'unknown').slice(0, 30), suspicious: Boolean(rep.data?.suspicious), references: n(rep.data?.references), blacklisted: Boolean(rep.data?.details?.blacklisted) } : null,
    dns: { txt: safeList(txtRecords), mx: safeList(mxRecords), ips: safeList(ipAddrs), dmarcTxt: safeList(dmarcRecords),
      hasSPF: txtRecords.some(s => /v=spf1/i.test(s)), dmarc: dmarcRecords.some(s => /v=DMARC1/i.test(s)), available: dnsOK },
    internetdb: db?.ok ? { ports: array(db.data?.ports).slice(0, 100), vulns: array(db.data?.vulns).slice(0, 80) } : null,
    github: gh?.ok ? { count: n(gh.data?.total_count), users: array(gh.data?.items).slice(0, 5).map(u => String(u.login || '').slice(0, 70)).filter(Boolean) } : null,
    keybase: keybase?.ok ? String(keybase.data?.them?.[0]?.basics?.username || '') : null,
    gravatar,
    availability: { xon: Boolean(analytic?.ok || check?.ok), analytics: Boolean(analytic?.ok), hudson: Boolean(hudson?.ok), emailrep: Boolean(rep?.ok), dns: dnsOK, github: Boolean(gh?.ok), keybase: Boolean(keybase?.ok), internetdb: Boolean(db?.ok), gravatar: gravatar !== null },
    checkedAt: new Date().toISOString(), cached: false
  };
  try { await store.setJSON(ck, { ...data, cacheExpiresAt: Date.now() + 86400000 }, { metadata: { expiration: Date.now() + 86400000 } }); }
  catch { /* Cache best-effort only. */ }
  return reply(data);
};
