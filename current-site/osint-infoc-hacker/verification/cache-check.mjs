import assert from 'node:assert/strict';
import {rodar,handleScan} from '../src/scan.mjs';
import {REGISTRY} from '../src/sources/registry.mjs';
import {esc,render} from '../src/render.mjs';
import {ctx,ehAbort} from '../src/lib/http.mjs';
const entries=new Map();
globalThis.caches={default:{async match(k){return entries.get(k.url)?.clone();},async put(k,r){entries.set(k.url,r.clone());}}};
const kv=new Map();let writes=0;
const env={OSINT_KV:{async get(k){return kv.get(k)||null;},async put(k,v){assert.match(k,/^rl:/);writes++;kv.set(k,v);}}};
const target={tipo:'email',valor:'cache-check@example.invalid'};
const context=ctx(env,'https://local.test');assert.equal(context.env,env);
for(const [id,status,ttl] of [['ok','ok',86400],['error','erro',120],['abort','timeout',120]]){
 const source={id,ttl:86400,provenance:'local-test',run:async()=>{if(status!=='ok')throw new DOMException('test failure',status==='timeout'?'TimeoutError':'Error');return {dados:{value:1}};}};
 const r=await rodar(source,target,context);assert.equal(r.status,status);assert.equal(r.cache,'miss');
 const hit=entries.get(`https://local.test/__cache/${id}/cache-check%40example.invalid`);
 assert.equal(hit.headers.get('cache-control'),`public, max-age=${ttl}`);
 assert.equal((await rodar(source,target,context)).cache,'hit');
}
assert.equal(writes,0);
assert.deepEqual(REGISTRY.find(s=>s.id==='telegram').tipos,['telefone']);
const email=REGISTRY.filter(s=>s.tipos.includes('email'));
assert.equal(email.length,12);assert.equal(email.reduce((n,s)=>n+s.custo,0),16);
globalThis.fetch=async()=>{throw Error('offline verification fixture');};
const response=await handleScan(new Request('https://local.test/api/scan',{method:'POST',body:JSON.stringify({alvo:target.valor})}),env,'local-test');
const report=await response.json();assert.equal(response.status,200);assert.equal(writes,2);assert.equal(report.score.parcial,true);
assert.equal(esc(null),'');assert.equal(render(report.fontes).includes('undefined'),false);
assert.equal(ehAbort(new DOMException('deadline reached','TimeoutError')),true);
console.log(JSON.stringify({scope:'LOCAL ONLY; not upstream or edge validation',successTTL:86400,errorTTL:120,timeoutTTL:120,cacheHit:true,sourceKVWrites:0,scanKVWrites:writes,emailSources:email.length,emailSubrequests:report.meta.subrequests,offlineStatus:response.status,partial:report.score.parcial}));
