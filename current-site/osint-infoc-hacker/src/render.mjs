export const esc=s=>s==null?'':String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chip=(v,cls='')=>`<span class="chip ${esc(cls)}">${esc(v)}</span>`;
const bloco=(titulo,corpo,r)=>{if(!corpo)return '';
 const selo=r?.cache === 'hit'?chip('cache','cyan'):'';
 const est=r&&r.status!=='ok'?chip(r.erro||r.status,'red'):'';
 // O acordeao comeca fechado (README, secao "Verificacao recomendada"): o
 // estado aberto era so do servidor, e o cliente ja gerava fechado. A seta
 // fica no <summary> para que o estado fechado seja legivel, e os chips de
 // cache e de erro permanecem no resumo: nenhuma informacao fica oculta.
 // O id da fonte viaja no data-fonte para que o mapa de conexoes consiga
 // abrir o acordeao correspondente ao clicar no no.
 return `<details class="acc" data-fonte="${esc(r?.id||'')}"><summary><span class="arr">▶</span><span>${esc(titulo)}</span>${selo}${est}</summary><div class="accbody">${corpo}</div></details>`;
};
const titulos={xon:'BREACHES & SENHAS',hudsonrock:'INFOSTEALER',gravatar:'GRAVATAR',pgp:'PGP',github:'GITHUB',emailrep:'REPUTAÇÃO',email_registro:'CADASTRO DE E-MAIL',dns:'DNS & E-MAIL',crtsh:'SUBDOMÍNIOS',wayback:'URLS HISTÓRICAS',internetdb:'EXPOSIÇÃO',ipgeo:'REDE',asn:'ASN',cnpj_br:'EMPRESA',ceis:'SANÇÕES',ddd:'REGIÃO',phone_footprint:'RASTREIO DE TELEFONE',numverify:'VALIDADE DO NÚMERO',wikidata:'WIKIDATA',datajud:'PROCESSOS',telegram:'TELEGRAM',gitlab:'GITLAB',npm:'NPM',bluesky:'BLUESKY',rdap:'RDAP',ssllabs:'SSL LABS',urlscan:'URLSCAN',cpf_valida:'CPF',cpf_brasilapi:'CADASTRO DE CPF',placa_footprint:'RASTREIO DE PLACA',placa_consultarplaca:'VEÍCULO',nome_perfil:'PERFIS'};
function campo(k,v){
 if(v==null)return '';
 if(Array.isArray(v))return v.length?`<div class="kv"><strong>${esc(k)}</strong>${v.map((x,i)=>campo(String(i+1),x)).join('')}</div>`:`<div class="kv">${esc(k)}: nenhum</div>`;
 if(typeof v==='object')return `<div class="kv"><strong>${esc(k)}</strong>${Object.entries(v).map(([a,b])=>campo(a,b)).join('')}</div>`;
 return `<div class="kv"><label>${esc(k)}:</label> ${esc(typeof v==='boolean'?(v?'sim':'não'):v)}</div>`;
}
export function render(res){return res.map(r=>{
 let corpo=r?.status==='ok'?Object.entries(r?.dados||{}).map(([k,v])=>campo(k,v)).join(''):'<p class="muted">Fonte indisponível. Resultado parcial.</p>';
 if(r?.id==='github'&&r?.status==='ok')corpo+= (r?.dados?.contas||[]).map(u=>{let url;try{url=new URL(u?.url);if(url.protocol!=='https:'||url.hostname!=='github.com')return '';}catch{return '';}
 return `<p><a href="${esc(url.href)}" target="_blank" rel="noopener">${esc(u?.login)}</a></p>`;}).join('');
 return bloco(titulos[r?.id]||r?.id,corpo||'<p>Nenhum dado retornado.</p>',r);
}).join('');}
