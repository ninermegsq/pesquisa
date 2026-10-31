const {Miniflare,convertV4MiniflareOptions}=require(process.env.OSINT_MINIFLARE_MODULE||require('node:module').createRequire(require.resolve('wrangler/package.json')).resolve('miniflare'));
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
const root=path.resolve(__dirname,'..');
const files=['cloudflare-worker.mjs',...fs.readdirSync(path.join(root,'src'),{recursive:true}).filter(p=>p.endsWith('.mjs')).map(p=>'src/'+p)];
const modules=files.map(p=>({type:'ESModule',path:path.join(root,p),contents:fs.readFileSync(path.join(root,p),'utf8')}));
const mf=new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:root,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],kvNamespaces:['CACHE'],durableObjects:{TOKEN_GUARD:{className:'TokenGuard',useSQLite:true}},bindings:{APP_ENV:'validation',ALLOWED_ORIGINS:'http://localhost:8787',TURNSTILE_SITEKEY:'1x00000000000000000000AA',TURNSTILE_SECRET:'1x0000000000000000000000000000000AA',HMAC_SECRET:'local-fixture-only'},outboundService:async req=>req.url.includes('challenges.cloudflare.com/turnstile/')?Response.json({success:true,hostname:'localhost'}):req.url.startsWith('https://minhareceita.org/')?Response.json({cnpj:'11222333000181',razao_social:'Empresa Fixture',qsa:[]}):new Response('Fixture upstream unavailable',{status:503})}));
try{
const call=(p,body,ip='fixture')=>mf.dispatchFetch('http://localhost:8787'+p,{method:body?'POST':'GET',headers:{origin:'http://localhost:8787','content-type':'application/json','CF-Connecting-IP':ip},...(body?{body:JSON.stringify(body)}:{})});
const token=async(alvo,ip)=>{const r=await call('/.netlify/functions/token',{alvo,cfToken:'XXXX.DUMMY.TOKEN.XXXX'},ip);assert.equal(r.status,200,await r.clone().text());return (await r.json()).token;};
const statuses=[];for(const alvo of ['fixture@example.invalid','example.invalid','203.0.113.10','11222333000181','11987654321','Nome de Teste']){const t=await token(alvo,'six-types');const r=await call('/api/scan',{alvo,token:t},'six-types');const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));assert.equal(j.score.parcial,true);if(!j.fontes.some(s=>s.status==='ok'))assert.equal(j.score.nivel,'INCONCLUSIVO');statuses.push({tipo:j.alvo.tipo,status:r.status,fontes:j.meta.executadas,subrequests:j.meta.subrequests});}
const burstTarget='burst@example.invalid';const burstTokens=await Promise.all(Array.from({length:11},()=>token(burstTarget,'burst')));
const burst=await Promise.all(burstTokens.map(token=>call('/api/scan',{alvo:burstTarget,token},'burst')));
assert.equal(burst.filter(r=>r.status===200).length,10);assert.equal(burst.filter(r=>r.status===429).length,1);
console.log('BURST_RESULT '+JSON.stringify({accepted:10,rejected:1,scope:'local workerd, distinct tokens'}));
const alvo='fixture@example.invalid';const t=await token(alvo,'replay');const r=await call('/api/scan',{alvo,token:t},'replay');assert.equal(r.status,200);assert.equal((await call('/api/scan',{alvo,token:t},'replay')).status,429);
const tp=await token(alvo,'parallel');const parallel=await Promise.all([call('/api/scan',{alvo,token:tp},'parallel'),call('/api/scan',{alvo,token:tp},'parallel')]);assert.deepEqual(parallel.map(r=>r.status).sort(),[200,429]);
for(let i=1;i<=11;i++){const t=await token(alvo,'rate-test');const r=await call('/api/scan',{alvo,token:t},'rate-test');assert.equal(r.status,i<=10?200:429,`rate ${i}: ${await r.clone().text()}`);if(i===11)assert.ok(+r.headers.get('retry-after')>0);}
assert.equal((await call('/api/scan',{alvo},'missing-token')).status,429);
for(const p of ['/robots.txt','/sitemap.xml','/og.jpg','/og.html','/.well-known/security.txt'])assert.equal((await call(p)).status,200);
const kv=await mf.getKVNamespace('CACHE');const keys=await kv.list();assert.ok(keys.keys.every(k=>k.name.startsWith('rl:')));
if(!process.env.OSINT_SKIP_TTL){
const expiryTarget='expiry@example.invalid';
const expiryScan=async()=>{const t=await token(expiryTarget,'expiry-test');const r=await call('/api/scan',{alvo:expiryTarget,token:t},'expiry-test');assert.equal(r.status,200);return r.json();};
const cold=await expiryScan(),hot=await expiryScan();assert.ok(cold.fontes.every(s=>s.cache==='miss'));assert.ok(hot.fontes.every(s=>s.cache==='hit'));
assert.ok(hot.fontes.some(s=>s.erro?.includes('Fixture upstream unavailable')));
console.log('TTL_WAIT_START '+new Date().toISOString());
await new Promise(resolve=>setTimeout(resolve,121000));
const expired=await expiryScan();assert.ok(expired.fontes.every(s=>s.cache==='miss'));
console.log('TTL_RESULT '+JSON.stringify({scope:'local workerd cache, not Cloudflare edge',first:'miss',immediate:'hit',after121seconds:'miss',errorBodyPreserved:true}));
}
console.log('RUNTIME_RESULT '+JSON.stringify({scope:'local workerd runtime; all upstream responses are fixtures',sixTypes:statuses,replay:429,parallelReplay:[200,429],eleventh:429,retryAfter:true,kvOnlyRateKeys:true}));
}finally{await mf.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1});
