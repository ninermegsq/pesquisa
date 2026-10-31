import assert from 'node:assert/strict';
import {REGISTRY} from '../src/sources/registry.mjs';
import {ctx} from '../src/lib/http.mjs';
const source=id=>REGISTRY.find(x=>x.id===id),a={tipo:'ip',valor:'8.8.8.8'};
const run=(id,get,alvo=a)=>source(id).run(alvo,{env:{},get});
for(const status of [401,403,404]){let n=0;globalThis.fetch=async()=>{n++;return new Response('fixture',{status});};assert.equal((await ctx({}).get('https://fixture.invalid')).status,status);assert.equal(n,1);}
for(const status of [429,503]){let n=0;globalThis.fetch=async()=>new Response('fixture',{status:++n===1?status:200});const t=Date.now();assert.equal((await ctx({}).get('https://fixture.invalid')).status,200);assert.equal(n,2);assert.ok(Date.now()-t>=1900);}
let n=0;globalThis.fetch=async()=>{n++;return new Response('',{status:429,headers:{'retry-after':'60'}});};await ctx({}).get('https://fixture.invalid');assert.equal(n,1);
let attempts=[];const geo=await run('ipgeo',async url=>{attempts.push(url);return attempts.length===1?new Response('',{status:503}):Response.json({country:'US',city:'Fixture',organization_asn:15169});});assert.equal(attempts.length,2);assert.equal(geo.dados.provedor,'geojs');assert.equal(geo.dados.isp,null);
const rep=await run('ipreputacao',async()=>Response.json({success:true,results:{found:false,sources:[]}}));assert.deepEqual(rep.dados.listado,false);assert.equal(rep.dados.total,0);
let calls=0;const context=await run('ipcontexto',async()=>++calls===1?new Response('',{status:503}):Response.json({ip:a.valor,is_vpn:false}));assert.equal(context.dados.proxy,null);assert.equal(context.dados.parcial,true);
const email=await run('emailval',async url=>Response.json(url.includes('disify')?{format:true,dns:true,disposable:false}:{disposable:true}),{tipo:'email',valor:'fixture@example.invalid'});assert.equal(email.dados.descartavel,true);assert.equal(email.dados.valido,true);
let names=[];await run('nomeperfil',async url=>{names.push(url);return Response.json({name:'Maria',age:40,gender:'female',probability:.9,country:[]});},{tipo:'nome',valor:'Maria da Silva'});assert.equal(names.length,3);assert.ok(names.every(x=>x.endsWith('name=Maria')));assert.equal(source('nomeperfil').custo,3);
await assert.rejects(()=>run('rdap',async()=>{throw Error('must not call')},{tipo:'dominio',valor:'example.org'}),/tld sem rdap/);
assert.equal(REGISTRY.some(x=>['gitlab','emailrep','ceis'].includes(x.id)),false);
console.log('Closure fixtures: retry 429/503 only, Retry-After respected, fallback shapes, unknowns null, first-name queries and removals passed');
