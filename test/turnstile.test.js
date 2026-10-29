import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import token from '../netlify/functions/token.js';

const origin = 'https://ostnt.online';
const request = (body = { cfToken: 'widget-token' }, source = origin) => new Request(`${origin}/.netlify/functions/token`, {
  method: 'POST', headers: { Origin: source, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('server verification contract', async t => {
  const names = ['TURNSTILE_SECRET', 'HMAC_SECRET', 'ALLOWED_ORIGINS', 'TURNSTILE_HOSTNAMES'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
    }
  });
  // Fixtures only: never real credentials or external calls.
  process.env.TURNSTILE_SECRET = 'unit-test-secret';
  process.env.HMAC_SECRET = 'unit-test-signing-secret';
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.TURNSTILE_HOSTNAMES;
  let calls = 0;
  let result = { success: true, hostname: 'ostnt.online', action: 'scan' };
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('secret'), process.env.TURNSTILE_SECRET);
    assert.equal(options.body.get('response'), 'widget-token');
    assert.equal(options.body.get('remoteip'), '192.0.2.1');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(result);
  };
  const ctx = { ip: '192.0.2.1' };

  await t.test('public key works without exposing any secret', async () => {
    const r = await token(new Request(`${origin}/token`), ctx);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { siteKey: '0x4AAAAAAFrCL8A3Pa1kzDsB' });
    assert.equal(calls, 0);
  });
  await t.test('success issues a signed authorization bound to IP and expiry', async () => {
    const r = await token(request(), ctx);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.success, true);
    const [payload, mac] = data.token.split('.');
    assert.equal(mac, createHmac('sha256', process.env.HMAC_SECRET).update(payload).digest('base64url'));
    const decoded = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(decoded.ip, ctx.ip);
    assert.ok(decoded.exp > Date.now() / 1000 && decoded.exp <= Date.now() / 1000 + 60);
    assert.ok(decoded.nonce);
    assert.ok(!JSON.stringify(data).includes(process.env.TURNSTILE_SECRET));
  });
  await t.test('accepts the Netlify site hostname and origin', async () => {
    result = { success: true, hostname: 'ostnt.netlify.app', action: 'scan' };
    const r = await token(request({ cfToken: 'widget-token' }, 'https://ostnt.netlify.app'), ctx);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).success, true);
  });
  for (const [label, value] of [
    ['invalid token', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['expired or duplicate', { success: false, 'error-codes': ['timeout-or-duplicate'] }],
    ['unexpected hostname', { success: true, hostname: 'other.example', action: 'scan' }],
    ['unexpected action', { success: true, hostname: 'ostnt.online', action: 'other' }],
    ['missing action', { success: true, hostname: 'ostnt.online' }],
    ['nonboolean success', { success: 'true', hostname: 'ostnt.online', action: 'scan' }]
  ]) {
    await t.test(`rejects ${label}`, async () => {
      result = value;
      const r = await token(request(), ctx);
      assert.equal(r.status, 401);
      assert.deepEqual(await r.json(), { success: false, error: 'Verificação de segurança recusada. Tente novamente.' });
    });
  }
  await t.test('rejects requests before external verification', async () => {
    const beforeCalls = calls;
    assert.equal((await token(request({}, 'https://other.example'), ctx)).status, 403);
    for (const cfToken of ['', ' ', null, 42, 'a'.repeat(2049)]) {
      assert.equal((await token(request({ cfToken }), ctx)).status, 400);
    }
    assert.equal((await token(new Request(`${origin}/token`, { method: 'PUT' }), ctx)).status, 405);
    const malformed = new Request(`${origin}/token`, { method: 'POST', headers: { Origin: origin }, body: '{' });
    assert.equal((await token(malformed, ctx)).status, 400);
    delete process.env.TURNSTILE_SECRET;
    assert.equal((await token(request(), ctx)).status, 503);
    process.env.TURNSTILE_SECRET = 'unit-test-secret';
    assert.equal(calls, beforeCalls);
  });
  for (const [label, mock] of [
    ['network timeout', async () => { throw new Error('timeout'); }],
    ['upstream error', async () => new Response('unavailable', { status: 503 })],
    ['invalid upstream JSON', async () => new Response('not-json')]
  ]) {
    await t.test(`handles ${label}`, async () => {
      globalThis.fetch = mock;
      const r = await token(request(), ctx);
      assert.equal(r.status, 503);
      assert.equal((await r.json()).success, false);
    });
  }
});

test('frontend widget obtains token, uses HTML sitekey/action, and permits retry', async () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  assert.match(html, /<form[^>]*id="scan-form"[\s\S]*data-sitekey="0x4AAAAAAFrCL8A3Pa1kzDsB"[\s\S]*<\/form>/);
  const source = html.slice(html.indexOf('function loadTurnstile()'), html.indexOf('async function scan(event)'));
  const box = { dataset: { sitekey: '0x4AAAAAAFrCL8A3Pa1kzDsB', action: 'scan' } };
  const slot = { classList: { add() {} } };
  let callback;
  const context = vm.createContext({
    window: { turnstile: { render(target, options) {
      assert.equal(target, box);
      assert.equal(options.sitekey, box.dataset.sitekey);
      assert.equal(options.action, 'scan');
      callback = options;
      return 'widget-id';
    } } },
    $: id => id === 'security-slot' ? slot : box,
    setTimeout, clearTimeout, widgetId: null, turnstileLoading: null
  });
  vm.runInContext(source, context);
  const success = context.challenge();
  await new Promise(setImmediate);
  callback.callback('fresh-token');
  assert.equal(await success, 'fresh-token');
  for (const name of ['error-callback', 'expired-callback', 'timeout-callback']) {
    const attempt = context.challenge();
    await new Promise(setImmediate);
    callback[name]();
    await assert.rejects(attempt, /verifica|Verifica/);
  }
  // The scanner sends the captured token to the verification Function.
  assert.match(html, /getJson\('\/\.netlify\/functions\/token',[^\n]*JSON\.stringify\(\{cfToken\}\)/);
});
