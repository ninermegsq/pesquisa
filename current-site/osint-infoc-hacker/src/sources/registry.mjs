import {DDD} from '../data/ddd.mjs';
import {falhar} from '../lib/http.mjs';
import {md5} from '../lib/md5.mjs';
const J = async r => {
 const t=await r.text();
 try{return JSON.parse(t);}catch{throw Error(`resposta não-JSON (HTTP ${r.status})`);}
};
const lista=v=>Array.isArray(v)?v:[];
const so=d=>String(d??'').replace(/\D/g,'');

export const REGISTRY=[
 {id:'gravatar',tipos:['email'],custo:1,ttl:86400,provenance:'gravatar-public-profile',
  async run(a,c){
    const h=md5(a.valor);
    const r=await c.get(`https://gravatar.com/${h}.json`,{timeout:5000});
    if(r.status===404) return {dados:{existe:false}};
    if(!r.ok) throw falhar(r);
    const j=await J(r);if(!Array.isArray(j?.entry))throw Error('Formato Gravatar inesperado');
    const e=j.entry[0];if(!e)return {dados:{existe:false}};
    return {dados:{existe:true,nome:e.displayName??null,sobre:e.aboutMe??null,local:e.currentLocation??null,
      urls:lista(e?.urls).map(u=>u.value),contas:lista(e?.accounts).map(x=>({rede:x.shortname,url:x.url})),
      avatar:`https://www.gravatar.com/avatar/${h}?d=404`}};
  }},
 {id:'pgp',tipos:['email'],custo:1,ttl:604800,provenance:'keys-openpgp',
  async run(a,c){
    const r=await c.get(`https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(a.valor)}`,{accept:'application/pgp-keys',timeout:5000});
    if(r.status===404) return {dados:{existe:false}};
    if(!r.ok) throw falhar(r);
    const t=await r.text();
    return {dados:{existe:true,uids:[...t.matchAll(/^uid\s+:(.*)$/gm)].map(m=>m[1].trim()).filter(Boolean)}};
  }},
 {id:'gitlab',tipos:['email'],custo:1,ttl:21600,provenance:'gitlab-users-api',
  async run(a,c){
    const r=await c.get(`https://gitlab.com/api/v4/users?search=${encodeURIComponent(a.valor)}`,{timeout:6000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);if(!Array.isArray(j))throw Error('Formato GitLab inesperado');
    return {dados:{total:j.length,contas:j.slice(0,5).map(u=>({login:u.username,nome:u.name,bio:u.bio||null}))}};
  }},
 {id:'npm',tipos:['email'],custo:1,ttl:21600,provenance:'npm-registry-exact-email-v2',
  async run(a,c){
    const r=await c.get(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(a.valor)}&size=5`,{timeout:6000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    if(!Array.isArray(j?.objects)||typeof j?.total!=='number')throw Error('Formato npm inesperado');
    const email=a.valor.toLowerCase();
    const objetos=j.objects.filter(o=>[o?.package?.author,o?.package?.publisher,...lista(o?.package?.maintainers)]
      .some(x=>typeof x?.email==='string'&&x.email.trim().toLowerCase()===email));
    return {dados:{total:objetos.length,pacotes:objetos.map(o=>({nome:o?.package?.name||null,autor:o?.package?.author?.name||null})),
      criterio:'E-mail exato nos metadados públicos do pacote; não comprova identidade.',amostra_examinada:j.objects.length,total_busca_ampla:j.total}};
  }},
 {id:'bluesky',tipos:['email'],custo:1,ttl:21600,provenance:'bsky-public-email-mention-v2',
  async run(a,c){
    const r=await c.get(`https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=${encodeURIComponent(a.valor)}&limit=5`,{timeout:6000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    if(!Array.isArray(j?.actors))throw Error('Formato Bluesky inesperado');
    const email=a.valor.toLowerCase();
    const atores=j.actors.filter(x=>[x?.displayName,x?.description].some(v=>typeof v==='string'&&
      (v.toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[]).includes(email)));
    return {dados:{total:atores.length,atores:atores.map(x=>({handle:x?.handle||null,nome:x?.displayName||null})),
      criterio:'Menção pública literal ao e-mail; não comprova titularidade da conta.',amostra_examinada:j.actors.length}};
  }},
 {id:'telegram',tipos:['telefone'],custo:1,ttl:3600,provenance:'telegram-tme',
  async run(a,c){
    const numero=so(a.valor);
    const r=await c.get(`https://t.me/+${numero}?embed=1`,{accept:'text/html',timeout:5000});
    if(!r.ok&&r.status!==404)throw falhar(r);
    const campos={titulo:'',descricao:''};
    const parser=new HTMLRewriter()
      .on('.tgme_page_title',{text(t){campos.titulo+=t.text;}})
      .on('.tgme_page_description',{text(t){campos.descricao+=t.text;}});
    await parser.transform(r).text();
    const titulo=campos.titulo.trim(),descricao=campos.descricao.trim();
    return {dados:{existe:Boolean(titulo),usuario:'+'+numero,titulo:titulo||null,descricao:descricao||null}};
  }},
 {id:'xon',tipos:['email'],custo:2,ttl:43200,provenance:'xposedornot',
  async run(a,c){
    const r=await c.get(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(a.valor)}`,{timeout:8000});
    if(r.status===404) return {dados:{total:0,breaches:[],senhas:{textoPuro:0,facilQuebrar:0,hashForte:0}}};
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    if(!Array.isArray(j?.breaches))throw Error('Formato XposedOrNot inesperado');
    const bm=j?.BreachMetrics?.passwords||{};
    const br=lista(j?.breaches).flat().filter(x=>typeof x==='string').map(n=>({nome:n}));
    return {dados:{total:br.length,breaches:br,
      senhas:{disponivel:Object.keys(bm).length>0,textoPuro:bm.plain??null,facilQuebrar:bm.easyToCrack??null,hashForte:bm.strongHash??null}}};
  }},
 {id:'hudsonrock',tipos:['email'],custo:1,ttl:43200,provenance:'hudson-rock-cavalier',
  async run(a,c){
    const r=await c.get(`https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${encodeURIComponent(a.valor)}`,{timeout:7000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    const m=j?.message&&typeof j.message==='object'?j.message:j;
    if(!Array.isArray(m?.stealers))throw Error('Formato de infostealer não reconhecido; resultado inconclusivo');
    const st=m.stealers;
    if(st.some(s=>!s||typeof s!=='object'))throw Error('Formato de infostealer inesperado');
    const maquinas=st.map(s=>s?.stealer&&typeof s.stealer==='object'?s.stealer:s);
    return {dados:{infectado:Boolean(st.length||Number(m.total_corporate_services)||Number(m.total_user_services)),maquinas:st.length,
      logins:[...new Set(maquinas.flatMap(s=>lista(s?.top_logins).filter(x=>typeof x==='string')))].slice(0,10),
      senhas:[...new Set(maquinas.flatMap(s=>lista(s?.top_passwords).filter(x=>typeof x==='string')))].slice(0,10).map(v=>String(v).length>2?String(v).slice(0,1)+'***'+String(v).slice(-1):'***'),
      antivirus:[...new Set(maquinas.map(s=>s?.antivirus).filter(Boolean))].slice(0,5),
      os:[...new Set(maquinas.map(s=>s?.operating_system).filter(Boolean))].slice(0,5),
      ultima:maquinas.map(s=>s?.date_compromised).filter(Boolean).sort().pop()||null}};
  }},
 {id:'github',tipos:['email'],custo:1,ttl:86400,provenance:'github-users-api',
  async run(a,c){
    if(!c.env.GITHUB_TOKEN) throw Error('sem token');
    const r=await c.get(`https://api.github.com/search/users?q=${encodeURIComponent(a.valor)}+in:email&per_page=5`,{timeout:7000,
      headers:{authorization:`Bearer ${c.env.GITHUB_TOKEN}`,accept:'application/vnd.github+json'}});
    if(!r.ok){const e=falhar(r);if(r.status===401)e.message='Token do GitHub inválido. '+e.message;else if(r.status===429||(r.status===403&&r.headers.get('x-ratelimit-remaining')==='0'))e.message='Limite do GitHub atingido. '+e.message;throw e;}
    const j=await J(r);
    if(!Array.isArray(j?.items)||typeof j?.total_count!=='number')throw Error('Formato GitHub inesperado');
    return {dados:{total:j.total_count||0,contas:lista(j?.items).map(u=>({login:u.login,url:u.html_url}))}};
  }},
 {id:'emailrep',tipos:['email'],custo:1,ttl:43200,provenance:'emailrep',
  async run(a,c){
    if(!c.env.EMAILREP_KEY) throw Error('sem chave');
    const r=await c.get(`https://emailrep.io/${encodeURIComponent(a.valor)}`,{timeout:7000,headers:{key:c.env.EMAILREP_KEY}});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    return {dados:{reputacao:j.reputation,suspeito:j.suspicious,blacklist:j.details?.blacklisted,perfis:j.details?.profiles||[]}};
  }},
 {id:'dns',tipos:['email','dominio'],custo:4,ttl:300,provenance:'google-doh',
  async run(a,c){
    const d=a.tipo==='email'?a.valor.split('@')[1]:a.valor;
    const q=async t=>{const r=await c.get(`https://dns.google/resolve?name=${encodeURIComponent(d)}&type=${t}`,{timeout:5000});
      if(!r.ok) throw falhar(r);const j=await J(r);if(j?.Status!==0)throw Error(`Resposta DNS ${j?.Status??'inválida'}`);return lista(j?.Answer);};
    const [ra,tx,mx]=await Promise.all([q('A'),q('TXT'),q('MX')]);
    const t=tx.map(x=>String(x.data).replace(/"/g,''));
    let dmarc=null;
    try{const r=await c.get(`https://dns.google/resolve?name=_dmarc.${encodeURIComponent(d)}&type=TXT`,{timeout:5000});
      if(r.ok){const j=await J(r);if(j?.Status===0||j?.Status===3)dmarc=lista(j?.Answer).length>0;}}catch{}
    return {dados:{dominio:d,ips:ra.map(x=>x.data).slice(0,5),mx:mx.map(x=>x.data).slice(0,5),
      txt:t.slice(0,8),hasSPF:t.some(x=>/^v=spf1/i.test(x)),dmarc}};
  }},
 {id:'crtsh',tipos:['email','dominio'],custo:1,ttl:43200,provenance:'subdomain-center',
  async run(a,c){
    const d=a.tipo==='email'?a.valor.split('@')[1]:a.valor;
    const r=await c.get(`https://api.subdomain.center/?domain=${encodeURIComponent(d)}`,{timeout:9000});
    if(!r.ok) throw falhar(r);
    const arr=await J(r);
    if(!Array.isArray(arr))throw Error('formato inesperado');
    const subs=[...new Set(arr.filter(x=>typeof x==='string').map(x=>x.trim().toLowerCase().replace(/\.$/,''))
      .filter(x=>x.endsWith('.'+d)&&x.length<=253&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(x)&&!x.includes('..')))].slice(0,60);
    return {dados:{total:subs.length,subdominios:subs},pivos:subs.slice(0,8).map(v=>({tipo:'dominio',valor:v}))};
  }},
 {id:'wayback',tipos:['email','dominio'],custo:1,ttl:43200,provenance:'wayback-cdx',
  async run(a,c){
    const d=a.tipo==='email'?a.valor.split('@')[1]:a.valor;
    const r=await c.get(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(d)}/*&output=json&fl=original,timestamp&collapse=urlkey&limit=200`,{timeout:9000});
    if(!r.ok) throw falhar(r);
    const arr=await J(r);
    if(!Array.isArray(arr))throw Error('Formato Wayback inesperado');
    if(arr.length<2)return {dados:{total:0,parametros:[],amostra:[]}};
    const urls=arr.slice(1).map(x=>x?.[0]).filter(Boolean);
    const params=[...new Set(urls.flatMap(u=>{try{return [...new URL(u).searchParams.keys()]}catch{return[]}}))].slice(0,20);
    return {dados:{total:urls.length,parametros:params,amostra:urls.slice(0,15)}};
  }},
 {id:'rdap',tipos:['dominio'],custo:1,ttl:86400,provenance:'rdap',
  async run(a,c){
    const base=a.valor.endsWith('.br')?'https://rdap.registro.br/domain/':'https://rdap.org/domain/';
    const r=await c.get(base+encodeURIComponent(a.valor),{timeout:7000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    return {dados:{handle:j.handle,status:j.status||[],eventos:lista(j?.events).map(e=>({acao:e.eventAction,data:e.eventDate})),
      ns:lista(j?.nameservers).map(n=>n.ldhName),entidades:lista(j?.entities).map(e=>e.handle).filter(Boolean)}};
  }},
 {id:'observatory',tipos:['dominio'],custo:1,ttl:3600,provenance:'mdn-observatory-v2',
  async run(a,c){
    const r=await c.get(`https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${encodeURIComponent(a.valor)}`,{method:'POST',timeout:9000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    if(j?.error)throw Error(String(j.message||j.error));
    return {dados:{nota:j?.grade??null,score:j?.score??null,falhas:null,testes_falhos:j?.tests_failed??null,testes_aprovados:j?.tests_passed??null,detalhes:j?.details_url??null}};
  }},
 {id:'urlscan',tipos:['dominio'],custo:1,ttl:21600,provenance:'urlscan-public',
  async run(a,c){
    const r=await c.get(`https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(a.valor)}&size=10`,{timeout:7000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    return {dados:{total:j.total||0,scans:lista(j?.results).map(x=>({url:x.page?.url,ip:x.page?.ip,servidor:x.page?.server}))}};
  }},
 {id:'internetdb',tipos:['ip'],custo:1,ttl:3600,provenance:'shodan-internetdb',
  async run(a,c){
    const r=await c.get(`https://internetdb.shodan.io/${a.valor}`,{timeout:6000});
    if(r.status===404) return {dados:{portas:[],vulns:[],hostnames:[],cpes:[]}};
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    return {dados:{portas:j.ports||[],vulns:j.vulns||[],hostnames:j.hostnames||[],cpes:j.cpes||[]}};
  }},
 {id:'ipgeo',tipos:['ip'],custo:1,ttl:86400,provenance:'ipwhois',
  async run(a,c){
    const r=await c.get(`https://ipwho.is/${encodeURIComponent(a.valor)}`,{timeout:6000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    if(j?.success===false) throw Error('IP inválido');
    if(j?.success!==true)throw Error('Formato IPWHOIS inesperado');
    return {dados:{pais:j.country,cidade:j.city,asn:j.connection?.asn,org:j.connection?.org,isp:j.connection?.isp}};
  }},
 {id:'asn',tipos:['ip'],custo:1,ttl:86400,provenance:'team-cymru-dns',
  async run(a,c){
    if(!/^\d+\.\d+\.\d+\.\d+$/.test(a.valor)) throw Error('IPv4 apenas');
    const rev=a.valor.split('.').reverse().join('.');
    const r=await c.get(`https://dns.google/resolve?name=${rev}.origin.asn.cymru.com&type=TXT`,{timeout:6000});
    if(!r.ok) throw falhar(r);
    const raw=((await J(r)).Answer||[]).map(x=>String(x.data).replace(/"/g,'')).join(' ');
    const [asn,prefixo,pais,registro]=raw.split('|').map(x=>x.trim());
    return {dados:{asn:asn||null,prefixo:prefixo||null,pais:pais||null,registro:registro||null}};
  }},
 {id:'cnpj_br',tipos:['cnpj'],custo:1,ttl:86400,provenance:'minha-receita-cnpj',
  async run(a,c){
    const r=await c.get(`https://minhareceita.org/${encodeURIComponent(a.valor)}`,{timeout:8000});
    if(r.status===404) return {dados:{existe:false}};
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    if(!j||typeof j!=='object'||Array.isArray(j)||String(j.cnpj)!==a.valor)throw Error('formato inesperado de CNPJ');
    const socios=lista(j?.qsa).map(s=>({nome:s.nome_socio,qual:s.qualificacao_socio}));
    return {dados:{existe:true,razao:j.razao_social,fantasia:j.nome_fantasia,
      situacao:j.descricao_situacao_cadastral,cnae:j.cnae_fiscal_descricao,capital:j.capital_social,
      uf:j.uf,municipio:j.municipio,socios,
      endereco:[j.logradouro,j.numero,j.bairro,j.cep].filter(Boolean).join(', ')},
      pivos:socios.map(s=>({tipo:'nome',valor:s.nome}))};
  }},
 {id:'ceis',tipos:['cnpj'],custo:1,ttl:86400,provenance:'portal-transparencia-ceis',
  async run(a,c){
    if(!c.env.TRANSPARENCIA_KEY) throw Error('sem chave');
    const r=await c.get(`https://api.portaldatransparencia.gov.br/api-de-dados/ceis?cnpjSancionado=${a.valor}`,{timeout:8000,
      headers:{'chave-api-dados':c.env.TRANSPARENCIA_KEY}});
    if(!r.ok) throw falhar(r);
    const j=lista(await J(r));
    return {dados:{total:j.length,sancoes:j.slice(0,5).map(s=>({orgao:s.orgaoSancionador?.nome,ini:s.dataInicioSancao,fim:s.dataFimSancao}))}};
  }},
 {id:'ddd',tipos:['telefone'],custo:0,ttl:0,provenance:'anatel-pgcn-snapshot-2026-10-30',
  async run(a,c){
    const ddd=a.valor.length>11&&a.valor.startsWith('55')?a.valor.slice(2,4):a.valor.slice(0,2);
    const registro=DDD[ddd];
    if(!registro)throw Error('DDD não encontrado na tabela local da Anatel');
    return {dados:{ddd,...registro}};
  }},
 {id:'wikidata',tipos:['nome'],custo:1,ttl:604800,provenance:'wikidata-sparql',
  async run(a,c){
    const q=`SELECT ?item ?itemLabel ?desc WHERE{?item rdfs:label "${a.valor.replace(/"/g,'')}"@pt-BR;schema:description ?desc. SERVICE wikibase:label{bd:serviceParam wikibase:language "pt".}} LIMIT 5`;
    const r=await c.get(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`,{timeout:9000});
    if(!r.ok) throw falhar(r);
    const b=(await J(r)).results?.bindings||[];
    return {dados:{total:b.length,entidades:b.map(x=>({id:String(x?.item?.value||'').split('/').pop(),desc:x?.desc?.value??null}))}};
  }},
 {id:'datajud',tipos:['nome'],custo:2,ttl:86400,provenance:'cnj-datajud',
  async run(a,c){
    const key='APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
    const limpo=a.valor.replace(/[:"“”()\[\]{}^~*?\\!]/g,' ').replace(/\s+/g,' ').trim();
    const url='https://api-publica.datajud.cnj.jus.br/api_publica_stj/_search';
    const headers={authorization:key,'content-type':'application/json'};
    let r=await c.get(url,{method:'POST',timeout:9000,headers,
      body:JSON.stringify({size:10,query:{query_string:{query:limpo,default_field:'partes.nome'}}})});
    if(r.status===400)r=await c.get(url,{method:'POST',timeout:9000,headers,
      body:JSON.stringify({size:10,query:{match:{'partes.nome':{query:limpo,operator:'and'}}}})});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    const hits=lista(j?.hits?.hits);
    return {dados:{total:j?.hits?.total?.value||0,processos:hits.map(h=>({numero:h?._source?.numeroProcesso??null,classe:h?._source?.classe?.nome??null}))}};
  }}
];
