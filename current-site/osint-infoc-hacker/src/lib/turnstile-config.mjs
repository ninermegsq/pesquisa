const teste=v=>/^[123]x0{6,}/.test(String(v||''));
export function turnstileConfig(env,url){
 const origem=new URL(url).origin,hostname=new URL(url).hostname;
 const siteKey=env.TURNSTILE_SITEKEY||env.TURNSTILE_SITE_KEY||'';
 const siteTeste=teste(siteKey),secretTeste=teste(env.TURNSTILE_SECRET);
 if(siteTeste||secretTeste){
   const permitidas=(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim());
   if(env.APP_ENV!=='validation'||['ostnt.online','www.ostnt.online'].includes(hostname)||!permitidas.includes(origem))throw Error('Chaves de teste não permitidas neste ambiente.');
   if(env.TURNSTILE_SECRET&&siteTeste!==secretTeste)throw Error('Par de chaves Turnstile incompatível.');
 }
 return {siteKey,hostname,teste:siteTeste&&secretTeste};
}
export function turnstileVerificado(resultado,config){
 if(resultado?.success!==true)return false;
 // Dummy Siteverify responses observed/documented with localhost or example.com.
 // This exception is reachable only after the validation-only test-key guard.
 return resultado.hostname===config.hostname||(config.teste&&['localhost','example.com'].includes(resultado.hostname));
}
