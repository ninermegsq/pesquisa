import {DDD} from '../data/ddd.mjs';
import {perfilNome} from '../data/nomes.mjs';
import {falhar} from '../lib/http.mjs';
import {md5} from '../lib/md5.mjs';
const J = async r => {
 const t=await r.text();
 try{return JSON.parse(t);}catch{throw Error(`resposta não-JSON (HTTP ${r.status})`);}
};
const lista=v=>Array.isArray(v)?v:[];
const so=d=>String(d??'').replace(/\D/g,'');

export const REGISTRY=[
 {id:'emailval',tipos:['email'],custo:2,ttl:43200,provenance:'disify-kickbox-v1',
  async run(a,c){
   const erros=[],dados={descartavel:null,valido:null,dominioExiste:null};
   for(const provider of ['disify','kickbox']){try{
    const url=provider==='disify'?`https://disify.com/api/email/${encodeURIComponent(a.valor)}`:`https://open.kickbox.com/v1/disposable/${encodeURIComponent(a.valor)}`;
    const r=await c.get(url,{timeout:6000});if(!r.ok)throw falhar(r);const j=await J(r);
    if(typeof j?.disposable!=='boolean')throw Error('Formato de validação inesperado');
    dados.descartavel=dados.descartavel===true||j.disposable;
    if(provider==='disify'){if(typeof j?.format!=='boolean'||typeof j?.dns!=='boolean')throw Error('Formato DISIFY inesperado');dados.valido=j.format;dados.dominioExiste=j.dns;}
   }catch(e){erros.push({provedor:provider,erro:String(e?.message||e).slice(0,220)});}}
   if(erros.length===2)throw Error(erros.map(x=>x.provedor+': '+x.erro).join(' | '));
   return {dados:{...dados,parcial:erros.length>0,erros,criterio:'Validade de formato e domínio; não confirma existência da caixa postal.'}};
  }},
 {id:'nomeperfil',tipos:['nome'],custo:3,ttl:604800,provenance:'agify-genderize-nationalize-tabela-local-v2',
  async run(a,c){
   const n=a.valor.trim().split(/\s+/)[0],dados={idadeProvavel:null,generoProvavel:null,nacionalidadeProvavel:null},erros=[];
   for(const provider of ['agify','genderize','nationalize']){try{
    const r=await c.get(`https://api.${provider}.io?name=${encodeURIComponent(n)}`,{timeout:6000});if(!r.ok)throw falhar(r);const j=await J(r);
    if(j?.error||typeof j?.name!=='string')throw Error('Formato de perfil provável inesperado');
    if(provider==='agify')dados.idadeProvavel=typeof j.age==='number'?j.age:null;
    if(provider==='genderize')dados.generoProvavel=j?.gender==null?null:{valor:j.gender,probabilidade:j.probability??null};
    if(provider==='nationalize')dados.nacionalidadeProvavel=lista(j?.country).map(x=>({pais:x?.country_id??null,probabilidade:x?.probability??null}));
   }catch(e){erros.push({provedor:provider,erro:String(e?.message||e).slice(0,220)});}}
   // As tres APIs publicas de nome tem limite por IP e responderam 429 de forma
   // consistente; sem a tabela local a fonte inteira cairia no Worker. A tabela
   // cobre os nomes mais frequentes do Censo do IBGE e completa o que falta.
   const local=perfilNome(n);
   if(local){
    if(dados.generoProvavel===null&&local.sexoProvavel)dados.generoProvavel={valor:local.sexoProvavel,probabilidade:local.probabilidade};
    if(dados.nacionalidadeProvavel===null&&local.nacionalidadeProvavel)dados.nacionalidadeProvavel=[{pais:local.nacionalidadeProvavel,probabilidade:null}];
    if(dados.idadeProvavel===null&&local.faixaEtariaProvavel)dados.idadeProvavel=local.faixaEtariaProvavel;
   }
   if(erros.length===3&&!local)throw Error(erros.map(x=>x.provedor+': '+x.erro).join(' | '));
   return {dados:{...dados,parcial:erros.length>0,erros,baseLocal:Boolean(local),
    criterio:'Estimativa estatística provável do primeiro nome; não descreve nem identifica uma pessoa.'}};
  }},
 {id:'ipreputacao',tipos:['ip'],custo:1,ttl:21600,provenance:'ipguardian-v1',
  async run(a,c){
   const r=await c.get('https://ipguardian.net/api/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ip:a.valor}),timeout:7000});
   if(!r.ok)throw falhar(r);const j=await J(r),v=j?.results;
   if(j?.success!==true||typeof v?.found!=='boolean'||!Array.isArray(v?.sources))throw Error('Formato IPGuardian inesperado');
   return {dados:{listado:v.found,total:v.sources.length,criterio:'Listas públicas retornadas (máximo 10); presença não comprova atividade maliciosa.'}};
  }},
 {id:'ipcontexto',tipos:['ip'],custo:2,ttl:21600,provenance:'ipquery-vpndetection-v2',
  async run(a,c){
   const erros=[];
   // ipquery.io devolve os quatro booleanos de uma vez e responde em ~500ms.
   // O iplogs anterior devolvia HTTP 400 e degradava a fonte inteira.
   for(const provider of ['ipquery','vpndetection']){try{
    const r=await c.get(provider==='ipquery'?`https://api.ipquery.io/${encodeURIComponent(a.valor)}`:`https://api.vpndetection.io/${encodeURIComponent(a.valor)}`,{timeout:7000});
    if(!r.ok)throw falhar(r);const j=await J(r);
    if(provider==='ipquery'){
     if(typeof j?.risk?.is_vpn!=='boolean')throw Error('Formato IP contexto inesperado');
     const bool=v=>typeof v==='boolean'?v:null;
     return {dados:{vpn:j.risk.is_vpn,proxy:bool(j?.risk?.is_proxy),tor:bool(j?.risk?.is_tor),datacenter:bool(j?.risk?.is_datacenter),
      isMobile:bool(j?.risk?.is_mobile),provedor:provider,parcial:false,erros,
      criterio:'Classificação provável da infraestrutura; não caracteriza o usuário.'}};
    }
    if(typeof j?.is_vpn!=='boolean')throw Error('Formato IP contexto inesperado');
    const bool=v=>typeof v==='boolean'?v:null;
    return {dados:{vpn:j.is_vpn,proxy:bool(j?.is_proxy),tor:bool(j?.is_tor),datacenter:bool(j?.is_hosting),provedor:provider,parcial:true,erros,
      criterio:'Classificação provável da infraestrutura; não caracteriza o usuário.'}};
   }catch(e){erros.push({provedor:provider,erro:String(e?.message||e).slice(0,220)});}}
   throw Error(erros.map(x=>x.provedor+': '+x.erro).join(' | '));
  }},

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
 {id:'xon',tipos:['email'],custo:2,ttl:43200,provenance:'xposedornot-check-email-v2',
  async run(a,c){
    const r=await c.get(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(a.valor)}`,{timeout:8000});
    if(r.status===404) return {dados:{total:0,breaches:[],senhas:{textoPuro:0,facilQuebrar:0,hashForte:0}}};
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    if(j?.Error==='Not found'&&j?.email===null)return {dados:{total:0,breaches:[],senhas:{disponivel:false,textoPuro:null,facilQuebrar:null,hashForte:null}}};
    if(!Array.isArray(j?.breaches))throw Error('Formato XposedOrNot inesperado | '+JSON.stringify(j).slice(0,180));
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
    // A busca de usuarios do GitHub responde sem token (limite de 10/min por IP),
    // entao o token e um acelerador e nao um requisito. Com token o limite sobe
    // para 30/min. Sem nenhum dos dois a fonte fica indisponivel, nunca zero.
    const token=c.env.GITHUB_TOKEN;
    const headers={accept:'application/vnd.github+json',...(token?{authorization:`Bearer ${token}`}:{})};
    const r=await c.get(`https://api.github.com/search/users?q=${encodeURIComponent(a.valor)}+in:email&per_page=5`,{timeout:7000,headers});
    if(!r.ok){const e=falhar(r);
     if(r.status===401)e.message='Token do GitHub inválido. '+e.message;
     else if(r.status===403)e.message='Limite do GitHub atingido. '+e.message;
     else if(r.status===429)e.message='Limite do GitHub atingido. '+e.message;
     throw e;}
    const j=await J(r);
    if(!Array.isArray(j?.items)||typeof j?.total_count!=='number')throw Error('Formato GitHub inesperado');
    return {dados:{total:j.total_count||0,contas:lista(j?.items).map(u=>({login:u.login,url:u.html_url})),
      autenticado:Boolean(token),
      criterio:'Contas com o e-mail no campo publico do perfil. Não prova titularidade.'}};
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
 {id:'wayback',tipos:['dominio'],custo:1,ttl:43200,provenance:'wayback-cdx-host-v3',
  async run(a,c){
    const d=a.tipo==='email'?a.valor.split('@')[1]:a.valor;
    // A consulta por prefixo (url=host/*) satura o indice do Internet Archive e devolve
    // 503 "Temporarily Offline" ou estoura o timeout. A consulta por host exato responde
    // em segundos; a deduplicacao e feita localmente. Subdominios seguem cobertos por crtsh.
    const r=await c.get(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(d)}&output=json&fl=original&limit=60&filter=statuscode:200`,{timeout:9000});
    if(r.status===503)throw Error('Arquivo Wayback temporariamente indisponivel');
    if(!r.ok) throw falhar(r);
    const arr=await J(r);
    if(!Array.isArray(arr))throw Error('Formato Wayback inesperado');
    if(arr.length<2)return {dados:{total:0,parametros:[],amostra:[]}};
    const urls=[...new Set(arr.slice(1).map(x=>x?.[0]).filter(Boolean))];
    const params=[...new Set(urls.flatMap(u=>{try{return [...new URL(u).searchParams.keys()]}catch{return[]}}))].slice(0,20);
    return {dados:{total:urls.length,parametros:params,amostra:urls.slice(0,15)}};
  }},
 {id:'rdap',tipos:['dominio'],custo:1,ttl:86400,provenance:'rdap-org-agregador-v4',
  async run(a,c){
    // rdap.org agrega o RDAP de qualquer TLD delegando ao registro correto.
    // A versao anterior so cobria .br/.com/.net e devolvia 404 nos demais.
    //
    // O agregador responde 403 para User-Agent de navegador (challenge do
    // Cloudflare) e 200 para o UA identificavel do projeto. Por isso a fonte
    // envia o UA de contato explicito, em vez de herdar o UA do modo.
    const r=await c.get(`https://rdap.org/domain/${encodeURIComponent(a.valor)}`,{timeout:8000,accept:'application/rdap+json, application/json',
      headers:{'user-agent':c.env.UA_CONTATO||'ostnt.online/1.0 (+https://ostnt.online)'}});
    if(r.status===404) return {dados:{registrado:false,handle:null,status:[],eventos:[],ns:[],entidades:[]}};
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    const eventos=lista(j?.events).map(e=>({acao:e?.eventAction,data:e?.eventDate}));
    const ns=lista(j?.nameservers).map(n=>({nome:n?.ldhName??null,ipv4:lista(n?.ipAddresses?.v4)}));
    return {dados:{registrado:true,handle:j?.handle??null,status:lista(j?.status).length?lista(j?.status):[j?.status].filter(Boolean),
      eventos,ns,entidades:lista(j?.entities).map(e=>e?.handle).filter(Boolean),
      registro:j?.ldhName??null,
      criterio:'Dados publicos de registro do dominio. Nao identifica o titular.'}};
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
 {id:'ipgeo',tipos:['ip'],custo:2,ttl:86400,provenance:'ipquery-geojs-v3',
  async run(a,c){
    const tentativas=[];
    // ipapi.co passou a devolver 404 em varias regioes; ipquery responde em ~500ms.
    for(const provider of ['ipquery','geojs']){
      try{
        const url=provider==='ipquery'?`https://api.ipquery.io/${encodeURIComponent(a.valor)}`:`https://get.geojs.io/v1/ip/geo/${encodeURIComponent(a.valor)}.json`;
        const r=await c.get(url,{timeout:6000});if(!r.ok)throw falhar(r);const j=await J(r);
        if(provider==='ipquery'){
         if(typeof j?.location?.country!=='string')throw Error('Formato de geolocalização inválido');
         return {dados:{pais:j.location.country,cidade:j?.location?.city??null,estado:j?.location?.state??null,
          asn:j?.isp?.asn??null,org:j?.isp?.org??null,isp:j?.isp?.isp??null,
          lat:j?.location?.latitude??null,lon:j?.location?.longitude??null,
          provedor:provider,criterio:'Localização de rede provável; não indica localização de uma pessoa.',tentativas}};
        }
        if(j?.error||typeof j?.country!=='string')throw Error('Formato de geolocalização inválido');
        return {dados:{pais:j.country,cidade:j?.city??null,
          asn:j?.asn??j?.organization_asn??null,org:j?.org??j?.organization_name??j?.organization??null,isp:null,
          provedor:provider,criterio:'Localização de rede provável; não indica localização de uma pessoa.',tentativas}};
      }catch(e){tentativas.push({provedor:provider,erro:String(e?.message||e).slice(0,220)});}
    }
    throw Error(tentativas.map(x=>x.provedor+': '+x.erro).join(' | '));
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
 {id:'cnpj_br',tipos:['cnpj'],custo:1,ttl:86400,provenance:'minha-receita-receitaws-v2',
  async run(a,c){
    // A ReceitaWS devolve email e telefone corporativos que a minhareceita e a
    // BrasilAPI deixam como null. Isso abre o encadeamento CNPJ -> e-mail -> vazamento.
    const tentativas=[];
    for(const provider of ['minhareceita','receitaws']){
      try{
        const url=provider==='minhareceita'?`https://minhareceita.org/${encodeURIComponent(a.valor)}`:`https://www.receitaws.com.br/v1/cnpj/${encodeURIComponent(a.valor)}`;
        const r=await c.get(url,{timeout:8000});
        if(r.status===404){if(provider==='minhareceita')continue;return {dados:{existe:false,tentativas}};}
        if(!r.ok)throw falhar(r);
        const j=await J(r);
        if(!j||typeof j!=='object'||Array.isArray(j))throw Error('formato inesperado de CNPJ');
        if(provider==='minhareceita'&&String(j.cnpj)!==a.valor)throw Error('formato inesperado de CNPJ');
        const socios=lista(j?.qsa).map(s=>({nome:s.nome_socio,qual:s.qualificacao_socio}));
        const email=provider==='receitaws'?(j.email??null):(j.email??null);
        const telefone=provider==='receitaws'?(j.telefone??null):(j.telefone??null);
        return {dados:{existe:true,razao:j.razao_social??j.nome_fantasia??null,fantasia:j.nome_fantasia??null,
          situacao:j.descricao_situacao_cadastral??j.situacao??null,cnae:j.cnae_fiscal_descricao??null,capital:j.capital_social??null,
          uf:j.uf,municipio:j.municipio,socios,email,telefone,
          endereco:[j.logradouro,j.numero,j.bairro,j.cep].filter(Boolean).join(', ')},
          pivos:[...socios.map(s=>({tipo:'nome',valor:s.nome})),...(email?[{tipo:'email',valor:String(email).split('@')[1]}]:[])],
          tentativas};
      }catch(e){tentativas.push({provedor:provider,erro:String(e?.message||e).slice(0,220)});}
    }
    throw Error(tentativas.map(x=>x.provedor+': '+x.erro).join(' | '));
  }},
 {id:'ddd',tipos:['telefone'],custo:0,ttl:0,provenance:'anatel-pgcn-snapshot-2026-10-30',
  async run(a,c){
    const ddd=a.valor.length>11&&a.valor.startsWith('55')?a.valor.slice(2,4):a.valor.slice(0,2);
    const registro=DDD[ddd];
    if(!registro)throw Error('DDD não encontrado na tabela local da Anatel');
    return {dados:{ddd,...registro}};
  }},
 {id:'wikidata',tipos:['nome'],custo:1,ttl:604800,provenance:'wikidata-search-v2',
  async run(a,c){
    const r=await c.get(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(a.valor)}&language=pt&uselang=pt&format=json&limit=5`,{timeout:9000,headers:{'user-agent':c.env.UA_CONTATO||'ostnt.online/1.0 (+https://ostnt.online)'}});
    if(!r.ok)throw falhar(r);const j=await J(r);if(!Array.isArray(j?.search))throw Error('Formato Wikidata inesperado');
    return {dados:{total:j.search.length,entidades:j.search.map(x=>({id:x?.id??null,nome:x?.label??null,desc:x?.description??null})),criterio:'Correspondências de nome; não confirmam identidade.'}};
  }},
 {id:'datajud',tipos:['nome'],custo:2,ttl:86400,provenance:'cnj-datajud-timeout-v2',requerChave:'DATAJUD_API_KEY',
  async run(a,c){
    const key=c.env.DATAJUD_API_KEY;
    if(!key)throw Error('Chave DataJud ausente');
    const limpo=a.valor.replace(/[:"“”()\[\]{}^~*?\\!]/g,' ').replace(/\s+/g,' ').trim();
    const url='https://api-publica.datajud.cnj.jus.br/api_publica_stj/_search';
    const headers={authorization:key,'content-type':'application/json'};
    // O timeout do Elasticsearch precisa ficar abaixo do timeout HTTP: sem ele a busca
    // por "partes.nome" roda 10-17s e a chamada morre por timeout do cliente.
    const corpo=q=>JSON.stringify({size:10,timeout:'6s',query:q});
    let r=await c.get(url,{method:'POST',timeout:9000,headers,
      body:corpo({query_string:{query:limpo,default_field:'partes.nome'}})});
    if(r.status===400)r=await c.get(url,{method:'POST',timeout:9000,headers,
      body:corpo({match:{'partes.nome':{query:limpo,operator:'and'}}})});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    const hits=lista(j?.hits?.hits);
    // O indice publico do CNJ nao expoe nome de parte: o documento tem
    // id/tribunal/numeroProcesso/classe/orgaoJulgador/movimentos/assuntos e nada
    // de "partes". Por isso "partes.nome" devolve zero sempre, mesmo com chave
    // valida (match_all devolve 10000 hits no mesmo indice). A fonte so entrega
    // resultado util se o indice ganhar o campo de partes ou se a consulta passar
    // a usar um campo de nome que exista.
    const total=j?.hits?.total?.value||0;
    if(total===0&&hits.length===0){
      return {dados:{total:0,processos:[],observacao:'O indice publico do CNJ nao expoe nome de parte; a busca por nome nao pode confirmar processos. Use a fonte "identidade" ou "vazamento" para o mesmo alvo.'}};
    }
    return {dados:{total,processos:hits.map(h=>({numero:h?._source?.numeroProcesso??null,classe:h?._source?.classe?.nome??null}))}};
  }},
 {id:'djen',tipos:['nome'],custo:1,ttl:43200,provenance:'dou-djen-busca-nome-v1',
  async run(a,c){
    // Substituto do DataJud para busca judicial por nome.
    //
    // Por que o DataJud nao serve: o indice publico do CNJ nao expoe nome de parte.
    // O documento tem id/tribunal/numeroProcesso/classe/orgaoJulgador/movimentos/
    // assuntos e nada de "partes" (Portaria CNJ 160/2020, sigilo). Uma query
    // nested sobre "partes" devolve HTTP 400 "failed to find nested object under
    // path [partes]", e match/query_string sobre partes.nome devolve 0 hits
    // mesmo com chave valida. Nao ha chave que resolva isso.
    //
    // A busca do DJEN (Diario Eletratico Nacional, secao 3 do DOU) devolve os
    // editais de citacao e notificacao com o nome da parte citado no proprio
    // texto, sem chave e sem sessão. O resultado vem embutido em JSON no HTML.
    const nome=a.valor.trim();
    if(nome.length<4)throw Error('Nome curto demais para busca no DJEN');
    const url=`https://www.in.gov.br/consulta/-/buscar/dou?q=${encodeURIComponent('"'+nome+'"')}&s=do3&exactDate=all&sortType=0`;
    const r=await c.get(url,{accept:'text/html,application/xhtml+xml',timeout:12000,headers:{'user-agent':'Cloudflare-Worker'}});
    if(!r.ok) throw falhar(r);
    const html=await r.text();
    const m=html.match(/<script[^>]*id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params"[^>]*>([\s\S]*?)<\/script>/);
    if(!m) throw Error('Estrutura da busca do DJEN mudou');
    let j;try{j=JSON.parse(m[1]);}catch{throw Error('JSON da busca do DJEN inválido');}
    const itens=lista(j?.jsonArray);
    const texto=x=>String(x??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    const itensDjen=lista(itens);
    const dados=itensDjen.map(it=>({
      tipo:it?.artType??null,
      titulo:it?.title??null,
      publicacao:it?.pubDate??null,
      secao:it?.pubName??null,
      pagina:it?.numberPage??null,
      url:`https://www.in.gov.br/web/dou/-/${encodeURIComponent(String(it?.urlTitle??''))}`,
      trecho:texto(it?.content).slice(0,320),
    }));
    const citacoes=dados.filter(x=>/cita|notifica/i.test(String(x.tipo||''))).length;
    return {dados:{total:dados.length,citacoes:citacoes,itens:dados.slice(0,15),
      criterio:'Editais publicados no DJEN que citam o nome. Presenca indica publicacao processual, nao confere nem numeracao do processo nem identidade.'}};
  }},
 {id:'vazamento',tipos:['email','telefone'],custo:1,ttl:86400,provenance:'leakcheck-public-v1',
  async run(a,c){
    // LeakCheck publico: aceita e-mail ou telefone e devolve as fontes de vazamento
    // e os TIPOS de dado expostos (senha, data de nascimento, endereço, IP).
    // Nao devolve o conteudo dos campos, apenas os nomes, e nao prova titularidade.
    const r=await c.get(`https://leakcheck.io/api/public?check=${encodeURIComponent(a.valor)}`,{timeout:8000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    if(j?.success===false) return {dados:{encontrado:false,total:0,fontes:[],camposExpostos:[],
      criterio:'Nenhum registro publico encontrado para este identificador.'}};
    if(typeof j?.found!=='number')throw Error('Formato LeakCheck inesperado');
    const fontes=lista(j?.sources).map(s=>({nome:s?.name??null,data:s?.date||null}));
    const campos=lista(j?.fields).map(f=>String(f).toLowerCase());
    return {dados:{encontrado:true,total:j.found,fontes:fontes.slice(0,20),camposExpostos:campos,
      temSenha:campos.includes('password'),
      criterio:'Tipos de dado que aparecem em registros públicos de vazamento. Não confirma identidade nem titularidade e não expõe o conteúdo dos campos.'}};
  }},
 {id:'identidade',tipos:['nome'],custo:2,ttl:604800,provenance:'openalex-orcid-v1',
  async run(a,c){
    // Nome -> identidade academica e registro dePesquisa. Preenche um espaco
    // vazio: as 24 fontes anteriores so associations nomes a entidades wikidata.
    const erros=[];
    const partes=a.valor.trim().split(/\s+/);
    const primeiro=partes[0],ultimo=partes[partes.length-1];
    let openalex=null;
    try{
      // O OpenAlex comeca a recusar User-Agent de navegador com HTTP 429
      // ("Insufficient budget") e aceita o UA identificavel do projeto.
      const r=await c.get(`https://api.openalex.org/authors?search=${encodeURIComponent(a.valor)}&per-page=3`,{timeout:8000,
        headers:{'user-agent':c.env.UA_CONTATO||'ostnt.online/1.0 (+https://ostnt.online)'}});
      if(!r.ok)throw falhar(r);const j=await J(r);
      const res=lista(j?.results).map(x=>({id:x?.id??null,nome:x?.display_name??null,
        obras:x?.works_count??null,citacoes:x?.cited_by_count??null,
        orcid:(lista(x?.ids).find(i=>String(i).includes('orcid'))??null),
        instituicao:(lista(x?.last_known_institutions).map(i=>i?.display_name).filter(Boolean)[0]??null)}));
      openalex=res;
    }catch(e){erros.push({provedor:'openalex',erro:String(e?.message||e).slice(0,220)});}
    let orcid=null;
    try{
      const q=`given-names:${primeiro} AND family-name:${ultimo}`;
      const r=await c.get(`https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(q)}`,{timeout:8000,headers:{accept:'application/json'}});
      if(!r.ok)throw falhar(r);const j=await J(r);
      orcid=lista(j?.['expanded-result']).map(x=>({id:x?.['orcid-id']??null,nome:x?.['credit-name']??null,
        instituicoes:lista(x?.['institution-name'])}));
    }catch(e){erros.push({provedor:'orcid',erro:String(e?.message||e).slice(0,220)});}
    if(!openalex&&!orcid)throw Error(erros.map(x=>x.provedor+': '+x.erro).join(' | '));
    return {dados:{academico:openalex,orcid,parcial:erros.length>0,erros,
      criterio:'Correspondência de nome com registro público de pesquisa. Nomes homônimos são frequentes e não confirmam identidade.'}};
  }},
 {id:'certificados',tipos:['dominio'],custo:1,ttl:86400,provenance:'certspotter-ct-v1',
  async run(a,c){
    // Certspotter (SSLMate) como fonte server-side de Certificate Transparency.
    // O crt.sh oscila entre 502 e timeout de 45s e hoje so roda no navegador.
    const r=await c.get(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(a.valor)}&include_subdomains=true&expand=dns_names`,{timeout:9000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    if(!Array.isArray(j))throw Error('Formato Certspotter inesperado');
    const hosts=[...new Set(j.flatMap(x=>lista(x?.dns_names)).map(s=>String(s).toLowerCase().replace(/^\*\./,'')))].filter(Boolean);
    const validos=hosts.filter(h=>h===a.valor||h.endsWith('.'+a.valor));
    return {dados:{total:validos.length,subdominios:validos.slice(0,60),
      emissores:[...new Set(j.map(x=>x?.issuer_name).filter(Boolean))].slice(0,5),
      criterio:'Nomes publicados em Certificate Transparency. Indica hosts emitidos; não prova controle atual do domínio.'}};
  }},
 {id:'rota',tipos:['ip'],custo:1,ttl:21600,provenance:'ripestat-routing-v1',
  async run(a,c){
    // RIPEstat: rota anunciada, RPKI e contato de abuso. Sem chave, mas a resposta
    // pode demorar alguns segundos, entao o timeout e maior que o das outras fontes.
    const erros=[];
    let rota=null,rpki=null,abuse=null;
    try{
      const r=await c.get(`https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(a.valor)}`,{timeout:9000});
      if(!r.ok)throw falhar(r);const j=await J(r);
      const d=j?.data;if(!d)throw Error('Formato RIPEstat inesperado');
      const asn=d?.asns?.[0];
      // O endpoint chama o prefixo de "resource" e traz "announced" com o AS
      // que o anuncia; "prefix" nao existe neste payload.
      rota={prefixo:d?.resource??null,anunciado:d?.announced??null,
        asn:typeof asn==='object'?(asn?.asn??null):(asn??null),
        asnNome:typeof asn==='object'?(asn?.holder??null):null,
        pais:typeof asn==='object'?(asn?.country??null):null,
        tipo:d?.type??null,menosEspecifico:Boolean(d?.is_less_specific)};
    }catch(e){erros.push({provedor:'prefix-overview',erro:String(e?.message||e).slice(0,220)});}
    try{
      // RPKI vive no endpoint separado "routing-status".
      const r=await c.get(`https://stat.ripe.net/data/routing-status/data.json?resource=${encodeURIComponent(a.valor)}`,{timeout:9000});
      if(r.ok){const j=await J(r);rpki=j?.data?.routes?.[0]?.rpki_validation?.statuses?.[0]?.status??null;}
    }catch(e){erros.push({provedor:'routing-status',erro:String(e?.message||e).slice(0,220)});}
    try{
      const r=await c.get(`https://stat.ripe.net/data/abuse-contact-finder/data.json?resource=${encodeURIComponent(a.valor)}`,{timeout:9000});
      if(r.ok){const j=await J(r);abuse=lista(j?.data?.abuse_contacts);}
    }catch(e){erros.push({provedor:'abuse-contact-finder',erro:String(e?.message||e).slice(0,220)});}
    if(!rota)throw Error(erros.map(x=>x.provedor+': '+x.erro).join(' | '));
    return {dados:{...rota,rpki,abuse,parcial:erros.length>0,erros,
      criterio:'Rota anunciada e validação RPKI do prefixo. Descreve a infraestrutura, não o usuário.'}};
  }}
];
