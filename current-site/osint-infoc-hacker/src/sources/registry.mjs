import {DDD} from '../data/ddd.mjs';
import {falhar} from '../lib/http.mjs';
import {md5} from '../lib/md5.mjs';
import {REGISTRY_META} from './registry.meta.mjs';
import {FaltaChaveError,FaltaTokenError} from '../contract.mjs';
const J = async r => {
 const t=await r.text();
 try{return JSON.parse(t);}catch{throw Error(`resposta não-JSON (HTTP ${r.status})`);}
};
const lista=v=>Array.isArray(v)?v:[];
const so=d=>String(d??'').replace(/\D/g,'');
// Telefone no formato internacional. O projeto e brasileiro (a fonte DDD le o
// prefixo 55): numero nacional de 10 ou 11 digitos recebe o codigo do pais.
// Com 12 ou mais digitos o valor ja vem com codigo e e preservado.
const telefoneE164=v=>{
  const d=so(v);
  return d.length>=12?d:'55'+d;
};
// Notas do SSL Labs, da melhor para a pior. A nota do host e a pior entre os
// endpoints avaliados (mesma regra do provedor); nota fora da escala conta
// como a pior, porque nao e uma nota confiavel.
const ORDEM_NOTA=['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E','F','T'];
const piorNota=notas=>{
  let pior=null,rank=-1;
  for(const n of notas){
    const i=ORDEM_NOTA.indexOf(String(n??'').toUpperCase());
    const r=i<0?ORDEM_NOTA.length:i;
    if(r>rank){rank=r;pior=n??null;}
  }
  return pior;
};
// O SSL Labs devolve os tempos em epoch (ms). O relatorio mostra ISO.
const isoTempo=v=>{
  if(v==null)return null;
  const d=typeof v==='number'?new Date(v):new Date(String(v));
  return Number.isNaN(d.getTime())?null:d.toISOString();
};

// Metadados vem do manifesto (src/sources/registry.json -> registry.meta.mjs).
const metaDe=id=>REGISTRY_META.fontes[id];

// Credencial opcional do operador, sempre declarada no manifesto.
// Ausencia da credencial vira erro de configuracao (sem_chave/sem_token):
// a fonte nao rodou, mas o restante do relatorio continua valendo.
function exigirCredencial(env,id){
  const requer=metaDe(id)?.requer;
  if(!requer)return;
  if(env&&env[requer.env])return;
  throw requer.tipo==='token'
    ?new FaltaTokenError(`sem token: ${requer.env}`)
    :new FaltaChaveError(requer.env);
}

