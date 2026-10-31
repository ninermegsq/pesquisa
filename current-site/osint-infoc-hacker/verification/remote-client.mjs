// Authenticated Cloudflare service-binding client for isolated component tests.
// No request is made to the public workers.dev URL. Public-entry WAF is not tested.
export default {
 async fetch(request,env){
  if(env.VALIDATION_ORIGIN!=='https://ostnt-validation.ostnt.workers.dev')return new Response('Invalid validation component origin',{status:503});
  const url=new URL(request.url),origin=new URL(env.VALIDATION_ORIGIN);
  url.protocol=origin.protocol;url.host=origin.host;
  return env.VALIDATION_SERVICE.fetch(new Request(url,request));
 }
};
