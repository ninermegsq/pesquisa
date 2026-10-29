import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import token from '../netlify/functions/token.js';

const origin = 'https://ostnt.online';
const request = (body = { 'cf-turnstile-response': 'widget-token' }, source = origin) => new Request(`${origin}/.netlify/functions/token`, {
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
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
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
  for (const [label, value, status, code] of [
    ['invalid token', { success: false, 'error-codes': ['invalid-input-response'] }, 401, 'turnstile_rejected'],
    ['expired or duplicate', { success: false, 'error-codes': ['timeout-or-duplicate'] }, 401, 'turnstile_token_expired'],
    ['invalid secret', { success: false, 'error-codes': ['invalid-input-secret'] }, 503, 'turnstile_secret_invalid'],
    ['upstream internal error', { success: false, 'error-codes': ['internal-error'] }, 503, 'turnstile_unavailable'],
    ['unexpected hostname', { success: true, hostname: 'other.example', action: 'scan' }, 403, 'turnstile_hostname_mismatch'],
    ['unexpected action', { success: true, hostname: 'ostnt.online', action: 'other' }, 403, 'turnstile_action_mismatch'],
    ['missing action', { success: true, hostname: 'ostnt.online' }, 403, 'turnstile_action_mismatch'],
    ['nonboolean success', { success: 'true', hostname: 'ostnt.online', action: 'scan' }, 401, 'turnstile_rejected']
  ]) {
    await t.test(`rejects ${label}`, async () => {
      result = value;
      const r = await token(request(), ctx);
      assert.equal(r.status, status);
      const data = await r.json();
      assert.equal(data.success, false);
      assert.equal(data.code, code);
      assert.equal(data.token, undefined);
      assert.ok(!JSON.stringify(data).includes(process.env.TURNSTILE_SECRET));
    });
  }
  await t.test('redeems every request with Siteverify and rejects replay', async () => {
    const verifier = globalThis.fetch;
    let redeemed = false;
    globalThis.fetch = async () => {
      const result = redeemed ? { success: false, 'error-codes': ['timeout-or-duplicate'] }
        : { success: true, hostname: 'ostnt.online', action: 'scan' };
      redeemed = true;
      return Response.json(result);
    };
    try {
      assert.equal((await token(request(), ctx)).status, 200);
      const replay = await token(request(), ctx);
      assert.equal(replay.status, 401);
      assert.equal((await replay.json()).code, 'turnstile_token_expired');
    } finally { globalThis.fetch = verifier; }
  });
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
    const missingTurnstile = await token(request(), ctx);
    assert.equal(missingTurnstile.status, 503);
    assert.equal((await missingTurnstile.json()).code, 'turnstile_secret_missing');
    process.env.TURNSTILE_SECRET = 'unit-test-secret';
    delete process.env.HMAC_SECRET;
    const missingScan = await token(request(), ctx);
    assert.equal(missingScan.status, 503);
    assert.equal((await missingScan.json()).code, 'scan_secret_missing');
    process.env.HMAC_SECRET = 'unit-test-signing-secret';
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

test('frontend waits for ready, reuses and resets its widget, and reports exact errors', async () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  assert.match(html, /<form[^>]*id="scan-form"[\s\S]*data-sitekey="0x4AAAAAAFrCL8A3Pa1kzDsB"[\s\S]*<\/form>/);
  const source = html.slice(html.indexOf('function turnstileError('), html.indexOf('async function scan(event)'));
  const box = { dataset: { sitekey: '0x4AAAAAAFrCL8A3Pa1kzDsB', action: 'scan' } };
  const slot = { classList: { add() {}, remove() {} } };
  let callback, readyCallback, renders = 0, resets = 0, executions = 0;
  const context = vm.createContext({
    window: { location: { hostname: 'ostnt.netlify.app' }, turnstile: {
      ready(fn) { readyCallback = fn; },
      render(target, options) {
        renders++;
        assert.equal(target, box);
        assert.equal(options.sitekey, box.dataset.sitekey);
        assert.equal(options.action, 'scan');
        assert.equal(options.execution, 'execute');
        assert.equal(options.retry, 'never');
        callback = options;
        return 'widget-id';
      },
      execute(id) { assert.equal(id, 'widget-id'); executions++; },
      reset(id) { assert.equal(id, 'widget-id'); resets++; }
    } },
    $: id => id === 'security-slot' ? slot : box,
    setTimeout, clearTimeout, widgetId: null, turnstileLoading: null, turnstilePending: null
  });
  vm.runInContext(source, context);
  async function start(signal) {
    const pending = context.challenge(signal);
    await new Promise(setImmediate);
    readyCallback();
    await new Promise(setImmediate);
    return { pending };
  }
  const success = context.challenge();
  await new Promise(setImmediate);
  assert.equal(renders, 0, 'render must wait for Cloudflare ready');
  readyCallback(); await new Promise(setImmediate);
  callback.callback('first-fresh-token');
  assert.equal(await success, 'first-fresh-token');
  context.resetTurnstile();
  const again = await start(); callback.callback('second-fresh-token');
  assert.equal(await again.pending, 'second-fresh-token'); context.resetTurnstile();
  assert.equal(renders, 1); assert.equal(executions, 2); assert.equal(resets, 2);
  for (const [code, message] of [
    ['110200', /ostnt\.netlify\.app.*Hostname Management.*110200/],
    ['110100', /Chave pública.*110100/],
    ['200500', /challenges\.cloudflare\.com.*200500/],
    ['300030', /300030/]
  ]) {
    const { pending } = await start();
    const rejection = assert.rejects(pending, message);
    callback['error-callback'](code); await rejection; context.resetTurnstile();
  }
  for (const name of ['expired-callback', 'timeout-callback']) {
    const { pending } = await start();
    const rejection = assert.rejects(pending, /expirada/);
    callback[name](); await rejection; context.resetTurnstile();
  }
  const controller = new AbortController();
  const { pending } = await start(controller.signal);
  const rejection = assert.rejects(pending, /cancelada/);
  controller.abort(); await rejection; context.resetTurnstile();
  callback.callback('late-token'); // An aborted attempt must not settle a new one.
  assert.equal(context.turnstilePending, null);
  assert.equal(renders, 1);
  assert.match(html, /JSON\.stringify\(\{'cf-turnstile-response':cfToken\}\)/);
  assert.match(html, /finally\{resetTurnstile\(\);scanning=false/);
});
