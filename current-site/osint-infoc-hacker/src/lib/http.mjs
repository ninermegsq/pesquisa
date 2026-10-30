const UA_DEFAULT='ostnt.online scanner (+https://ostnt.online)';
export function ctx(env,origem){
  const c={env,origem,async get(url,{accept='application/json',timeout=6000,method='GET',headers={},body=null}={}){
    // Keep the deadline active while J() or text() reads the response body.
    return fetch(url,{method,body,signal:AbortSignal.timeout(timeout),redirect:'follow',
      headers:{'user-agent':env.UA||UA_DEFAULT,accept,...headers}});
  }};
  return c;
}
export const ehAbort=e=>e?.name==='AbortError'||e?.name==='TimeoutError'||/abort|timeout/i.test(String(e?.message||''));
