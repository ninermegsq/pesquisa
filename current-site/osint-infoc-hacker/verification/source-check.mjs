import {pivosDe} from '../src/scan.mjs';
import assert from 'node:assert/strict';
import {REGISTRY} from '../src/sources/registry.mjs';
import {ctx,ehAbort} from '../src/lib/http.mjs';
import {detectar} from '../src/lib/alvo.mjs';
const source=id=>REGISTRY.find(s=>s.id===id);
const context=(get,env={})=>({env,origem:'https://fixture.invalid',get});
for(const id of ['pgp','gravatar'])assert.deepEqual(await source(id).run({valor:'fixture@example.invalid'},context(async()=>new Response('',{status:404}))),{dados:{existe:false}});
assert.equal((await source('xon').run({valor:'fixture@example.invalid'},context(async()=>new Response('',{status:404})))).dados.total,0);
assert.deepEqual((await source('internetdb').run({valor:'203.0.113.10'},context(async()=>new Response('',{status:404})))).dados.portas,[]);
await assert.rejects(()=>source('ipgeo').run({valor:'203.0.113.10'},context(async()=>Response.json({success:false}))),/geolocalização inválido/);
let requests=0;
// A chave do CNJ passou a vir de env (secret), entao o fixture precisa fornecê-la.
await assert.rejects(()=>source('datajud').run({valor:'Nome de Teste'},context(async(url,options)=>{const q=JSON.parse(options.body).query;requests++;if(requests===1)assert.equal(q.query_string.default_field,'partes.nome');else assert.equal(q.match['partes.nome'].operator,'and');const r=new Response('mapping fixture',{status:400});r.corpo='mapping fixture';return r;},{DATAJUD_API_KEY:'fixture'})),/HTTP 400.*mapping fixture/);assert.equal(requests,2);
await assert.rejects(()=>source('datajud').run({valor:'Nome de Teste'},context(async()=>new Response('{}',{status:200}),{})),/Chave DataJud ausente/);
for(const status of [401,403,429])await assert.rejects(()=>source('github').run({valor:'fixture@example.invalid'},context(async()=>new Response('fixture',{status,headers:status===403?{'x-ratelimit-remaining':'0'}:{}}),{GITHUB_TOKEN:'fixture'})),status===401?/Token do GitHub inválido/:/Limite do GitHub/);
await assert.rejects(()=>source('npm').run({valor:'fixture@example.invalid'},context(async()=>new Response('<html>fixture</html>'))),/resposta não-JSON/);
let ua;globalThis.fetch=async(url,options)=>{ua=options.headers.get('user-agent');return new Response('error code: 1010\n'+'x'.repeat(240),{status:403});};
const c=ctx({UA:'scanner-fixture'},'https://fixture.invalid');const res=await c.get('https://fixture.invalid');assert.equal(ua,'scanner-fixture');assert.equal(res.corpo.length,200);assert.ok((await res.text()).length>200);
await ctx({UA_MODE:'navegador',UA_NAVEGADOR:'browser-fixture'},'https://fixture.invalid').get('https://fixture.invalid');assert.equal(ua,'browser-fixture');
for(const v of ['999.999.999.999','2001:::1','-invalid.example','x'.repeat(255),{},'8.8.8.999'])assert.throws(()=>detectar(v));
assert.equal(detectar('55987654321').valor,'5555987654321');assert.equal(detectar('(11) 98765-4321').valor,'5511987654321');
assert.equal(ehAbort(new DOMException('deadline','TimeoutError')),true);
console.log(JSON.stringify({scope:'local source fixtures, no external requests',valid404:true,datajudFallbackRequests:requests,githubAuthErrors:true,nonJSON200Rejected:true,errorBody:200,responsePreserved:true,uaModes:true,invalidIPRejected:true,nationalDDD55:true}));

for(const body of [{stealers:[{top_passwords:['fixture-private-password'],operating_system:'fixture-os'}]},{message:{stealers:[{stealer:{top_passwords:['fixture-private-password']}}]}}]){const result=await source('hudsonrock').run({valor:'fixture@example.invalid'},context(async()=>Response.json(body)));assert.equal(result.dados.infectado,true);assert.equal(result.dados.maquinas,1);assert.equal(JSON.stringify(result).includes('fixture-private-password'),false);}
await assert.rejects(()=>source('hudsonrock').run({valor:'fixture@example.invalid'},context(async()=>Response.json({message:'unrecognized schema'}))),/inconclusivo/);
console.log('Infostealer envelopes, password masking and fail-closed schema: passed');

