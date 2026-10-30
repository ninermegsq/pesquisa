export async function comCache(env,id,alvo,ttl,fn){
 const k=`c:${id}:${alvo}`; let hit=null;
 try{hit=await env.OSINT_KV.get(k,'json');}catch{}
 if(hit && typeof hit==='object')return {valor:hit,cache:'hit'};
 const valor=await fn();
 const segundos=typeof ttl==='function'?ttl(valor):ttl;
 if(segundos>0){try{await env.OSINT_KV.put(k,JSON.stringify(valor),{expirationTtl:segundos});}catch{}}
 return {valor,cache:'miss'};
}
