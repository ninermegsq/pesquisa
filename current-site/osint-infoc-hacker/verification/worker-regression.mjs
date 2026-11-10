import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {createHash,randomUUID,webcrypto} from 'node:crypto';
const source=await readFile(new URL('../cloudflare-worker.mjs',import.meta.url),'utf8');
// O motor legado do v1.2 foi removido do Worker: a rota /.netlify/functions/scan
// nao pode voltar, porque a unica rota de scan do projeto e /api/scan (motor v1.3).
assert.equal(source.includes('/.netlify/functions/scan'),false);
assert.ok(source.includes("url.pathname==='/api/scan'"),'rota /api/scan ausente');
assert.ok(source.includes('handleScan(req,'),'rota /api/scan nao chama o motor v1.3');
// A rota de token continua de pe: o app.js ainda pede /.netlify/functions/token.
assert.ok(source.includes('/.netlify/functions/token'));
const tokenSource=source.slice(source.indexOf('async function token('),source.indexOf('const headers ='));
const reply=(data,status=200,headers={})=>Response.json(data,{status,headers});
const token=new Function('reply','allowed','detectar','emailRegex','fetch','randomUUID','crypto','sha256',tokenSource+';return token;')(reply,()=>new Set(['https://validation.example']),v=>({valor:v}),/./,async()=>Response.json({success:true,hostname:'validation.example'}),randomUUID,webcrypto,v=>createHash('sha256').update(v).digest('hex'));
const env={TURNSTILE_SITEKEY:'sitekey-fixture',TURNSTILE_SECRET:'fixture',HMAC_SECRET:'fixture',TOKEN_GUARD:{}};
const r=await token(new Request('https://validation.example/.netlify/functions/token',{method:'POST',headers:{origin:'https://validation.example'},body:JSON.stringify({alvo:'fixture@example.invalid',cfToken:'fixture-token'})}),env,'test-ip');
assert.equal(r.status,200);assert.equal(typeof (await r.json()).token,'string');
console.log(JSON.stringify({scope:'local regression; siteverify mocked',tokenIssuance:200,rotaLegadaRemovida:true,rotaScanV13:true,originScoped:true}));