for(const id of ['gravatar','npm','bluesky','xon','github','wayback'])await assert.rejects(()=>source(id).run({tipo:'email',valor:'fixture@example.invalid'},context(async()=>Response.json({}),{GITHUB_TOKEN:'fixture'})),/Formato|formato/);
const dns=await source('dns').run({tipo:'email',valor:'fixture@example.invalid'},context(async url=>url.includes('_dmarc.')?new Response('fixture service failure',{status:503}):Response.json({Status:0,Answer:[]})));
assert.equal(dns.dados.dmarc,null);
console.log('Unknown source schemas rejected; unavailable DMARC remains unknown: passed');

assert.deepEqual(pivosDe([{pivos:[{tipo:'nome'},{tipo:'nome',valor:'undefined'},{tipo:'dominio',valor:'https://evil.invalid'},{tipo:'ip',valor:'2001:db8::1'},{tipo:'ip',valor:'2001:db8::1'}]}]),[{tipo:'ip',valor:'2001:db8::1'}]);
console.log('Invalid pivots discarded, IPv6 preserved and duplicates removed: passed');

// Regressão observada no scan real: busca ampla não comprova vínculo com o e-mail.
const alvoEmail={tipo:'email',valor:'fixture@example.invalid'};
const npmResult=await source('npm').run(alvoEmail,context(async()=>Response.json({total:11202,objects:[{package:{name:'unrelated',publisher:{email:'other@example.invalid'}}},{package:{name:'exact',maintainers:[{email:'Fixture@Example.Invalid'}]}}]})));
assert.equal(npmResult.dados.total,1);assert.equal(npmResult.dados.pacotes[0].nome,'exact');assert.equal(npmResult.dados.total_busca_ampla,11202);
const bskyResult=await source('bluesky').run(alvoEmail,context(async()=>Response.json({actors:[{handle:'unrelated',displayName:'other@example.invalid'},{handle:'exact',displayName:'Contato: fixture@example.invalid'},{handle:'prefix',displayName:'notfixture@example.invalid'}]})));
assert.equal(bskyResult.dados.total,1);assert.equal(bskyResult.dados.atores[0].handle,'exact');
console.log('Broad npm/Bluesky search results require exact public email evidence: passed');

const {turnstileConfig,turnstileVerificado}=await import('../src/lib/turnstile-config.mjs');
const testConfig=turnstileConfig({APP_ENV:'validation',ALLOWED_ORIGINS:'https://validation.ostnt.online',TURNSTILE_SITEKEY:'1x00000000000000000000AA',TURNSTILE_SECRET:'1x0000000000000000000000000000000AA'},'https://validation.ostnt.online/');
for(const hostname of ['localhost','example.com'])assert.equal(turnstileVerificado({success:true,hostname},testConfig),true);
assert.equal(turnstileVerificado({success:false,hostname:'example.com'},testConfig),false);
assert.equal(turnstileVerificado({success:true,hostname:'example.com'},{teste:false,hostname:'ostnt.online'}),false);
assert.equal(turnstileVerificado({success:true,hostname:'other.invalid'},testConfig),false);
console.log('Observed dummy hostname accepted only for guarded validation keys: passed');

const xonEmpty=await source('xon').run({tipo:'email',valor:'fixture@example.invalid'},context(async()=>Response.json({Error:'Not found',email:null})));
assert.equal(xonEmpty.dados.total,0);assert.equal(xonEmpty.dados.senhas.disponivel,false);
await assert.rejects(()=>source('xon').run({tipo:'email',valor:'fixture@example.invalid'},context(async()=>Response.json({Error:'Rate limit exceeded'}))),/Formato XposedOrNot inesperado/);
console.log('Documented XON no-breach response accepted; other error envelopes rejected: passed');

