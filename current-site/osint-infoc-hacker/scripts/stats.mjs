import assert from 'node:assert/strict';

export const STATS_FALLBACK={total:27,email:13,categorias:6,keys:0};

export function totalFontes(registry=[]){return registry.length;}
export function fontesEmail(registry=[]){return registry.filter(s=>s.tipos.includes('email')).length;}
export function categoriasAlvo(registry=[]){
 const set=new Set();for(const s of registry)for(const t of s.tipos)set.add(t);return set.size;}
export function chavesVisitante(registry=[]){return registry.filter(s=>s.chave===true).length;}

export function statsDe(registry=[]){
 if(!Array.isArray(registry)||registry.length===0)return {...STATS_FALLBACK};
 return {total:totalFontes(registry),email:fontesEmail(registry),categorias:categoriasAlvo(registry),keys:chavesVisitante(registry)};
}

export const marcadorStats='data-stats="';

const escAttr=v=>v.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export function aplicarStats(html,registry=[]){
 assert.equal(typeof html,'string','aplicarStats(html): html deve ser string');
 const s=statsDe(registry);
 const json=escAttr(JSON.stringify(s));
 let out=html.replace(/\{\{STATS_TOTAL\}\}/g,String(s.total));
 out=out.replace(/\{\{STATS_EMAIL\}\}/g,String(s.email));
 out=out.replace(/\{\{STATS_CATEGORIAS\}\}/g,String(s.categorias));
 out=out.replace(/\{\{STATS_KEYS\}\}/g,String(s.keys));
 out=out.replace(/\{\{STATS_JSON\}\}/g,json);
 const i=out.indexOf(marcadorStats);
 assert.ok(i>=0,'aplicarStats: nenhum atributo data-stats encontrado no html');
 const abertura=out.indexOf('>',i);
 assert.ok(abertura>=0,'aplicarStats: atributo data-stats malformado (sem fechamento de tag)');
 const fechamento=out.indexOf('"',i+marcadorStats.length);
 assert.ok(fechamento>=0&&fechamento<abertura,'aplicarStats: valor do data-stats nao termina antes da tag');
 return out;
}
