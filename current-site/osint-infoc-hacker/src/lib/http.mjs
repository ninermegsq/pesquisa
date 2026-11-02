const UA_DEFAULT='ostnt.online scanner (+https://ostnt.online)';
export function ctx(env,origem){
  const c={env,origem,requests:0,async get(url,{accept='application/json',timeout=6000,method='GET',headers={},body=null}={}){
    const modo=env.UA_MODE||'identificado';
    if(!['identificado','navegador'].includes(modo))throw Error('UA_MODE inválido');
    const ua=modo==='navegador'?env.UA_NAVEGADOR:(env.UA||UA_DEFAULT);
    if(!ua)throw Error('UA_NAVEGADOR não configurado');
    const cabecalhos=new Headers({accept,...headers});
    if(!cabecalhos.has('user-agent'))cabecalhos.set('user-agent',ua);
    const signal=AbortSignal.timeout(timeout);let res;
    for(let attempt=0;attempt<2;attempt++){
      if(c.requests>=Math.min(38,Number(env.BUDGET_SUBREQ)||38))throw Error('Orçamento de subrequests esgotado');
      c.requests++;
      try{
        res=await fetch(url,{method,body,signal,redirect:'follow',headers:cabecalhos});
      }catch(e){
        // Timeout aborta a requisicao inteira. Como o orcamento ja conta uma
        // repeticao por fonte (custo*2), um timeout isolado deve ser repetido
        // uma vez em vez de derrubar a fonte.
        if(attempt===0&&(e?.name==='AbortError'||e?.name==='TimeoutError')){
          await new Promise(r=>setTimeout(r,800));
          continue;
        }
        throw e;
      }
      if(attempt||![429,503].includes(res.status))break;
      const retryAfter=res.headers.get('retry-after');
      const delay=retryAfter?(Number.isFinite(Number(retryAfter))?Number(retryAfter)*1000:Date.parse(retryAfter)-Date.now()):2000;
      // Respect provider delays rather than retry before a longer Retry-After.
      if(delay>2000)break;
      await res.body?.cancel();
      await new Promise((resolve,reject)=>{
        const fail=()=>{clearTimeout(timer);reject(signal.reason);};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',fail);resolve();},2000);
        signal.addEventListener('abort',fail,{once:true});if(signal.aborted)fail();
      });
    }
    if(!res.ok){try{res.corpo=(await res.clone().text()).slice(0,200).replace(/\s+/g,' ');}catch{res.corpo='';}}
    return res;
  }};
  return c;
}
export const ehAbort=e=>e?.name==='AbortError'||e?.name==='TimeoutError'||/abort|timeout/i.test(String(e?.message||''));

export function falhar(r){
 const e=new Error(`HTTP ${r.status}${r.corpo?' | '+r.corpo:''}`);
 e.status=r.status;e.corpo=r.corpo||'';return e;
}
