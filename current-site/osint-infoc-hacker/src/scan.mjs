import {detectar} from './lib/alvo.mjs';
import {ctx,ehAbort} from './lib/http.mjs';
import {comCache} from './lib/cache.mjs';
import {pontuar} from './lib/score.mjs';
import {REGISTRY} from './sources/registry.mjs';
import {render} from './render.mjs';

const BUDGET=38,LIM_HORA=10,LIM_DIA=60;
const CAB={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
export const json=(o,s=200,h={})=>new Response(JSON.stringify(o),{status:s,headers:{...CAB,...h}});

async function limite(env,ip){
  const h=new Date().toISOString().slice(0,13),d=h.slice(0,10);
  const nh=await env.OSINT_KV.get(`rl:h:${ip}:${h}`);const nd=await env.OSINT_KV.get(`rl:d:${ip}:${d}`);
  if(+nh>=LIM_HORA) return {ok:false,retry:3600};
  if(+nd>=LIM_DIA) return {ok:false,retry:86400};
  await env.OSINT_KV.put(`rl:h:${ip}:${h}`,String(+nh+1),{expirationTtl:3700});
  await env.OSINT_KV.put(`rl:d:${ip}:${d}`,String(+nd+1),{expirationTtl:90000});
  return {ok:true};
}
async function rodar(s,a,c){
  const t0=Date.now();
  try{
    const {valor,cache}=await comCache(c.env,s.id,a.valor,s.ttl,async()=>{try{return {status:'ok',timestamp:new Date().toISOString(),...await s.run(a,c)};}catch(e){return {status:ehAbort(e)?'timeout':'erro',timestamp:new Date().toISOString(),erro:String(e?.message||e).slice(0,120)};}});
    return {id:s.id,status:valor.status||'ok',erro:valor.erro??null,ms:Date.now()-t0,provenance:s.provenance,timestamp:valor.timestamp||new Date().toISOString(),cache,dados:valor.dados??null,pivos:valor.pivos??[]};
  }catch(e){
    return {id:s.id,status:ehAbort(e)?'timeout':'erro',ms:Date.now()-t0,provenance:s.provenance,erro:String(e?.message||e).slice(0,120)};
  }
}
export async function handleScan(request,env,ip){
  const body=await request.json().catch(()=>null);const bruto=body?.alvo;
  let alvo;try{alvo=detectar(bruto);}catch(e){return json({erro:e.message},400);}
  if(alvo.tipo==='cpf')return json({erro:'Consulta de CPF fora do escopo.'},400);
  let rl;try{rl=await limite(env,ip);}catch{return json({erro:'Cache obrigatório indisponível.'},503);}
  if(!rl.ok) return json({erro:'Limite atingido.'},429,{'retry-after':String(rl.retry)});
  const c=ctx(env);let gasto=0;
  const fila=REGISTRY.filter(s=>s.tipos.includes(alvo.tipo)).sort((x,y)=>x.custo-y.custo)
    .filter(s=>{if(gasto+s.custo>Math.min(BUDGET,Number(env.BUDGET_SUBREQ)||BUDGET))return false;gasto+=s.custo;return true;});
  const res=await Promise.all(fila.map(s=>rodar(s,alvo,c)));
  const pivos=[...new Set(res.flatMap(r=>r.pivos||[]).map(p=>`${p.tipo}:${p.valor}`))]
    .slice(0,12).map(x=>({tipo:x.split(':')[0],valor:x.slice(x.indexOf(':')+1)}));
  return json({alvo,gerado_em:new Date().toISOString(),
    fontes:res.map(({pivos:p,...r})=>r),
    disponibilidade:Object.fromEntries(res.map(r=>[r.id,r.status==='ok'])),
    score:pontuar(res),pivos,html:render(res),
    meta:{planejadas:fila.length,executadas:res.length,subrequests:gasto}});
}
