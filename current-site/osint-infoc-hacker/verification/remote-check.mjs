import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=new URL(process.env.VALIDATION_BASE||'http://127.0.0.1:8787');
if(!['localhost','127.0.0.1'].includes(base.hostname))throw Error('Use somente o cliente local autenticado de validação. Não use o Worker público bloqueado nem produção.');
const output=new URL('./artifacts/',import.meta.url);await mkdir(output,{recursive:true});
const evidence={scope:'authenticated remote service binding; named Worker deploy must be confirmed; public-entry WAF not tested',started:new Date().toISOString(),checks:[],sources:[]};
async function request(path,body,origin=true){
 const response=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{...(origin?{origin:base.origin}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const raw=await response.text();let json;try{json=JSON.parse(raw);}catch{}
 return {status:response.status,headers:response.headers,raw,json};
}
const record=(name,result)=>{evidence.checks.push({name,...result});console.log(JSON.stringify({name,...result}));};
async function signed(alvo){
 const r=await request('/.netlify/functions/token',{alvo,cfToken:'XXXX.DUMMY.TOKEN.XXXX'});
 assert.equal(r.status,200,r.json?.error||r.raw.slice(0,220));assert.equal(typeof r.json?.token,'string');return r.json.token;
}
async function scan(alvo){
 const token=await signed(alvo),r=await request('/api/scan',{alvo,token});
 if(r.status===200){
  assert.ok(Array.isArray(r.json.fontes));
  evidence.sources.push({tipo:r.json.alvo?.tipo,fontes:r.json.fontes.map(s=>({id:s.id,status:s.status,erro:s.erro,cache:s.cache,timestamp:s.timestamp,provenance:s.provenance}))});
  await writeFile(new URL('latest-report.json',output),JSON.stringify(r.json,null,2));
  const blocked=r.json.fontes.filter(s=>/\b1010\b/.test(s.erro||''));
  if(blocked.length>=3)throw Error('Três ou mais fontes retornaram 1010; inspeção interrompida. Confira fontes registradas.');
 }
 return {...r,token};
}
try{
 const home=await request('/');assert.equal(home.status,200);
 const csp=home.headers.get('content-security-policy')||'';
 const directive=name=>(csp.split(';').find(s=>s.trim().startsWith(name+' '))||'').trim();
 assert.ok(!directive('script-src').includes("'unsafe-inline'"));assert.equal(home.headers.get('strict-transport-security'),'max-age=31536000');
 for(const [header,value]of [['cross-origin-opener-policy','same-origin'],['cross-origin-embedder-policy','credentialless'],['cross-origin-resource-policy','same-origin']])assert.equal(home.headers.get(header),value);
 record('headers',{status:home.status,script:directive('script-src'),connect:directive('connect-src'),hsts:home.headers.get('strict-transport-security')});
 record('beacon',{hostsAllowed:directive('script-src').includes('https://static.cloudflareinsights.com')&&directive('connect-src').includes('https://cloudflareinsights.com'),networkRequest200:'not measured by this script'});
 for(const [path,type]of [['/robots.txt','text/plain'],['/sitemap.xml','application/xml'],['/og.jpg','image/jpeg'],['/.well-known/security.txt','text/plain']]){
  const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.ok(response.headers.get('content-type')?.includes(type));record(path,{status:response.status,type:response.headers.get('content-type')});
 }
 const key=await request('/.netlify/functions/token');assert.equal(key.status,200);
 assert.ok(/^[123]x0{6,}/.test(key.json?.siteKey||''),'Roteiro exclusivo de validação com chaves dummy. Produção requer interação manual.');
 for(const alvo of ['fixture@example.invalid','ostnt.online','8.8.8.8','11222333000181','1100000000','Nome de Teste']){
  const r=await scan(alvo);record('scan',{tipo:r.json?.alvo?.tipo,status:r.status,meta:r.json?.meta,error:r.json?.error||r.json?.erro});assert.equal(r.status,200,'Scan interrompido ou cota pré-existente: confira o resultado registrado.');
  if(r.json.alvo.tipo==='email'){assert.equal(r.json.meta.executadas,12);assert.equal(r.json.meta.subrequests,16);}
 }
 const alvo='cache-'+Date.now()+'@example.invalid';
 const cold=await scan(alvo),hot=await scan(alvo);assert.equal(cold.status,200);assert.equal(hot.status,200);
 record('cache',{first:cold.json.fontes.map(s=>({id:s.id,cache:s.cache})),immediate:hot.json.fontes.map(s=>({id:s.id,cache:s.cache}))});
 assert.ok(cold.json.fontes.every(s=>s.cache==='miss'));assert.ok(hot.json.fontes.every(s=>s.cache==='hit'));
 const errors=hot.json.fontes.filter(s=>s.status!=='ok').map(s=>s.id);
 console.log('Waiting 121 seconds for error cache expiration...');await new Promise(resolve=>setTimeout(resolve,121000));
 const expired=await scan(alvo);assert.equal(expired.status,200);record('error-ttl',{after121seconds:expired.json.fontes.filter(s=>errors.includes(s.id)).map(s=>({id:s.id,cache:s.cache,status:s.status}))});
 assert.ok(expired.json.fontes.filter(s=>errors.includes(s.id)).every(s=>s.cache==='miss'));
 const token=await signed(alvo);
 const mismatched=await request('/api/scan',{alvo:'binding-check@example.invalid',token});assert.equal(mismatched.status,429);record('target-binding',{status:mismatched.status});
 const accepted=await request('/api/scan',{alvo,token});assert.equal(accepted.status,200);const replay=await request('/api/scan',{alvo,token});assert.equal(replay.status,429);record('replay',{first:accepted.status,second:replay.status});
 let quota;for(let i=0;i<11;i++){quota=await scan(alvo);record('quota',{status:quota.status,retryAfter:quota.headers.get('retry-after')});if(quota.status===429)break;assert.equal(quota.status,200);}
 assert.equal(quota.status,429);assert.ok(+quota.headers.get('retry-after')>0);
 assert.equal((await request('/api/scan',{alvo},false)).status,403);assert.equal((await request('/api/scan',{alvo})).status,429);record('missing-auth',{missingOrigin:403,missingToken:429});
 record('exports',{endpoint:'none; client-side generation',next:'Run frontend-check.cjs and verify real UI downloads separately'});
 evidence.result='passed for scripted checks; browser, Lighthouse and source availability require review';
}catch(error){evidence.result='incomplete';evidence.error=String(error.message||error);console.error(evidence.error);process.exitCode=1;}
finally{evidence.finished=new Date().toISOString();await writeFile(new URL('remote-result.json',output),JSON.stringify(evidence,null,2));}
