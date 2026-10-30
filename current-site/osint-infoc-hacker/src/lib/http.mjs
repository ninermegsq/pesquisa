const UA_DEFAULT='ostnt.online scanner (+https://ostnt.online)';
export function ctx(env,origem){
  const c={env,origem,async get(url,{accept='application/json',timeout=6000,method='GET',headers={},body=null}={}){
    const modo=env.UA_MODE||'identificado';
    if(!['identificado','navegador'].includes(modo))throw Error('UA_MODE inválido');
    const ua=modo==='navegador'?env.UA_NAVEGADOR:(env.UA||UA_DEFAULT);
    if(!ua)throw Error('UA_NAVEGADOR não configurado');
    const cabecalhos=new Headers({accept,...headers});
    cabecalhos.set('user-agent',ua);
    // Keep the deadline active while J() or text() reads the response body.
    const res=await fetch(url,{method,body,signal:AbortSignal.timeout(timeout),redirect:'follow',
      headers:cabecalhos});
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
