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

// Credencial opcional que MELHORA o resultado sem ser necessaria. A fonte
// continua funcionando pelo caminho publico quando ela falta: aqui a
// ausencia da credencial nao e falha de configuracao (sem_chave/sem_token).
function credencialOpcional(env,id){
  const requer=metaDe(id)?.requer;
  if(!requer)return null;
  const valor=env?env[requer.env]:null;
  return valor?String(valor):null;
}

// Texto de um campo do cadastro: vazio e null (o relatorio omite o campo).
const texto=v=>v==null?null:(String(v).trim()||null);
// "Sim"/"Nao"/true/false -> true/false/null. O CNPJ.ws devolve "Sim"/"Nao"
// como texto; o Minha Receita devolve texto tambem.
const simNao=v=>{
  if(v===true||v===false)return v;
  const t=String(v??'').trim().toLowerCase();
  if(t==='sim'||t==='yes'||t==='true')return true;
  if(t==='nao'||t==='não'||t==='no'||t==='false')return false;
  return null;
};
// A lista de socios entra inteira no calculo e volta limitada no relatorio:
// o Banco do Brasil tem 88 socios e o HTML nao precisa de 88 blocos.
const LIMITE_SOCIOS=20;
const joinLogradouro=(...partes)=>{
  const textoFinal=partes.filter(p=>p!=null&&String(p).trim()).map(p=>String(p).trim()).join(' ');
  return textoFinal||null;
};
// Cadastro do CNPJ.ws (cnpj-ws-publica). O estabelecimento traz e-mail,
// telefone, CNAE, situacao e datas; a raiz traz porte e natureza juridica.
function normalizarCnpjWs(j){
  const e=j.estabelecimento||{};
  const atividade=e.atividade_principal||{};
  const simples=j.simples||null;
  const socios=lista(j.socios).map(s=>({nome:texto(s?.nome),qual:texto(s?.qualificacao_socio?.descricao)}))
    .filter(s=>s.nome);
  return {
    existe:true,
    razao:texto(j.razao_social),
    fantasia:texto(e.nome_fantasia),
    situacao:texto(e.situacao_cadastral),
    cnae:texto(atividade.descricao),
    cnae_codigo:texto(atividade.classe),
    capital:texto(j.capital_social),
    porte:texto(j.porte?.descricao),
    natureza_juridica:texto(j.natureza_juridica?.descricao),
    uf:texto(e.estado?.sigla),
    municipio:texto(e.cidade?.nome),
    endereco:joinLogradouro(e.tipo_logradouro,e.logradouro,e.numero,e.bairro),
    cep:texto(e.cep),
    email:texto(e.email),
    telefone:e.ddd1&&e.telefone1?texto(`${e.ddd1}${e.telefone1}`):null,
    simples:simNao(simples?.simples),
    mei:simNao(simples?.mei),
    inicio_atividade:texto(e.data_inicio_atividade),
    atualizado_em:texto(e.atualizado_em),
    total_socios:socios.length,
    socios:socios.slice(0,LIMITE_SOCIOS),
    provedor:'cnpj-ws'
  };
}
// Mesmo formato, a partir do Minha Receita (provedor de reserva).
function normalizarReceita(j){
  const socios=lista(j.qsa).map(s=>({nome:texto(s?.nome_socio),qual:texto(s?.qualificacao_socio)}))
    .filter(s=>s.nome);
  return {
    existe:true,
    razao:texto(j.razao_social),
    fantasia:texto(j.nome_fantasia),
    situacao:texto(j.descricao_situacao_cadastral),
    cnae:texto(j.cnae_fiscal_descricao),
    cnae_codigo:texto(j.cnae_fiscal),
    capital:texto(j.capital_social),
    porte:texto(j.porte),
    natureza_juridica:texto(j.natureza_juridica),
    uf:texto(j.uf),
    municipio:texto(j.municipio),
    endereco:joinLogradouro(j.descricao_tipo_de_logradouro,j.logradouro,j.numero,j.bairro),
    cep:texto(j.cep),
    email:texto(j.email),
    telefone:j.ddd_telefone_1&&j.telefone_1?texto(`${j.ddd_telefone_1}${j.telefone_1}`):null,
    simples:simNao(j.opcao_pelo_simples),
    mei:simNao(j.opcao_pelo_mei),
    inicio_atividade:texto(j.data_inicio_atividade),
    atualizado_em:texto(j.atualizado_em),
    total_socios:socios.length,
    socios:socios.slice(0,LIMITE_SOCIOS),
    provedor:'minha-receita'
  };
}
// Pivos do cadastro: o e-mail e o telefone do estabelecimento (publicados no
// registro) vem primeiro, porque alimentam as checagens de e-mail; depois
// ficam os nomes dos socios.
function pivosDeCnpj(dados){
  const pivos=[];
  const email=String(dados?.email||'').trim();
  if(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email))pivos.push({tipo:'email',valor:email});
  const telefone=String(dados?.telefone||'').replace(/\D/g,'');
  if(telefone.length>=10&&telefone.length<=13)pivos.push({tipo:'telefone',valor:telefone});
  for(const s of dados?.socios||[])if(s?.nome)pivos.push({tipo:'nome',valor:s.nome});
  return pivos;
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
 // O GitLab nao permite busca publica de usuarios por e-mail: a rota
 // GET /api/v4/users?search= responde 403 sem autenticacao, e o GraphQL de
 // `users` exige permissao ("resource ... does not exist or you don't have
 // permission"), verificado ao vivo. O que responde sem credencial e a busca
 // de projetos, pelo GraphQL publico, e ela alcanca o e-mail publicado na
 // descricao e no README do projeto. A fonte passou a procurar o e-mail em
 // projetos publicos; o id e a proveniencia mudaram junto com o manifesto.
 {id:'gitlab',tipos:['email'],custo:1,ttl:21600,provenance:'gitlab-graphql-search',
  async run(a,c){
    const consulta=`{ projects(search: ${JSON.stringify(String(a.valor??''))}, first: 10) { nodes { name nameWithNamespace description webUrl } } }`;
    const r=await c.get('https://gitlab.com/api/graphql',{method:'POST',timeout:8000,
      headers:{'content-type':'application/json'},body:JSON.stringify({query:consulta})});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    const erros=lista(j?.errors);
    if(erros.length) throw Error(`GitLab recusou a consulta: ${String(erros[0]?.message||'erro').slice(0,140)}`);
    const nos=lista(j?.data?.projects?.nodes);
    return {dados:{total:nos.length,
      projetos:nos.map(p=>({nome:p?.name||null,caminho:p?.nameWithNamespace||null,descricao:p?.description||null,url:p?.webUrl||null})),
      observacao:'O GitLab nao expoe busca publica de usuarios por e-mail: a fonte lista os projetos publicos em que o e-mail aparece (descricao ou README).'}};
  }},
 // A busca do npm e textual: para um e-mail que nao existe no indice ela
 // devolve dezenas de milhares de pacotes irrelevantes (o total cru do
 // provedor). O que interessa e quem publica com este e-mail, e cada
 // resultado traz `package.maintainers` com o e-mail do mantenedor. A fonte
 // conta e lista so os pacotes cujo mantenedor usa exatamente este e-mail.
 {id:'npm',tipos:['email'],custo:1,ttl:21600,provenance:'npm-registry',
  async run(a,c){
    const r=await c.get(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(a.valor)}&size=50`,{timeout:8000});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    const alvo=String(a.valor??'').trim().toLowerCase();
    const meus=lista(j?.objects).filter(o=>lista(o?.package?.maintainers).some(m=>String(m?.email||'').trim().toLowerCase()===alvo));
    return {dados:{total:meus.length,
      pacotes:meus.slice(0,5).map(o=>({nome:o?.package?.name||null,autor:o?.package?.author?.name||null,descricao:o?.package?.description||null})),
      observacao:'A busca do npm e textual e depende do indice do provedor; a fonte lista apenas os pacotes cujo mantenedor publica com este e-mail.'}};
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
    // O Subdomain Center responde, mas devolve em 0,3 s a 19 s (medido ao
    // vivo) e as vezes devolve 503 "server busy (64 queries in flight)".
    // O timeout de 9 s cortava a consulta valida; 20 s cobre a latencia
    // observada. O 503 continua sendo falha real do provedor.
    const r=await c.get(`https://api.subdomain.center/?domain=${encodeURIComponent(d)}`,{timeout:20000});
    if(!r.ok) throw falhar(r);
    const arr=await J(r);
    if(!Array.isArray(arr))throw Error('formato inesperado');
    const subs=[...new Set(arr.filter(x=>typeof x==='string').map(x=>x.trim().toLowerCase().replace(/\.$/,''))
      .filter(x=>x.endsWith('.'+d)&&x.length<=253&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(x)&&!x.includes('..')))].slice(0,60);
    return {dados:{total:subs.length,subdominios:subs},pivos:subs.slice(0,8).map(v=>({tipo:'dominio',valor:v}))};
  }},
 // A listagem de URLs do Internet Archive (CDX) esta degradada com
 // frequencia: responde 503 "Internet Archive: Temporarily Offline" ou a
 // consulta wildcard nao termina (medido ao vivo: 8 s a 19 s, com 503 e
 // timeout). A API de disponibilidade responde em cerca de 0,6 s e cobre o
 // mesmo dominio. Quando a listagem falha, a fonte usa a disponibilidade:
 // perde a lista completa de URLs, mas nao a fonte inteira. O resultado do
 // fallback tem TTL proprio menor, para que a listagem completa seja tentada
 // de novo em breve.
 {id:'wayback',tipos:['email','dominio'],custo:1,ttl:43200,provenance:'wayback-cdx',
  async run(a,c){
    const d=a.tipo==='email'?a.valor.split('@')[1]:a.valor;
    const parametrosDe=urls=>[...new Set(urls.flatMap(u=>{try{return [...new URL(u).searchParams.keys()]}catch{return[]}}))].slice(0,20);
    try{
      const r=await c.get(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(d)}/*&output=json&fl=original,timestamp&collapse=urlkey&limit=200`,{timeout:20000});
      if(!r.ok) throw falhar(r);
      const arr=await J(r);
      if(!Array.isArray(arr)||arr.length<2)return {dados:{total:0,parametros:[],amostra:[],origem:'cdx'}};
      const urls=arr.slice(1).map(x=>x?.[0]).filter(Boolean);
      return {dados:{total:urls.length,parametros:parametrosDe(urls),amostra:urls.slice(0,15),origem:'cdx'}};
    }catch(e){
      const r=await c.get(`https://archive.org/wayback/available?url=${encodeURIComponent(d)}`,{timeout:8000});
      if(!r.ok) throw falhar(r);
      const j=await J(r);
      const url=j?.archived_snapshots?.closest?.url||null;
      return {ttl:900,dados:{total:url?1:0,parametros:url?parametrosDe([url]):[],amostra:url?[url]:[],origem:'disponibilidade',
        observacao:`A listagem de URLs do Internet Archive falhou (${String(e?.message||'erro').slice(0,80)}); a fonte usou a API de disponibilidade, que devolve apenas o snapshot mais proximo.`}};
    }
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
 {id:'cnpj_br',tipos:['cnpj'],custo:2,ttl:86400,provenance:'cnpj-ws-publica+minha-receita-cnpj',
  async run(a,c){
    // Provedor primario: CNPJ.ws. O endpoint publico devolve o
    // estabelecimento completo (e-mail, telefone, CNAE, situacao cadastral) e
    // a lista de socios, e aceita 3 consultas por minuto/IP - em IP
    // compartilhado o 429 e esperado. Quando ele falha (429, 5xx, timeout,
    // formato), a fonte cai para o Minha Receita, que responde o mesmo
    // cadastro. Se o token comercial estiver configurado, a consulta vai
    // para comercial.cnpj.ws, que tem cota propria.
    const token=credencialOpcional(c.env,'cnpj_br');
    const host=token?'comercial.cnpj.ws':'publica.cnpj.ws';
    const cabecalhos=token?{'x_api_token':token}:{};
    const tentarCnpjWs=async()=>{
      const r=await c.get(`https://${host}/cnpj/${encodeURIComponent(a.valor)}`,{timeout:7000,headers:cabecalhos});
      if(r.status===404)return {achou:false};
      if(!r.ok)throw falhar(r);
      const j=await J(r);
      if(!j||typeof j!=='object'||Array.isArray(j)||!j.razao_social)throw Error('formato inesperado de CNPJ');
      const dados=normalizarCnpjWs(j);
      return {achou:true,dados,pivos:pivosDeCnpj(dados)};
    };
    const tentarReceita=async()=>{
      const r=await c.get(`https://minhareceita.org/${encodeURIComponent(a.valor)}`,{timeout:7000});
      if(r.status===404)return {achou:false};
      if(!r.ok)throw falhar(r);
      const j=await J(r);
      if(!j||typeof j!=='object'||Array.isArray(j)||String(j.cnpj)!==a.valor)throw Error('formato inesperado de CNPJ');
      const dados=normalizarReceita(j);
      return {achou:true,dados,pivos:pivosDeCnpj(dados)};
    };
    let erro=null,ausentes=0;
    for(const tentar of [tentarCnpjWs,tentarReceita]){
      try{
        const saida=await tentar();
        if(saida.achou)return {dados:saida.dados,pivos:saida.pivos};
        ausentes++;
      }catch(e){
        // O erro do provedor primario vem primeiro; o do provedor de reserva
        // fica anexado, para a evidencia dos dois.
        erro=erro?Object.assign(erro,{message:`${erro.message} | fallback: ${e.message}`}):e;
      }
    }
    if(ausentes===2)return {dados:{existe:false}};
    throw erro;
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
    exigirCredencial(c.env,'datajud');
    const key=`APIKey ${c.env.DATAJUD_API_KEY}`;
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
  // A fonte tem de usar exatamente o tipo de credencial que o manifesto
  // declara: `exigirCredencial` quando a credencial e obrigatoria (a fonte
  // para com sem_chave/sem_token) e `credencialOpcional` quando ela apenas
  // melhora o resultado (a fonte segue pelo caminho publico).
  const codigoFonte=String(fonte.run);
  const usaExigir=/exigirCredencial\s*\(/.test(codigoFonte);
  const usaOpcional=/credencialOpcional\s*\(/.test(codigoFonte);
  const credencialOpcionalNoManifesto=Boolean(meta.requer?.opcional);
  const credencialCoerente=meta.requer
    ?(credencialOpcionalNoManifesto?(usaOpcional&&!usaExigir):(usaExigir&&!usaOpcional))
    :(!usaExigir&&!usaOpcional);
  if(!credencialCoerente)throw new Error(`credencial divergente do manifesto: ${fonte.id}`);
  Object.assign(fonte,{titulo:meta.titulo,chave:meta.chave,requer:meta.requer});
}
const idsManifesto=Object.keys(REGISTRY_META.fontes);
if(idsManifesto.length!==REGISTRY.length)throw new Error(`contagem de fontes divergente: manifesto ${idsManifesto.length}, implementacao ${REGISTRY.length}`);
for(const id of idsManifesto)if(!REGISTRY.some(f=>f.id===id))throw new Error(`fonte do manifesto sem implementacao: ${id}`);
