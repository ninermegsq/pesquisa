import {detectar} from './lib/alvo.mjs';
import {ctx} from './lib/http.mjs';
import {comCache} from './lib/cache.mjs';
import {pontuar} from './lib/score.mjs';
import {REGISTRY} from './sources/registry.mjs';
import {render} from './render.mjs';
import {classificarErro,statusDeCodigo,saudeDe} from './contract.mjs';

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

// Registro do scan no Durable Object de saude. Best effort: se o DO nao
// existir (ambiente local) o scan continua normalmente.
async function registrarJob(env,jobId,fonteSaude,saude,escopo){
  try{
    const guard=env?.TOKEN_GUARD;
    if(!guard||typeof guard.getByName!=='function')return false;
    const stub=guard.getByName('osint-saude');
    if(!stub||typeof stub.registrarJob!=='function')return false;
    await stub.registrarJob(jobId,fonteSaude,{ok:saude.ok,falhas:saude.indisponiveis.length,parcial:saude.parcial,escopo});
    return true;
  }catch(e){
    console.error(JSON.stringify({event:'job_register',status:'erro',message:String(e?.message||e)}));
    return false;
  }
}

export async function rodar(s,a,c){
  const t0=Date.now();
  try{
    // TTL: o padrao da fonte (s.ttl). Uma fonte pode devolver um `ttl` proprio
    // quando o resultado e temporario (ex.: analise recem-iniciada, sem nota):
    // o valor menor vale para o cache dessa resposta especifica.
    const {valor,cache}=await comCache(c.env,c.origem,s.id,a.valor,s.custo===0?0:valor=>valor.status==='ok'?(Number(valor.ttl)||s.ttl):120,async()=>{
      const http=[];
      const contexto={...c,get:async(...args)=>{
        const r=await c.get(...args);http.push({host:new URL(args[0]).hostname,status:r.status});return r;
      }};
      try{
        const dados=await s.run(a,contexto);
        console.log(JSON.stringify({event:'source_run',id:s.id,status:'ok',http,ms:Date.now()-t0}));
        return {status:'ok',timestamp:new Date().toISOString(),...dados};
      }catch(e){
        const {codigo,mensagem}=classificarErro(e);
        const status=statusDeCodigo(codigo);
        // Raw exception in private Worker logs; report receives a bounded message.
        console.error(JSON.stringify({event:'source_run',id:s.id,status,erro_codigo:codigo,http,name:e?.name,message:mensagem,stack:e?.stack,ms:Date.now()-t0}));
        return {status,timestamp:new Date().toISOString(),erro_codigo:codigo,erro:mensagem};
      }
    });
    return {id:s.id,status:valor.status||'ok',erro:valor.erro??null,erro_codigo:valor.erro_codigo??null,ms:Date.now()-t0,provenance:s.provenance,timestamp:valor.timestamp||new Date().toISOString(),cache,dados:valor.dados??null,pivos:valor.pivos??[]};
  }catch(e){
    const {codigo,mensagem}=classificarErro(e);
    const status=statusDeCodigo(codigo);
    console.error(JSON.stringify({event:'source_run',id:s.id,status,erro_codigo:codigo,name:e?.name,message:mensagem,stack:e?.stack}));
    return {id:s.id,status,erro_codigo:codigo,ms:Date.now()-t0,provenance:s.provenance,erro:mensagem};
  }
}
export async function handleScan(request,env,ip,opcoes={}){
  const jobId=globalThis.crypto.randomUUID();
  const escopo=opcoes.escopo||'visitante';
  const body=await request.json().catch(()=>null);const bruto=body?.alvo;
  let alvo;try{alvo=detectar(bruto);}catch(e){return json({erro:e.message},400);}
  let rl;try{rl=await limite(env,ip);}catch{return json({erro:'Cache obrigatório indisponível.'},503);}
  if(!rl.ok) return json({erro:'Limite atingido.'},429,{'retry-after':String(rl.retry)});
  const origem=new URL(request.url).origin;
  const c=ctx(env,origem);let gasto=0;
  const fila=REGISTRY.filter(s=>s.tipos.includes(alvo.tipo)).sort((x,y)=>x.custo-y.custo)
    .filter(s=>{if(gasto+s.custo>Math.min(BUDGET,Number(env.BUDGET_SUBREQ)||BUDGET))return false;gasto+=s.custo;return true;});
  const res=await Promise.all(fila.map(s=>rodar(s,alvo,c)));
  const fontes=res.map(({pivos:p,...r})=>r);
  const pivos=[...new Set(res.flatMap(r=>r.pivos||[]).map(p=>`${p.tipo}:${p.valor}`))]
    .slice(0,12).map(x=>({tipo:x.split(':')[0],valor:x.slice(x.indexOf(':')+1)}));
  const saude=saudeDe(fontes);
  const fonteSaude=fontes.map(f=>({id:f.id,status:f.status,erro_codigo:f.erro_codigo??null,ms:f.ms??0,cache:f.cache??'miss'}));
  await registrarJob(env,jobId,fonteSaude,saude,escopo);
  console.log(JSON.stringify({event:'scan_done',job_id:jobId,escopo,alvo_tipo:alvo.tipo,executadas:fontes.length,parcial:saude.parcial,ms:Date.now()}));
  return json({alvo,gerado_em:new Date().toISOString(),
    fontes,
    disponibilidade:Object.fromEntries(res.map(r=>[r.id,r.status==='ok'])),
    score:pontuar(res),pivos,html:render(res),
    saude,fonte_saude:fonteSaude,
    meta:{job_id:jobId,escopo,planejadas:fila.length,executadas:res.length,subrequests:gasto}},200,{'x-job-id':jobId});
}
