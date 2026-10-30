// Internal cache keys are never exposed by an HTTP route.
export const chaveCache=(id,alvo)=>new Request(`https://ostnt.online/__cache/${encodeURIComponent(id)}/${encodeURIComponent(alvo)}`);
export async function comCache(env,id,alvo,ttl,fn){
 const k=chaveCache(id,alvo);
 try{
   const hit=await caches.default.match(k);
   if(hit){const valor=JSON.parse(await hit.text());if(valor&&typeof valor==='object')return {valor,cache:'hit'};}
 }catch{}
 const valor=await fn();
 const segundos=typeof ttl==='function'?ttl(valor):ttl;
 if(segundos>0){
   try{await caches.default.put(k,new Response(JSON.stringify(valor),{headers:{'content-type':'application/json','cache-control':`public, max-age=${segundos}`}}));}
   catch(e){console.warn(JSON.stringify({event:'source_cache_write_failed',id,error:String(e?.message||e)}));}
 }
 return {valor,cache:'miss'};
}
