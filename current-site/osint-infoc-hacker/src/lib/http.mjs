const UA_DEFAULT='ostnt.online scanner (+https://ostnt.online)';
export function ctx(env){
  const c={env,async get(url,{accept='application/json',timeout=6000,method='GET',headers={},body=null}={}){
    const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),timeout);
    try{return await fetch(url,{method,body,signal:ctl.signal,redirect:'follow',
      headers:{'user-agent':env.UA||UA_DEFAULT,accept,...headers}});}
    finally{clearTimeout(t);}
  }};
  return c;
}

export const ehAbort = e => e?.name === 'AbortError' || /abort/i.test(String(e?.message || ''));