// --- Fontes substitutas e novas ---
// DJEN: o JSON vem embutido no HTML da busca; o parser tem de extrai-lo e contar
// apenas as citacoes, sem prometer numero de processo que a pagina nao traz.
const djenHtml='<script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params" type="application/json">{"jsonArray":[{"pubName":"DO3","urlTitle":"edital-de-citacao-1","numberPage":"10","title":"EDITAL DE CITAÇÃO","pubDate":"29/10/2026","artType":"Edital de Citação","content":"cientifica <span>FULANO</span> de souza"},{"pubName":"DO3","urlTitle":"aviso-2","title":"AVISO","pubDate":"01/10/2026","artType":"Aviso","content":"licitacao"}]}</script>';
const djen=await source('djen').run({tipo:'nome',valor:'fulano de souza'},context(async()=>new Response(djenHtml,{status:200})));
assert.equal(djen.dados.total,2);assert.equal(djen.dados.citacoes,1);
assert.equal(djen.dados.itens[0].tipo,'Edital de Citação');assert.ok(djen.dados.itens[0].url.includes('edital-de-citacao-1'));
assert.ok(!djen.dados.itens[0].trecho.includes('<span>'),'HTML do trecho deve ser removido');
await assert.rejects(()=>source('djen').run({tipo:'nome',valor:'ab'},context(async()=>new Response('{}',{status:200}))),/curto demais/);
await assert.rejects(()=>source('djen').run({tipo:'nome',valor:'fulano de souza'},context(async()=>new Response('<html>sem json</html>',{status:200}))),/Estrutura da busca do DJEN mudou/);
console.log('DJEN name search: JSON extracted, citations counted, HTML stripped: passed');

// Vazamento: o LeakCheck devolve os NOMES dos campos expostos, nunca o conteudo.
const vaz=await source('vazamento').run({tipo:'email',valor:'fixture@example.invalid'},context(async()=>Response.json({success:true,found:12,fields:['id','password','dob','address'],sources:[{name:'Fixture',date:'2026-01'}]})));
assert.equal(vaz.dados.encontrado,true);assert.equal(vaz.dados.total,12);assert.equal(vaz.dados.temSenha,true);
assert.deepEqual(vaz.dados.fontes,[{nome:'Fixture',data:'2026-01'}]);
assert.ok(!JSON.stringify(vaz.dados).includes('fixture@example.invalid'),'nao deve ecoar o valor consultado');
const vaz404=await source('vazamento').run({tipo:'email',valor:'fixture@example.invalid'},context(async()=>Response.json({success:false,error:'Not found'})));
assert.equal(vaz404.dados.encontrado,false);assert.equal(vaz404.dados.total,0);
console.log('LeakCheck: found/not-found envelopes accepted, field names only: passed');

// Identidade: OpenAlex e ORCID sao independentes; um falhando nao derruba a fonte.
const ident=await source('identidade').run({tipo:'nome',valor:'fulano de souza'},context(async url=>url.includes('openalex')
 ?Response.json({results:[{id:'https://openalex.org/A1',display_name:'Fulano',works_count:10,cited_by_count:2,ids:{orcid:'https://orcid.org/0000-1'},last_known_institutions:[{display_name:'USP'}]}]})
 :Response.json({'expanded-result':[{'orcid-id':'0000-0002-5630-5589','credit-name':'Fulano de Souza','institution-name':['USP']}]})));
assert.equal(ident.dados.academico.length,1);assert.equal(ident.dados.academico[0].obras,10);assert.equal(ident.dados.academico[0].instituicao,'USP');
assert.equal(ident.dados.orcid.length,1);assert.equal(ident.dados.orcid[0].id,'0000-0002-5630-5589');
console.log('OpenAlex + ORCID identity mapping: passed');

// Certificados: Certspotter devolve dns_names; o filtro precisa manter o escopo do dominio.
const cert=await source('certificados').run({tipo:'dominio',valor:'example.com'},context(async()=>Response.json([{dns_names:['*.example.com','a.example.com','b.outro.com'],issuer_name:'R3'},{dns_names:['example.com']}])));
assert.equal(cert.dados.total,2);assert.ok(cert.dados.subdominios.includes('a.example.com'));
assert.ok(!cert.dados.subdominios.includes('b.outro.com'),'host de outro dominio deve ser descartado');
console.log('Certspotter CT: wildcard expanded and scope enforced: passed');

// Rota: RIPEstat devolve asn como objeto; a fonte tem de extrair o numero.
const rota=await source('rota').run({tipo:'ip',valor:'8.8.8.8'},context(async url=>url.includes('abuse')
 ?Response.json({data:{abuse_contacts:['abuse@example.invalid']}})
 :Response.json({data:{prefix:'8.8.8.0/24',asns:[{asn:15169,holder:'GOOGLE'}],description:'Google',country:'US',rir:'ARIN',rpki_validation:{statuses:[{status:'valid'}]}}})));
assert.equal(rota.dados.prefixo,'8.8.8.0/24');assert.equal(rota.dados.asn,15169);assert.equal(rota.dados.rpki,'valid');
assert.deepEqual(rota.dados.abuse,['abuse@example.invalid']);
console.log('RIPEstat routing + RPKI + abuse contact: passed');