export const REGISTRY=[
 {id:'gravatar',tipos:['email'],custo:1,ttl:86400,provenance:'gravatar-public-profile',
  async run(a,c){
    const h=md5(a.valor);
    const r=await c.get(`https://gravatar.com/${h}.json`,{timeout:5000});
    if(r.status===404) return {dados:{existe:false}};
    if(!r.ok) throw falhar(r);
    const e=lista((await J(r))?.entry)[0]||{};
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
    const j=lista(await J(r));
    return {dados:{total:j.length,contas:j.slice(0,5).map(u=>({login:u.username,nome:u.name,bio:u.bio||null}))}};
  }},
 {id:'npm',tipos:['email'],custo:1,ttl:21600,provenance:'npm-registry',
  async run(a,c){
    const r=await c.get(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(a.valor)}&size=5`,{timeout:6000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    return {dados:{total:j.total||0,pacotes:lista(j?.objects).map(o=>({nome:o?.package?.name,autor:o?.package?.author?.name||null}))}};
  }},
 {id:'bluesky',tipos:['email'],custo:1,ttl:21600,provenance:'bsky-public-api',
  async run(a,c){
    const r=await c.get(`https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=${encodeURIComponent(a.valor)}&limit=5`,{timeout:6000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    return {dados:{total:lista(j?.actors).length,atores:lista(j?.actors).map(x=>({handle:x.handle,nome:x.displayName||null}))}};
  }},
 {id:'telegram',tipos:['telefone'],custo:1,ttl:3600,provenance:'telegram-tme',
  async run(a,c){
    const numero=telefoneE164(a.valor);
    // Sem ?embed=1: o Telegram devolve a pagina renderizada no servidor, com
    // tgme_page_title e tgme_page_additional. Com ?embed=1 a resposta e um
    // widget em JavaScript, sem os campos que a fonte extrai.
    const r=await c.get(`https://t.me/+${numero}`,{accept:'text/html',timeout:5000});
    const campos={titulo:'',descricao:''};
    const parser=new HTMLRewriter()
      .on('.tgme_page_title',{text(t){campos.titulo+=t.text;}})
      .on('.tgme_page_description',{text(t){campos.descricao+=t.text;}})
      .on('.tgme_page_additional',{text(t){campos.descricao+=t.text;}});
    // No runtime do Cloudflare, transform() devolve a Response na hora e os
    // handlers disparam na leitura do corpo. O shim local pode devolver uma
    // Promise: normaliza os dois formatos antes de ler o corpo, senao a fonte
    // quebra o scan com "parser.transform(...).text is not a function".
    const saida=await Promise.resolve(parser.transform(r));
    if(typeof saida?.text==='function')await saida.text();
    const titulo=campos.titulo.trim(),descricao=campos.descricao.trim();
    // O Telegram serve a mesma pagina de contato para qualquer numero: a
    // pagina existir nao prova que exista conta. A fonte nao afirma o que o
    // provedor nao informa.
    return {dados:{paginaPublica:Boolean(titulo),usuario:'+'+numero,titulo:titulo||null,descricao:descricao||null,
      observacao:'O Telegram entrega a mesma pagina de contato para qualquer numero; a existencia da conta so e resolvida no aplicativo.'}};
  }},
 {id:'xon',tipos:['email'],custo:2,ttl:43200,provenance:'xposedornot',
  async run(a,c){
    const r=await c.get(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(a.valor)}`,{timeout:8000});
    if(r.status===404) return {dados:{total:0,breaches:[],senhas:{textoPuro:0,facilQuebrar:0,hashForte:0}}};
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    const bm=j?.BreachMetrics?.passwords||{};
    const br=lista(j?.breaches).flat().filter(x=>typeof x==='string').map(n=>({nome:n}));
    return {dados:{total:br.length,breaches:br,
      senhas:{textoPuro:bm.plain||0,facilQuebrar:bm.easyToCrack||0,hashForte:bm.strongHash||0}}};
  }},
 {id:'hudsonrock',tipos:['email'],custo:1,ttl:43200,provenance:'hudson-rock-cavalier',
  async run(a,c){
    const r=await c.get(`https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${encodeURIComponent(a.valor)}`,{timeout:7000});
    if(!r.ok) throw falhar(r);
    const m=(await J(r)).message||{};
    const st=lista(m?.stealers);
    return {dados:{infectado:Boolean(m.total_corporate_services||m.total_user_services),maquinas:st.length,
      logins:[...new Set(st.flatMap(s=>s?.stealer?.top_logins||[]))].slice(0,10),
      senhas:[...new Set(st.flatMap(s=>lista(s?.stealer?.top_passwords)))].slice(0,10).map(v=>String(v).length>2?String(v).slice(0,1)+'***'+String(v).slice(-1):'***'),
      antivirus:[...new Set(st.map(s=>s?.stealer?.antivirus).filter(Boolean))].slice(0,5),
      os:[...new Set(st.map(s=>s?.stealer?.operating_system).filter(Boolean))].slice(0,5),
      ultima:st.map(s=>s?.stealer?.date_compromised).filter(Boolean).sort().pop()||null}};
  }},
 {id:'github',tipos:['email'],custo:1,ttl:86400,provenance:'github-users-api',
  async run(a,c){
    exigirCredencial(c.env,'github');
    const r=await c.get(`https://api.github.com/search/users?q=${encodeURIComponent(a.valor)}+in:email&per_page=5`,{timeout:7000,
      headers:{authorization:`Bearer ${c.env.GITHUB_TOKEN}`,accept:'application/vnd.github+json'}});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    return {dados:{total:j.total_count||0,contas:lista(j?.items).map(u=>({login:u.login,url:u.html_url}))}};
  }},
 {id:'emailrep',tipos:['email'],custo:1,ttl:43200,provenance:'emailrep',
  async run(a,c){
    exigirCredencial(c.env,'emailrep');
    const r=await c.get(`https://emailrep.io/${encodeURIComponent(a.valor)}`,{timeout:7000,headers:{key:c.env.EMAILREP_KEY}});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    return {dados:{reputacao:j.reputation,suspeito:j.suspicious,blacklist:j.details?.blacklisted,perfis:j.details?.profiles||[]}};
  }},
 {id:'dns',tipos:['email','dominio'],custo:4,ttl:300,provenance:'google-doh',
  async run(a,c){
    const d=a.tipo==='email'?a.valor.split('@')[1]:a.valor;
    const q=async t=>{const r=await c.get(`https://dns.google/resolve?name=${encodeURIComponent(d)}&type=${t}`,{timeout:5000});
      if(!r.ok) throw falhar(r);return (await J(r)).Answer||[];};
    const [ra,tx,mx]=await Promise.all([q('A'),q('TXT'),q('MX')]);
    const t=tx.map(x=>String(x.data).replace(/"/g,''));
    let dmarc=false;
    try{const r=await c.get(`https://dns.google/resolve?name=_dmarc.${encodeURIComponent(d)}&type=TXT`,{timeout:5000});
      dmarc=r.ok&&((await J(r)).Answer||[]).length>0;}catch{}
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
    if(!Array.isArray(arr)||arr.length<2)return {dados:{total:0,parametros:[],amostra:[]}};
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
 // A API publica do Mozilla Observatory foi descontinuada: todas as rotas
 // /api/* respondem 404 e a SPA nao entrega mais os dados de seguranca do
 // host. A avaliacao TLS do dominio passou para o Qualys SSL Labs: a API
 // publica responde 200 com a nota em cache (ate 24h) e, quando o host ainda
 // nao foi avaliado, devolve status IN_PROGRESS sem nota. Isso nao e erro:
 // a fonte devolve o estado "em andamento" e o observacao explica.
 //
 // O formato real da resposta (v3) nao traz nota nem pontuacao no nivel do
 // host: a nota vem por endpoint, em `endpoints[].grade`. A fonte publica a
 // pior nota entre os servidores avaliados, que e a regra do proprio SSL Labs.
 {id:'ssllabs',tipos:['dominio'],custo:1,ttl:3600,provenance:'qualys-ssllabs',
  async run(a,c){
    const host=String(a.valor??'').trim().toLowerCase();
    const r=await c.get(`https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(host)}&fromCache=on&maxAge=24`,{timeout:9000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    const situacao=String(j.status??'').toUpperCase();
    if(situacao==='ERROR') throw Error(String(j.statusMessage||'erro na analise TLS'));
    if(situacao==='RATE_LIMIT') throw Error('limite de requisicoes do SSL Labs');
    if(situacao==='DNS') return {dados:{situacao:'dns',nota:null,
      observacao:'O SSL Labs nao conseguiu resolver este dominio, portanto nao ha avaliacao TLS para ele.'}};
    if(situacao!=='READY') return {ttl:300,dados:{situacao:'em_andamento',nota:null,
      observacao:'O SSL Labs iniciou a analise TLS deste dominio e ainda nao publicou a nota; a proxima consulta encontra a avaliacao em cache.'}};
    const endpoints=lista(j.endpoints);
    return {dados:{situacao:'pronta',nota:piorNota(endpoints.map(e=>e?.grade)),
      servidores:endpoints.length,avaliadoEm:isoTempo(j.testTime),avaliacaoIniciadaEm:isoTempo(j.startTime),
      avisos:endpoints.filter(e=>e?.hasWarnings).map(e=>({ip:e.ipAddress??null,mensagem:e.statusMessage??null})),
      observacao:'Nota TLS (cifra e configuracao do HTTPS) medida pelo Qualys SSL Labs; a nota exibida e a pior entre os servidores avaliados.'}};
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
    if(j.success===false) throw Error('IP inválido');
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
    exigirCredencial(c.env,'ceis');
    const r=await c.get(`https://api.portaldatransparencia.gov.br/api-de-dados/ceis?cnpjSancionado=${a.valor}`,{timeout:8000,
      headers:{'chave-api-dados':c.env.TRANSPARENCIA_KEY}});
    if(!r.ok) throw falhar(r);
    const j=lista(await J(r));
    return {dados:{total:j.length,sancoes:j.slice(0,5).map(s=>({orgao:s.orgaoSancionador?.nome,ini:s.dataInicioSancao,fim:s.dataFimSancao}))}};
  }},
 {id:'ddd',tipos:['telefone'],custo:0,ttl:0,provenance:'anatel-pgcn-snapshot-2026-10-30',
  async run(a,c){
    const ddd=a.valor.startsWith('55')?a.valor.slice(2,4):a.valor.slice(0,2);
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

// ---------------------------------------------------------------------------
// O manifesto e a fonte da verdade dos metadados. Qualquer divergencia entre
// src/sources/registry.json e a implementacao interrompe o carregamento do
// modulo: erro em tempo de build e nao em tempo de consulta.
// ---------------------------------------------------------------------------
for(const fonte of REGISTRY){
  const meta=metaDe(fonte.id);
  if(!meta)throw new Error(`fonte sem manifesto: ${fonte.id}`);
  if(String(fonte.tipos)!==String(meta.tipos))throw new Error(`tipos divergentes do manifesto: ${fonte.id}`);
  if(fonte.custo!==meta.custo)throw new Error(`custo divergente do manifesto: ${fonte.id}`);
  if(fonte.ttl!==meta.ttl)throw new Error(`ttl divergente do manifesto: ${fonte.id}`);
  if(fonte.provenance!==meta.provenance)throw new Error(`provenance divergente do manifesto: ${fonte.id}`);
  const usaCredencial=String(fonte.run).includes('exigirCredencial');
  if(usaCredencial!==Boolean(meta.requer))throw new Error(`credencial divergente do manifesto: ${fonte.id}`);
  Object.assign(fonte,{titulo:meta.titulo,chave:meta.chave,requer:meta.requer});
}
const idsManifesto=Object.keys(REGISTRY_META.fontes);
if(idsManifesto.length!==REGISTRY.length)throw new Error(`contagem de fontes divergente: manifesto ${idsManifesto.length}, implementacao ${REGISTRY.length}`);
for(const id of idsManifesto)if(!REGISTRY.some(f=>f.id===id))throw new Error(`fonte do manifesto sem implementacao: ${id}`);
