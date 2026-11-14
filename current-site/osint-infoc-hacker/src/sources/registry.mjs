import {DDD} from '../data/ddd.mjs';
import {cpfOk,normalizarPlaca} from '../lib/alvo.mjs';
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

// Valor bruto da credencial declarada no manifesto, para a fonte que exige
// credencial montar a requisicao com ela. O nome da variavel vem do
// manifesto, e nao do codigo.
function valorDaCredencial(env,id){
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

// ---------------------------------------------------------------------------
// Cadastro de e-mail em sites publicos.
//
// Tecnica dos repositorios holehe e blackbird: cada site tem um endpoint
// publico que responde se o e-mail ja esta em uso. Os oito endpoints abaixo
// foram verificados ao vivo, nos dois sentidos (e-mail cadastrado e e-mail
// inexistente), com o User-Agent de producao. Nenhum deles cria conta nem
// dispara e-mail de recuperacao: sao consultas de disponibilidade.
//
// Um site bloqueado (403) ou quebrado vira "indisponivel" e os demais
// continuam. Se nenhum dos oito responder, a fonte falha de verdade.
// ---------------------------------------------------------------------------
const CHECAGENS_CADASTRO=[
 {site:'duolingo',roda:async(c,e)=>{
   const r=await c.get(`https://www.duolingo.com/2017-06-30/users?email=${encodeURIComponent(e)}`,{timeout:6000});
   if(!r.ok)throw falhar(r);
   const n=lista((await J(r))?.users).length;
   return n>0?{estado:'cadastrado',detalhe:`${n} conta(s) no Duolingo`}:{estado:'nao_cadastrado',detalhe:'nenhuma conta no Duolingo'};
 }},
 {site:'protonmail',roda:async(c,e)=>{
   // Resposta em texto puro: "info:1:1 pub:... uid:..." quando o e-mail tem
   // chave publica e "info:1:0" quando nao tem.
   const r=await c.get(`https://api.protonmail.ch/pks/lookup?op=index&search=${encodeURIComponent(e)}`,{accept:'text/plain',timeout:6000});
   if(!r.ok)throw falhar(r);
   const t=await r.text();
   if(/info:1:1/.test(t))return {estado:'cadastrado',detalhe:'chave publica PGP com este e-mail'};
   if(/info:1:0/.test(t))return {estado:'nao_cadastrado',detalhe:'nenhuma chave publica com este e-mail'};
   throw Error('resposta inesperada do ProtonMail');
 }},
 {site:'wordpress',roda:async(c,e)=>{
   // O envelope responde HTTP 200 nos dois sentidos: o sinal esta no corpo,
   // em body.email_verified (conta) e em body.error (sem conta).
   const r=await c.get(`https://public-api.wordpress.com/rest/v1.1/users/${encodeURIComponent(e)}/auth-options?http_envelope=1`,{timeout:6000});
   if(!r.ok)throw falhar(r);
   const j=await J(r);
   if(j?.body?.email_verified===true)return {estado:'cadastrado',detalhe:'conta verificada'};
   if(j?.body?.error)return {estado:'nao_cadastrado',detalhe:`sem conta (${String(j.body.error).slice(0,40)})`};
   throw Error('resposta inesperada do WordPress');
 }},
 {site:'twitter',roda:async(c,e)=>{
   const r=await c.get(`https://api.twitter.com/i/users/email_available.json?email=${encodeURIComponent(e)}`,{timeout:6000});
   if(!r.ok)throw falhar(r);
   const j=await J(r);
   if(j?.taken===true)return {estado:'cadastrado',detalhe:'e-mail em uso'};
   if(j?.taken===false||j?.valid===true)return {estado:'nao_cadastrado',detalhe:'e-mail disponivel'};
   throw Error('resposta inesperada do Twitter');
 }},
 {site:'spotify',roda:async(c,e)=>{
   const r=await c.get(`https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=${encodeURIComponent(e)}`,{timeout:6000});
   if(!r.ok)throw falhar(r);
   const j=await J(r);
   if(j?.status===20)return {estado:'cadastrado',detalhe:String(j?.errors?.email||'e-mail ja registrado').slice(0,80)};
   if(j?.status===1)return {estado:'nao_cadastrado',detalhe:'e-mail disponivel'};
   throw Error('resposta inesperada do Spotify');
 }},
 {site:'adobe',roda:async(c,e)=>{
   const r=await c.get('https://auth.services.adobe.com/signin/v2/users/accounts',{method:'POST',timeout:6000,
     headers:{'content-type':'application/json','x-ims-clientid':'homepage_milo'},
     body:JSON.stringify({username:e,usernameType:'EMAIL'})});
   if(!r.ok)throw falhar(r);
   const n=lista(await J(r)).length;
   return n>0?{estado:'cadastrado',detalhe:`${n} conta(s) Adobe`}:{estado:'nao_cadastrado',detalhe:'nenhuma conta Adobe'};
 }},
 {site:'firefox',roda:async(c,e)=>{
   const r=await c.get('https://api.accounts.firefox.com/v1/account/status',{method:'POST',timeout:6000,
     headers:{'content-type':'application/json'},body:JSON.stringify({email:e})});
   if(!r.ok)throw falhar(r);
   const j=await J(r);
   if(j?.exists===true)return {estado:'cadastrado',detalhe:'conta Mozilla'};
   if(j?.exists===false)return {estado:'nao_cadastrado',detalhe:'nenhuma conta Mozilla'};
   throw Error('resposta inesperada do Firefox');
 }},
 {site:'freelancer',roda:async(c,e)=>{
   // O sinal positivo vem em HTTP 409 (conflito: e-mail em uso), nao em 200.
   const r=await c.get('https://www.freelancer.com/api/users/0.1/users/check?compact=true&new_errors=true',{method:'POST',timeout:6000,
     headers:{'content-type':'application/json'},body:JSON.stringify({user:{email:e}})});
   if(r.status===400){
     // O Freelancer recusa dominios inteiros com HTTP 400 e error_code
     // EMAIL_BLOCKED (medido: teste@example.com -> 400, um e-mail gmail -> 200).
     // Nao e "e-mail cadastrado" nem queda do site: e o site se recusando a
     // verificar aquele dominio. Fica como indisponivel para o alvo, sem
     // derrubar as outras checagens.
     const j=await r.json().catch(()=>null);
     const codigo=String(j?.error_code||j?.error?.code||'');
     if(/EMAIL_BLOCKED/i.test(codigo))return {estado:'indisponivel',detalhe:'dominio bloqueado pelo site (EMAIL_BLOCKED)'};
     throw falhar(r);
   }
   if(r.status===409){
     const j=await r.json().catch(()=>null);
     const codigo=String(j?.error_code||j?.error?.code||'');
     if(!/EMAIL_TAKEN|EMAIL_ALREADY_IN_USE/i.test(codigo))throw falhar(r);
     return {estado:'cadastrado',detalhe:'e-mail ja registrado'};
   }
   if(!r.ok)throw falhar(r);
   const j=await J(r);
   if(j?.status==='success')return {estado:'nao_cadastrado',detalhe:'e-mail disponivel'};
   throw Error('resposta inesperada do Freelancer');
 }}
];

// Codigo de pais (E.164) e nome. O PhoneInfoga usa a biblioteca
// phoneiso3166; aqui a tabela e a versao enxuta, com o Brasil (55) em
// primeiro porque e o escopo do projeto.
const CODIGO_PAIS={'1':'US','7':'RU','20':'EG','27':'ZA','30':'GR','31':'NL','32':'BE','33':'FR','34':'ES','36':'HU','39':'IT','40':'RO','41':'CH','43':'AT','44':'GB','45':'DK','46':'SE','47':'NO','48':'PL','49':'DE','51':'PE','52':'MX','53':'CU','54':'AR','55':'BR','56':'CL','57':'CO','58':'VE','60':'MY','61':'AU','62':'ID','63':'PH','64':'NZ','65':'SG','66':'TH','81':'JP','82':'KR','84':'VN','86':'CN','90':'TR','91':'IN','92':'PK','93':'AF','94':'LK','95':'MM','98':'IR','211':'SS','212':'MA','213':'DZ','216':'TN','218':'LY','220':'GM','221':'SN','233':'GH','234':'NG','235':'TD','249':'SD','251':'ET','254':'KE','255':'TZ','256':'UG','257':'BI','258':'MZ','260':'ZM','263':'ZW','351':'PT','352':'LU','353':'IE','354':'IS','355':'AL','356':'MT','357':'CY','358':'FI','359':'BG','370':'LT','371':'LV','372':'EE','375':'BY','380':'UA','381':'RS','385':'HR','386':'SI','389':'MK','420':'SA','421':'SK','852':'HK','853':'MO','855':'KH','856':'LA','880':'BD','886':'TW','960':'MV','961':'LB','962':'JO','963':'SY','964':'IQ','965':'KW','966':'SA','967':'YE','968':'OM','971':'AE','972':'IL','973':'BH','974':'QA','975':'BT','976':'MN','977':'NP','992':'TJ','993':'TM','994':'AZ','995':'GE','996':'KG','998':'UZ'};
const NOME_PAIS={US:'Estados Unidos',RU:'Russia',EG:'Egito',ZA:'Africa do Sul',GR:'Grecia',NL:'Paises Baixos',BE:'Belgica',FR:'Franca',ES:'Espanha',HU:'Hungria',IT:'Italia',RO:'Romania',CH:'Suica',AT:'Austria',GB:'Reino Unido',DK:'Dinamarca',SE:'Suecia',NO:'Noruega',PL:'Polonia',DE:'Alemanha',PE:'Peru',MX:'Mexico',CU:'Cuba',AR:'Argentina',BR:'Brasil',CL:'Chile',CO:'Colombia',VE:'Venezuela',MY:'Malasia',AU:'Australia',ID:'Indonesia',PH:'Filipinas',NZ:'Nova Zelandia',SG:'Singapura',TH:'Thailandia',JP:'Japao',KR:'Coreia do Sul',VN:'Vietnam',CN:'China',TR:'Turquia',IN:'India',PK:'Paquistao',AF:'Afeganistao',LK:'Sri Lanka',MM:'Myanmar',IR:'Iran',SS:'Sudao do Sul',MA:'Marrocos',DZ:'Algeria',TN:'Tunisia',LY:'Libia',GM:'Gamba',SN:'Senegal',GH:'Gana',NG:'Nigeria',TD:'Chade',SD:'Sudao',ET:'Etiopia',KE:'Quenia',TZ:'Tanzania',UG:'Uganda',BI:'Burundi',MZ:'Mocambique',ZM:'Zambia',ZW:'Zimbabue',PT:'Portugal',LU:'Luxemburgo',IE:'Irlanda',IS:'Islandia',AL:'Albania',MT:'Malta',CY:'Chipre',FI:'Finlandia',BG:'Bulgaria',LT:'Lituania',LV:'Letonia',EE:'Estonia',BY:'Bielorrusia',UA:'Ucrania',RS:'Serbia',HR:'Croacia',SI:'Eslovenia',MK:'Macedonia do Norte',SA:'Arabia Saudita',SK:'Eslovaquia',HK:'Hong Kong',MO:'Macao',KH:'Camboja',LA:'Laos',BD:'Bangladesh',TW:'Taiwan',MV:'Maldivas',LB:'Libano',JO:'Jordania',SY:'Siria',IQ:'Iraque',KW:'Kuwait',YE:'Iemen',OM:'Oma',AE:'Emirados Arabes Unidos',IL:'Israel',BH:'Bahrein',QA:'Catar',BT:'Butao',MN:'Mongolia',NP:'Nepal',TJ:'Tajiquistao',TM:'Turcomenistao',AZ:'Azerbaijao',GE:'Georgia',KG:'Quirguistao',UZ:'Uzbequistao'};
// Pais pelo prefixo do numero internacional: vale o codigo mais longo que
// casa com o inicio do numero.
function paisDoNumero(internacional){
  const d=String(internacional??'').replace(/\D/g,'');
  if(!d)return null;
  for(let n=3;n>=1;n--){
    const codigo=d.slice(0,n);
    const iso=CODIGO_PAIS[codigo];
    if(iso)return {codigo,iso,nome:NOME_PAIS[iso]||iso};
  }
  return null;
}
// Numero nacional brasileiro, com DDD.
function formatarBr(local){
  const d=String(local??'').replace(/\D/g,'');
  if(d.length===11)return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if(d.length===10)return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return null;
}
// Categorias e sitios do scanner de busca do PhoneInfoga (googlesearch). A
// lista do upstream e maior; aqui ficam os sitios de maior uso de cada
// categoria, para o relatorio nao virar uma lista de centenas de linhas.
const DORKS_TELEFONE=[
 {categoria:'Redes sociais',modelo:'site:{site} intext:"{numero}"',
  sitios:['facebook.com','twitter.com','linkedin.com','instagram.com','vk.com']},
 {categoria:'SMS descartavel',modelo:'site:{site} intext:"{numero}"',
  sitios:['receive-sms-online.info','receivesmsonline.com','receive-sms.com','receive-sms-online.com','smlive.co','freephonenum.com']},
 {categoria:'Reputacao',modelo:'site:{site} intext:"{numero}"',
  sitios:['whosenumber.info','findwhocallsme.com','who-calledme.com','usphonessearch.net','quinumero.info','phonenumbers.ie']},
 {categoria:'Pessoas',modelo:'site:{site} intext:"{numero}"',
  sitios:['numinfo.net','sync.me','whycall.me','locatefamily.com','spytox.com']}
];
// Busca geral: o numero solto e o numero com extensao de arquivo, como no
// scanner "general" do PhoneInfoga.
const DORKS_GERAIS=[
 'intext:"{numero}"',
 'intext:"{numero}" (ext:doc | ext:docx | ext:odt | ext:pdf | ext:rtf | ext:sxw | ext:psw | ext:ppt | ext:pptx | ext:pps | ext:csv | ext:txt | ext:xls)'
];
// As buscas viram links para o Google: a fonte nao consulta o Google e nao
// executa nenhum passo de tomada de conta.
function dorksDoTelefone(variantes){
  const urlDe=q=>'https://www.google.com/search?q='+encodeURIComponent(q);
  const saida={};
  for(const grupo of DORKS_TELEFONE){
    saida[grupo.categoria]=[];
    for(const sitio of grupo.sitios){
      const consulta=grupo.modelo.replaceAll('{site}',sitio).replaceAll('{numero}',variantes[0]);
      saida[grupo.categoria].push({alvo:sitio,consulta,url:urlDe(consulta)});
    }
  }
  saida['Busca geral']=[];
  for(const modelo of DORKS_GERAIS){
    for(const v of variantes){
      const consulta=modelo.replaceAll('{numero}',v);
      saida['Busca geral'].push({alvo:'google',consulta,url:urlDe(consulta)});
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Alvos novos: CPF, placa de veiculo e nome completo.
//
// Divisao de trabalho entre as fontes:
//   - as fontes locais (custo 0) nao chamam nenhum servico: elas validam o
//     formato e montam os links das consultas publicas;
//   - as fontes de rede tem parser estrito: formato desconhecido vira erro
//     ("formato inesperado"), nunca dado inventado.
//
// As tres fontes de rede passaram pela aceitacao com internet real em
// 2026-11-11 (`npm run aceite:novos-alvos`). A medicao mudou tres coisas
// que a verificacao offline nao podia ver:
//   - `cpf_brasilapi`: o provedor NAO devolve o cadastro completo (nome,
//     filiacao, endereco). Ele responde `{"cpf":"...","isValid":true,"rf":7,
//     "ufs":["ES","RJ"]}` ou `{"isValid":false}`. O parser foi refeito para
//     os dois formatos medidos;
//   - a fonte de veiculo trocou de provedor: `apicarros.com` e um dominio
//     estacionado (medido: HTTP 200 sem JSON) e o provedor vivo e o Consultar
//     Placa, que exige Basic Auth do operador;
//   - `nome_perfil`: a rota do Keybase mudou de `_api/1.0` para `/_/api/1.0`
//     (a antiga responde 404) e o perfil vem em `them`, e nao em `user`.
// ---------------------------------------------------------------------------
// CPFs de exemplo, com digito verificador valido: 111.444.777-35 (o exemplo
// classico da validacao de CPF, tambem o exemplo da documentacao da
// BrasilAPI) e 123.456.789-09.
const CPFS_DE_TESTE=new Set(['11144477735','12345678909']);
const formatarCpf=c=>`${c.slice(0,3)}.${c.slice(3,6)}.${c.slice(6,9)}-${c.slice(9)}`;
// Data de nascimento em ISO: alguns provedores entregam texto, outros
// entregam o dia, o mes e o ano separados.
const dataIso=v=>{
  if(v==null)return null;
  if(typeof v==='string')return texto(v);
  if(typeof v==='object'){
    const dia=texto(v.day),mes=texto(v.month),ano=texto(v.year);
    if(dia&&mes&&ano)return `${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
  }
  return null;
};
// Categorias e sitios das buscas publicas por placa. O que aparece em
// documento e em anuncio e, em regra, o proprio veiculo: a placa nao entrega
// o titular.
const DORKS_PLACA=[
 {categoria:'Documentos e anuncios',modelo:'intext:"{placa}" (ext:doc | ext:docx | ext:odt | ext:pdf | ext:rtf | ext:ppt | ext:pptx | ext:csv | ext:txt | ext:xls)',
  sitios:['google.com']},
 {categoria:'Veiculos e Detran',modelo:'site:{site} intext:"{placa}"',
  sitios:['mercosul.com.br','detran.sp.gov.br','detran.pr.gov.br','detran.rj.gov.br','gov.br']},
 {categoria:'Anuncios e chaveiro',modelo:'site:{site} "{placa}"',
  sitios:['olx.com.br','mercadolivre.com.br','webmotors.com.br','chaveiro.com.br']}
];
// As buscas viram links para o Google: a fonte nao consulta o Google.
function dorksDoPlaca(placa){
  const urlDe=q=>'https://www.google.com/search?q='+encodeURIComponent(q);
  const saida={};
  for(const grupo of DORKS_PLACA){
    saida[grupo.categoria]=[];
    for(const sitio of grupo.sitios){
      const consulta=(grupo.modelo.includes('{site}')?grupo.modelo.replaceAll('{site}',sitio):grupo.modelo)
        .replaceAll('{placa}',placa).trim();
      saida[grupo.categoria].push({alvo:sitio,consulta,url:urlDe(consulta)});
    }
  }
  return saida;
}
// Nome completo -> candidatos de nome de usuario. E a tecnica do Maigret (o
// repositorio de busca por nome completo mais usado da comunidade): o nome
// vira usuario e o usuario vira perfil. Nenhum cadastro e feito e nenhuma
// conta e criada: sao apenas GETs publicos.
const semAcento=s=>String(s??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
function usuariosDoNome(nome){
  const partes=String(nome??'').trim().split(/\s+/).filter(Boolean);
  if(partes.length<2)return [];
  const primeiro=semAcento(partes[0]).replace(/[^a-z0-9]/g,'');
  const ultimo=semAcento(partes[partes.length-1]).replace(/[^a-z0-9]/g,'');
  const meio=partes.length>2?semAcento(partes[1]).replace(/[^a-z0-9]/g,''):'';
  if(!primeiro||!ultimo)return [];
  const lista=[
    `${primeiro}${ultimo}`,
    `${primeiro}${ultimo[0]}`,
    `${primeiro}.${ultimo}`,
    `${primeiro[0]}${ultimo}`,
    `${primeiro}_${ultimo}`
  ];
  if(meio)lista.push(`${primeiro}${meio[0]}${ultimo}`,`${primeiro}.${meio[0]}${ultimo}`);
  return [...new Set(lista.filter(s=>s.length>=3&&s.length<=30))];
}
// Buscas publicas pelo nome completo: o termo exato, o nome dentro do texto e
// a busca em cada rede social.
const DORKS_NOME=[
 {categoria:'Busca geral',modelo:'"{nome}"',sitios:['google.com']},
 {categoria:'Busca geral',modelo:'intext:"{nome}"',sitios:['google.com']},
 {categoria:'Redes e perfis',modelo:'site:{site} "{nome}"',
  sitios:['linkedin.com','instagram.com','facebook.com','twitter.com','x.com','github.com','gitlab.com','tiktok.com','youtube.com','reddit.com']},
 {categoria:'Documentos',modelo:'"{nome}" (ext:pdf | ext:doc | ext:docx | ext:odt | ext:rtf | ext:xls | ext:csv)',sitios:['google.com']}
];
function dorksDoNome(nome){
  const urlDe=q=>'https://www.google.com/search?q='+encodeURIComponent(q);
  const saida={};
  for(const grupo of DORKS_NOME){
    saida[grupo.categoria]=saida[grupo.categoria]||[];
    for(const sitio of grupo.sitios){
      const consulta=(grupo.modelo.includes('{site}')?grupo.modelo.replaceAll('{site}',sitio):grupo.modelo)
        .replaceAll('{nome}',nome).trim();
      saida[grupo.categoria].push({alvo:sitio,consulta,url:urlDe(consulta)});
    }
  }
  return saida;
}
// Sites publicos que respondem se um nome de usuario existe, com parser
// proprio para cada um: um formato desconhecido vira "sem perfil", nunca
// um perfil inventado.
const SITES_PERFIL=[
 {site:'github',url:u=>`https://api.github.com/users/${encodeURIComponent(u)}`,
  perfil:j=>j&&typeof j==='object'&&j.login?{usuario:texto(j.login),nome:texto(j.name),url:texto(j.html_url)}:null},
 {site:'gitlab',url:u=>`https://gitlab.com/api/v4/users?username=${encodeURIComponent(u)}`,
  perfil:j=>{const a=lista(j);return a.length?{usuario:texto(a[0]?.username),nome:texto(a[0]?.name),url:texto(a[0]?.web_url)}:null;}},
 {site:'hackernews',url:u=>`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(u)}.json`,
  perfil:j=>j&&typeof j==='object'&&j.id?{usuario:texto(j.id),nome:null,url:`https://news.ycombinator.com/user?id=${j.id}`}:null},
 // Rota medida ao vivo em 2026-11-11: `/_/api/1.0/user/lookup.json`. A rota
 // antiga (`/_api/1.0/...`) responde 404. O perfil vem em `them` (o `them`
 // do `status.code` 0); usuario inexistente vem com HTTP 200 e
 // `status.code` 205 (NOT_FOUND).
 {site:'keybase',url:u=>`https://keybase.io/_/api/1.0/user/lookup.json?username=${encodeURIComponent(u)}`,
  perfil:j=>{const b=j?.them?.basics;
   return j?.status?.code===0&&b?.username?{usuario:texto(b.username),nome:texto(j?.them?.profile?.full_name),url:`https://keybase.io/${b.username}`}:null;}},
 {site:'devto',url:u=>`https://dev.to/api/users/by_username?url=${encodeURIComponent(u)}`,
  perfil:j=>j&&typeof j==='object'&&j.username?{usuario:texto(j.username),nome:texto(j.name),url:`https://dev.to/${j.username}`}:null}
];

// ---------------------------------------------------------------------------
// Number Verification API (APILayer) — o Numverify virou produto do
// marketplace.
//
// Medido ao vivo em 2026-11-20: a chave que o painel da APILayer entrega
// hoje (app.apilayer.com/signup/numverify/free) vale na rota do marketplace
// `api.apilayer.com/number_verification/validate`, com o cabecalho `apikey`.
// A rota antiga do Numverify (`apilayer.net/api/validate?access_key=...`)
// continua no ar para as chaves emitidas antes da migracao, mas recusa as
// chaves do marketplace com `invalid_access_key`. A fonte aceita as duas
// formas: tenta a do marketplace e, so quando o provedor recusa a
// autenticacao, tenta a antiga.
//
// O provedor responde em dois formatos de erro: o JSON do Numverify
// (`{"success":false,"error":{"type":...}}`) e o do marketplace
// (`{"message":...}`). Os dois viram mensagem util em portugues, com a acao
// que resolve — o operador precisa saber se a chave foi recusada, se a cota
// do plano acabou ou se o numero estava invalido.
// ---------------------------------------------------------------------------
const ROTA_NUMVERIFY_MARKETPLACE={
  nome:'marketplace',
  url:(chave,numero)=>`https://api.apilayer.com/number_verification/validate?number=${encodeURIComponent(numero)}`,
  headers:chave=>({apikey:chave})
};
const ROTA_NUMVERIFY_LEGADO={
  nome:'legado',
  url:(chave,numero)=>`https://apilayer.net/api/validate?access_key=${encodeURIComponent(chave)}&number=${encodeURIComponent(numero)}`,
  headers:()=>({})
};
// Texto do provedor por tipo de erro, em portugues. O relatorio corta a
// mensagem em 220 caracteres: por isso o texto e curto e direto.
const ERROS_NUMVERIFY={
  missing_access_key:'a chave nao chegou ao provedor (missing_access_key).',
  invalid_access_key:'chave recusada pelo provedor (invalid_access_key): a credencial nao vale para o produto de validacao de telefone.',
  inactive_user:'conta do provedor inativa (inactive_user): contate o suporte da APILayer.',
  usage_limit_reached:'cota do plano esgotada (usage_limit_reached): o provedor recusa consultas ate a renovacao.',
  rate_limit_reached:'limite de requisicoes do plano estourado (rate_limit_reached).',
  no_phone_number_provided:'o provedor nao recebeu o numero (no_phone_number_provided).',
  non_numeric_phone_number_provided:'o provedor recusou o numero por nao ser numerico (non_numeric_phone_number_provided).',
  invalid_country_code:'codigo de pais invalido (invalid_country_code).',
  invalid_api_function:'a rota pedida nao existe na API (invalid_api_function).',
  '404_not_found':'recurso inexistente na API (404_not_found).'
};
// O marketplace fala por `message` e nao por `error.type`.
const ERROS_NUMVERIFY_MENSAGEM=[
  [/invalid authentication credentials/i,'chave recusada pelo provedor: a credencial nao e reconhecida.'],
  [/no api key found/i,'a chave nao chegou ao provedor: o cabecalho apikey nao foi reconhecido.'],
  [/no route matched/i,'a rota pedida nao existe no provedor.'],
  [/not found/i,'recurso inexistente na API do provedor.']
];
// A acao que resolve o caso mais comum: chave recusada.
const DICA_CHAVE_RECUSADA=' Gere a chave em app.apilayer.com/signup/numverify/free e salve em NUMVERIFY_API_KEY.';
// Recusa de autenticacao: a chave chegou ao provedor e ele recusou (ou nao a
// viu). Sao as unicas situacoes em que a outra rota da credencial resolve.
const ehRecusaDeChave=(tipo,mensagem)=>{
  const t=String(tipo||'').toLowerCase();
  if(t==='invalid_access_key'||t==='missing_access_key')return true;
  return /invalid authentication credentials|no api key found/i.test(String(mensagem||''));
};
// Erro da fonte com orientacao, em vez do corpo cru do provedor.
function erroNumverify(tipo,mensagem,status){
  const t=String(tipo||'').trim();
  const bruto=String(mensagem||'').trim();
  let base=ERROS_NUMVERIFY[t]||null;
  if(!base){
    const achado=ERROS_NUMVERIFY_MENSAGEM.find(([re])=>re.test(bruto));
    base=achado?achado[1]:(bruto?bruto.slice(0,120):'o provedor recusou a consulta');
  }
  const dica=/invalid_access_key|invalid authentication/i.test(`${t} ${bruto}`)?DICA_CHAVE_RECUSADA:'';
  const e=new Error(`numverify: ${base}${dica}`);
  if(Number.isFinite(status)&&status>=400)e.status=status;
  return e;
}
// Corpo do provedor como objeto, sem lancar: o erro vem em JSON nos dois
// formatos, mas o texto do marketplace pode nao ser JSON.
async function jsonDoProvedor(r){
  let t='';
  try{t=await r.text();}catch{t=r.corpo||'';}
  if(!t)t=r.corpo||'';
  try{return JSON.parse(t);}catch{return null;}
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
 // Disponibilidade do e-mail em sites publicos: a mesma tecnica do holehe e
 // do blackbird, portada para o Worker. Oito endpoints, todos verificados ao
 // vivo nos dois sentidos. Nenhum site bloqueia a fonte inteira: cada um vira
 // "indisponivel" isoladamente e os demais continuam.
 {id:'email_registro',tipos:['email'],custo:8,ttl:21600,provenance:'holehe-blackbird-cadastro',
  async run(a,c){
    const e=String(a.valor??'').trim();
    const sites=await Promise.all(CHECAGENS_CADASTRO.map(async chec=>{
      try{
        const r=await chec.roda(c,e);
        return {site:chec.site,estado:r.estado,detalhe:r.detalhe};
      }catch(err){
        return {site:chec.site,estado:'indisponivel',detalhe:String(err?.message||'erro').slice(0,90)};
      }
    }));
    const responderam=sites.filter(s=>s.estado!=='indisponivel');
    // Sem nenhuma resposta utilizavel a fonte falha de verdade: e melhor
    // reportar falha do que entregar um "nada encontrado" sem evidence.
    if(responderam.length===0)throw Error('nenhuma checagem de cadastro respondeu');
    const cadastrados=responderam.filter(s=>s.estado==='cadastrado');
    return {dados:{
      total:cadastrados.length,
      checagens:responderam.length,
      sites,
      observacao:`Disponibilidade do e-mail em ${responderam.length} de ${CHECAGENS_CADASTRO.length} sites publicos; ${cadastrados.length} com cadastro encontrado. "Cadastrado" quer dizer que o endereco esta em uso naquele servico, nao quem o controla.`
    }};
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
    // cadastro. A consulta usa sempre a base publica (publica.cnpj.ws): o
    // token comercial saiu do projeto, entao a fonte nao exige credencial.
    const tentarCnpjWs=async()=>{
      const r=await c.get(`https://publica.cnpj.ws/cnpj/${encodeURIComponent(a.valor)}`,{timeout:7000});
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
 // Formatos do numero e buscas publicas, sem chamada de rede: e o scanner
 // local e o scanner de busca do PhoneInfoga (18,5 mil estrelas) portados
 // para o Worker. As buscas sao links para o Google, nao consultas: nada
 // e enviado a nenhum servico com o numero.
 {id:'phone_footprint',tipos:['telefone'],custo:0,ttl:0,provenance:'phoneinfoga-local-dorks',
  async run(a,c){
    const digitos=so(a.valor);
    if(digitos.length<8)throw Error('numero de telefone curto demais');
    const internacional=telefoneE164(a.valor);
    const pais=paisDoNumero(internacional);
    const local=pais?internacional.slice(pais.codigo.length):internacional;
    const variantes=local&&local!==internacional&&local.length>=8?[internacional,local]:[internacional];
    return {dados:{
      numero:String(a.valor??'').trim(),
      internacional,
      e164:'+'+internacional,
      nacional:pais?.iso==='BR'?formatarBr(local):null,
      pais:pais?`${pais.nome} (+${pais.codigo})`:null,
      links:{whatsapp:'https://wa.me/'+internacional,telegram:'https://t.me/+'+internacional},
      buscas:dorksDoTelefone(variantes),
      observacao:'Formatos do numero e links para as buscas publicas por categoria (redes sociais, SMS descartavel, reputacao, pessoas), no mesmo estilo do PhoneInfoga. A fonte nao consulta o Google e nao executa nenhuma etapa de tomada de conta.'
    }};
  }},
 // Validade, operadora e pais do numero. Provedor: Number Verification API da
 // APILayer (o Numverify virou produto do marketplace). Sem credencial a
 // API responde 401, entao a fonte e declarada com credencial obrigatoria no
 // manifesto e responde sem_chave quando ela falta (falha de configuracao,
 // nao resultado parcial).
 //
 // A fonte aceita as duas formas de credencial do provedor: a do marketplace
 // (`api.apilayer.com/number_verification/validate` com o cabecalho `apikey`,
 // que e a chave que o painel da APILayer entrega hoje) e a antiga do
 // Numverify (`apilayer.net/api/validate` com `access_key` na query). Tenta a
 // do marketplace primeiro e so cai na antiga quando o provedor recusa a
 // autenticacao. `NUMVERIFY_API_ROTA` fixa a rota: `auto` (padrao),
 // `marketplace` ou `legado`.
 {id:'numverify',tipos:['telefone'],custo:1,ttl:43200,provenance:'numverify-apilayer',
  async run(a,c){
    exigirCredencial(c.env,'numverify');
    const numero=telefoneE164(a.valor);
    // Chave colada com espaco ou quebra de linha e recusada pelo provedor:
    // o corte aqui evita o 401 sem significado.
    const chave=String(valorDaCredencial(c.env,'numverify')||'').trim();
    const preferencia=String(c.env.NUMVERIFY_API_ROTA||'auto').trim().toLowerCase();
    const rotas=preferencia==='legado'?[ROTA_NUMVERIFY_LEGADO]
      :preferencia==='marketplace'?[ROTA_NUMVERIFY_MARKETPLACE]
      :[ROTA_NUMVERIFY_MARKETPLACE,ROTA_NUMVERIFY_LEGADO];
    let recusa=null;
    for(const rota of rotas){
      const r=await c.get(rota.url(chave,numero),{timeout:7000,headers:rota.headers(chave)});
      if(r.ok){
        const j=await J(r);
        // Numverify legado: erro no corpo, com `success:false`.
        if(j?.success===false)throw erroNumverify(j?.error?.type,j?.error?.info,r.status);
        // Marketplace: erro no corpo, com `message`.
        if(j&&typeof j==='object'&&!Array.isArray(j)&&j.valid===undefined&&typeof j.message==='string')
          throw erroNumverify(null,j.message,r.status);
        return {dados:{valido:j?.valid===true,numero:j?.number??null,formatoLocal:j?.local_format??null,
          formatoInternacional:j?.international_format??null,codigoPais:j?.country_code??null,pais:j?.country_name??null,
          localizacao:j?.location??null,operadora:j?.carrier??null,tipoLinha:j?.line_type??null,
          provedor:rota.nome,
          observacao:'Validade, operadora, pais e tipo de linha do numero (Numverify/APILayer).'}};
      }
      const j=await jsonDoProvedor(r);
      const tipo=j?.error?.type||null;
      const mensagem=j?.message||j?.error?.info||r.corpo||'';
      if(ehRecusaDeChave(tipo,mensagem)||r.status===404){
        // A outra forma da credencial pode resolver: recusa de autenticacao
        // ou rota que o provedor nao expoe mais. Tenta antes de falhar.
        recusa={tipo,mensagem,status:r.status};
        continue;
      }
      // Cota estourada, conta inativa, numero invalido: nao adianta trocar
      // de rota, o erro e repassado com a orientacao.
      throw erroNumverify(tipo,mensagem,r.status);
    }
    // As duas rotas recusaram a credencial.
    throw erroNumverify(recusa?.tipo,recusa?.mensagem,recusa?.status);
  }},
 {id:'wikidata',tipos:['nome'],custo:1,ttl:604800,provenance:'wikidata-sparql',
  async run(a,c){
    const q=`SELECT ?item ?itemLabel ?desc WHERE{?item rdfs:label "${a.valor.replace(/"/g,'')}"@pt-BR;schema:description ?desc. SERVICE wikibase:label{bd:serviceParam wikibase:language "pt".}} LIMIT 5`;
    const r=await c.get(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`,{timeout:9000});
    if(!r.ok) throw falhar(r);
    const b=(await J(r)).results?.bindings||[];
    return {dados:{total:b.length,entidades:b.map(x=>({id:String(x?.item?.value||'').split('/').pop(),desc:x?.desc?.value??null}))}};
  }},
 // -------------------------------------------------------------------------
 // DataJud (CNJ). Medido em 2026-11-11 com a credencial real: a API publica do
 // CNJ respondeu HTTP 200 em 26 s a 40 s (o mesmo pedido sem credencial
 // respondeu 401 em 46 ms, o que prova que a chave era reconhecida). O prazo
 // de 9 s que existia aqui abortava a consulta antes de a API responder e a
 // fonte virava "timeout" em toda busca: o prazo agora acompanha a latencia
 // real do CNJ.
 //
 // A busca por nome cobre os dois campos de nome do indice `api_publica_stj`:
 // `movimentos.orgaoJulgador.nome` (orgao julgador/magistrado) e `partes.nome`
 // (nome das partes). Medido: `partes.nome` devolveu total 0 no indice do STJ
 // e o campo do orgao julgador devolveu documento; por isso a fonte informa
 // em qual campo houve o casamento.
 //
 // A consulta e mantida barata de proposito: o cluster publico do CNJ e
 // compartilhado e responde 429 (es_rejected_execution_exception) quando a
 // busca e cara. Por isso `track_total_hits:false` (nao conta todos os
 // acertos), `terminate_after` (corta a execucao) e `_source` fechado.
 {id:'datajud',tipos:['nome'],custo:2,ttl:86400,provenance:'cnj-datajud',
  async run(a,c){
    exigirCredencial(c.env,'datajud');
    const key=`APIKey ${c.env.DATAJUD_API_KEY}`;
    const limpo=a.valor.replace(/[:"“”()\[\]{}^~*?\\!]/g,' ').replace(/\s+/g,' ').trim();
    const url='https://api-publica.datajud.cnj.jus.br/api_publica_stj/_search';
    if(!limpo)throw Error('nome vazio para a busca no DataJud');
    const headers={authorization:key,'content-type':'application/json'};
    let r=await c.get(url,{method:'POST',timeout:30000,headers,
      body:JSON.stringify({size:10,_source:['numeroProcesso','classe.nome','dataAbertura','movimentos.orgaoJulgador.nome','partes.nome'],track_total_hits:false,terminate_after:15000,query:{bool:{should:[{match_phrase:{'movimentos.orgaoJulgador.nome':{query:limpo}}},{match_phrase:{'partes.nome':{query:limpo}}}],minimum_should_match:1}}})});
    // O status HTTP precisa viajar com o erro: sem `.status` o contrato
    // (src/contract.mjs) classifica a recusa como `erro` generico, e o painel
    // perde a explicacao de `http` que o catalogo escreve para o CNJ
    // ("401 security_exception e a chave recusada pelo CNJ"). O mesmo
    // formato de erro (`Error` + `.status`) ja e o de `erroNumverify`.
    if(r.status===401||r.status===403){const e=Error(`credencial recusada pelo CNJ (HTTP ${r.status})`);e.status=r.status;throw e;}
    if(r.status===429){const e=Error('CNJ sobrecarregado (HTTP 429): o cluster publico rejeitou a consulta');e.status=429;throw e;}
    if(r.status===400)r=await c.get(url,{method:'POST',timeout:30000,headers,
      body:JSON.stringify({size:10,query:{match_phrase:{'movimentos.orgaoJulgador.nome':{query:limpo}}}})});
    if(!r.ok) throw falhar(r);
    const j=await J(r);
    const hits=lista(j?.hits?.hits);
    return {dados:{
      total:j?.hits?.total?.value??hits.length,
      total_truncado:j?.hits?.total?.relation!=='eq',
      indice:'api_publica_stj',
      processos:hits.map(h=>{
        const src=h?._source||{};
        const partes=lista(src.partes).map(p=>texto(p?.nome)).filter(Boolean);
        const orgao=texto(src?.movimentos?.orgaoJulgador?.nome);
        return {
          numero:texto(src.numeroProcesso),
          classe:texto(src?.classe?.nome),
          data_abertura:texto(src.dataAbertura),
          orgao_julgador:orgao,
          partes,
          casou_em:partes.length?'partes.nome':(orgao?'movimentos.orgaoJulgador.nome':null)
        };
      }),
      observacao:'Busca por nome no indice publico do CNJ (api_publica_stj), no campo do orgao julgador/magistrado e no nome das partes. O indice publico do STJ nao expoe o cadastro de partes no mesmo formato do indice do CNJ: quando o casamento ocorre no orgao julgador, o resultado sao processos cujo orgao ou magistrado tem o nome buscado, e nao processos em que o alvo e parte. A API do CNJ e lenta e compartilhada (26 s a 40 s medidos): o total pode vir truncado e a consulta pode ser rejeitada por sobrecarga (429).'
    }};
  }},
 // -------------------------------------------------------------------------
 // CPF: validacao local (sem rede) e consulta do cadastro publico.
 // -------------------------------------------------------------------------
 // A validacao local confere os digitos verificadores do CPF: ela diz se o
 // numero tem a aritmetica correta, e nada mais. Nao diz quem e o titular,
 // e nao substitui a consulta oficial da Receita (que exige captcha).
 {id:'cpf_valida',tipos:['cpf'],custo:0,ttl:0,provenance:'cpf-dv-local',
  async run(a,c){
    const cpf=so(a.valor);
    if(!cpfOk(cpf))throw Error('CPF invalido');
    return {dados:{
      cpf:formatarCpf(cpf),
      valido:true,
      digitos_verificadores:cpf.slice(9),
      cpf_de_teste:CPFS_DE_TESTE.has(cpf),
      links:{
        receita_federal:'https://servicos.receita.fazenda.gov.br/servicos/cpf/comprovante-inscricao',
        brasilapi:`https://brasilapi.com.br/api/cpf/v1/${cpf}`
      },
      observacao:'Validacao local dos digitos verificadores do CPF e links para as consultas publicas. A fonte nao consulta nenhum servico e nao informa titularidade.'
    }};
  }},
 // Cadastro publico do CPF na BrasilAPI. Respostas medidas ao vivo em
 // 2026-11-11: `{"cpf":"111.444.777-35","isValid":true,"rf":7,"ufs":["ES","RJ"]}`
 // (digitos validos, sem dados pessoais), `{"isValid":false}` (digitos
 // invalidos) e 404 (CPF fora da base). O provedor NAO devolve nome,
 // nascimento, filiacao nem endereco: a fonte publica o que recebeu e nada
 // alem. Formato desconhecido vira erro: nada de dado chumbado.
 {id:'cpf_brasilapi',tipos:['cpf'],custo:1,ttl:86400,provenance:'brasilapi-cpf-v1',
  async run(a,c){
    const cpf=so(a.valor);
    const r=await c.get(`https://brasilapi.com.br/api/cpf/v1/${encodeURIComponent(cpf)}`,{timeout:8000});
    if(r.status===404)return {dados:{existe:false,provedor:'brasilapi',
      digitos_validos:null,cadastro_disponivel:false,
      observacao:'O CPF nao consta na base publica do provedor. Ausencia na base nao prova que o CPF nao exista.'}};
    if(!r.ok)throw falhar(r);
    const j=await J(r);
    if(!j||typeof j!=='object'||Array.isArray(j))throw Error('formato inesperado de CPF');
    const ufs=lista(j.ufs).map(texto).filter(Boolean);
    const regiaoFiscal=texto(j.rf);
    // Digitos invalidos: o provedor diz que o CPF nao passa no verificador.
    if(j.isValid===false)return {dados:{existe:false,provedor:'brasilapi',
      digitos_validos:false,cadastro_disponivel:false,regiao_fiscal:regiaoFiscal,ufs,
      observacao:'O provedor respondeu que o CPF nao passa no digito verificador. A fonte repete a resposta do provedor e nao consulta a Receita.'}};
    const e=j.endereco&&typeof j.endereco==='object'?j.endereco:{};
    const nome=texto(j.nome??j.name);
    const nascimento=dataIso(j.nascimento??j.birthDate??j.dataNascimento);
    // Cadastro completo: o provedor devolveu dados pessoais.
    if(nome||nascimento)return {dados:{
      existe:true,provedor:'brasilapi',digitos_validos:true,cadastro_disponivel:true,
      nome,nascimento,
      sexo:texto(j.sexo??j.gender),
      mae:texto(j.mae??j.mother),
      pai:texto(j.pai??j.father),
      email:texto(j.email),
      telefone:texto(j.telefone??j.phone),
      endereco:{
        cep:texto(e.cep),
        logradouro:texto(e.logradouro),
        numero:texto(e.numero),
        bairro:texto(e.bairro),
        municipio:texto(e.localidade??e.cidade),
        uf:texto(e.uf)
      },
      regiao_fiscal:regiaoFiscal,ufs,
      observacao:'Cadastro do CPF na base publica da BrasilAPI. A base e uma copia parcial do cadastro da Receita e nao cobre todos os CPFs emitidos.'
    }};
    // Digitos validos, mas sem dados pessoais publicados: `existe` fica nulo
    // de proposito — o provedor nao disse que o CPF existe nem que nao existe.
    if(j.isValid===true)return {dados:{existe:null,provedor:'brasilapi',
      digitos_validos:true,cadastro_disponivel:false,regiao_fiscal:regiaoFiscal,ufs,
      observacao:'O provedor validou os digitos do CPF e devolveu a regiao fiscal, mas nao publica dados pessoais deste CPF.'}};
    throw Error('formato inesperado de CPF');
  }},
 // -------------------------------------------------------------------------
 // Placa de veiculo: formato e buscas publicas (sem rede) e cadastro do
 // veiculo (com rede).
 // -------------------------------------------------------------------------
 // O que a placa entrega e o veiculo: modelo, ano, cor e o municipio/UF do
 // registro. O titular do veiculo nao e dado publico: nenhuma fonte aqui
 // promete achar o nome do dono.
 {id:'placa_footprint',tipos:['placa'],custo:0,ttl:0,provenance:'placa-mercosul-local',
  async run(a,c){
    const p=normalizarPlaca(a.valor);
    if(!p)throw Error('placa nao reconhecida');
    return {dados:{
      placa:p.valor,
      modelo:p.modelo==='mercosul'?'Mercosul (LLLNLNN)':'anterior (LLLNNNN)',
      buscas:dorksDoPlaca(p.valor),
      links:{
        sinesp_oficial:'https://cidadao.sinesp.gov.br/',
        consultar_placa:`https://api.consultarplaca.com.br/v2/consultarPlaca?placa=${p.valor}`,
        documentacao_consultar_placa:'https://docs.consultarplaca.com.br/',
        detran:'https://www.detran.sp.gov.br/'
      },
      observacao:'A fonte nao consulta nenhum servico: valida o formato da placa e entrega os links das consultas publicas. As rotas foram medidas em 2026-11-11: a API do Consultar Placa respondeu (HTTP 401 sem credencial) e a documentacao e publica; o host do SINESP resolve (189.9.194.154) mas nao aceitou conexao a partir da maquina de verificacao, nas portas 80, 443 e 8443.'
    }};
  }},
 // Cadastro publico do veiculo pela API do Consultar Placa (v2). Medido em
 // 2026-11-11: o host `api.consultarplaca.com.br` responde e o contrato esta
 // publicado em https://docs.consultarplaca.com.br (rota
 // `GET /v2/consultarPlaca?placa=`). A API exige Basic Auth: o e-mail da
 // conta como usuario e a api_key como senha. Sem essa credencial a fonte nao
 // roda (`sem_chave`): nao existe caminho publico para a consulta, e o
 // provedor responde 401. A placa de teste gratuita do provedor e `AAA0000`.
 {id:'placa_consultarplaca',tipos:['placa'],custo:1,ttl:86400,provenance:'consultarplaca-v2',
  async run(a,c){
    exigirCredencial(c.env,'placa_consultarplaca');
    const credencial=valorDaCredencial(c.env,'placa_consultarplaca')||'';
    const corte=credencial.indexOf(':');
    if(corte<1)throw Error('credencial do provedor invalida (esperado email:api_key)');
    const usuario=credencial.slice(0,corte);
    const senha=credencial.slice(corte+1);
    const p=normalizarPlaca(a.valor);
    if(!p)throw Error('placa nao reconhecida');
    const r=await c.get(`https://api.consultarplaca.com.br/v2/consultarPlaca?placa=${encodeURIComponent(p.valor)}`,
      {timeout:10000,headers:{authorization:`Basic ${btoa(`${usuario}:${senha}`)}`}});
    if(!r.ok)throw falhar(r);
    const j=await J(r);
    if(!j||typeof j!=='object'||Array.isArray(j))throw Error('formato inesperado de placa');
    // O provedor responde 200 tambem nos casos de erro, com status "erro" e
    // `tipo_do_erro` (placa_nao_encontrada, servico_indisponivel,
    // credito_insuficiente).
    if(j.status==='erro'){
      const tipo=texto(j.tipo_do_erro);
      if(tipo==='placa_nao_encontrada'||tipo==='informacao_nao_encontrada')
        return {dados:{existe:false,provedor:'consultarplaca',motivo:tipo,
          observacao:'O provedor nao tem informacao para esta placa. Ausencia na base do provedor nao prova que o veiculo nao exista.'}};
      throw Error(`provedor respondeu erro: ${tipo||texto(j.mensagem)||'sem detalhe'}`);
    }
    if(j.status!=='ok')throw Error('formato inesperado de placa');
    const info=j?.dados?.informacoes_veiculo;
    const v=info?.dados_veiculo;
    if(!v||typeof v!=='object'||Array.isArray(v))throw Error('formato inesperado de placa');
    const t=info?.dados_tecnicos&&typeof info.dados_tecnicos==='object'?info.dados_tecnicos:{};
    return {dados:{
      existe:true,provedor:'consultarplaca',
      placa:texto(v.placa),
      chassi:texto(v.chassi),
      modelo:texto(v.modelo),
      marca:texto(v.marca),
      ano_fabricacao:texto(v.ano_fabricacao),
      ano_modelo:texto(v.ano_modelo),
      cor:texto(v.cor),
      segmento:texto(v.segmento),
      especie:texto(v.especie),
      combustivel:texto(v.combustivel),
      procedencia:texto(v.procedencia),
      municipio:texto(v.municipio),
      uf:texto(v.uf_municipio),
      tipo_veiculo:texto(t.tipo_veiculo),
      sub_segmento:texto(t.sub_segmento),
      potencia:texto(t.potencia),
      cilindradas:texto(t.cilindradas),
      data_solicitacao:texto(j.data_solicitacao),
      observacao:'Dados do veiculo no cadastro consultado (modelo, ano, cor e municipio/UF do registro). O provedor nao informa o titular do veiculo.'
    }};
  }},
 // -------------------------------------------------------------------------
 // Nome completo: candidatos de usuario (tecnica do Maigret) e perfis
 // publicos.
 // -------------------------------------------------------------------------
 // O nome vira usuario e o usuario vira perfil. Nenhum cadastro e feito e
 // nenhuma conta e criada: sao GETs publicos que dizem se o usuario existe.
 // Um perfil com o mesmo nome nao prova que seja a pessoa do alvo: a fonte
 // diz isso no relatorio.
 {id:'nome_perfil',tipos:['nome'],custo:10,ttl:86400,provenance:'maigret-perfil-publico',
  async run(a,c){
    const nome=String(a.valor??'').trim();
    const candidatos=usuariosDoNome(nome);
    if(!candidatos.length)throw Error('nome sem partes suficientes para gerar usuario');
    const testados=candidatos.slice(0,2);
    const perfis=[];const falhas=[];let respondeu=0;let semPerfil=0;
    for(const usuario of testados){
      for(const s of SITES_PERFIL){
        try{
          const r=await c.get(s.url(usuario),{timeout:6000});
          // 404 e resposta valida do site: o usuario nao existe ali. Isso e
          // "sem perfil", nao falha do provedor.
          if(r.status===404){respondeu++;semPerfil++;continue;}
          if(!r.ok){falhas.push({site:s.site,usuario,status:r.status});continue;}
          const j=await J(r);
          respondeu++;
          const p=s.perfil(j);
          if(p)perfis.push({site:s.site,...p});
          else semPerfil++;
        }catch(e){
          falhas.push({site:s.site,usuario,detalhe:String(e?.message||'erro').slice(0,90)});
        }
      }
    }
    // Nenhum site respondeu: e falha real do provedor, e nao "nada
    // encontrado". Com pelo menos uma resposta, a ausencia de perfil e um
    // resultado legitimo.
    if(!respondeu)throw Error(`nenhum site de perfil respondeu (${falhas.length} falhas)`);
    return {dados:{
      nome,
      usuarios:candidatos,
      testados:testados.length,
      perfis,
      respostas:respondeu,
      sem_perfil:semPerfil,
      falhas:falhas.length,
      buscas:dorksDoNome(nome),
      observacao:`Perfis publicos com nomes de usuario derivados do nome completo (tecnica do Maigret). ${perfis.length} perfil(is) em ${testados.length} usuario(s) testado(s) e ${SITES_PERFIL.length} sites; ${respondeu} resposta(s) valida(s), ${semPerfil} consulta(s) sem perfil e ${falhas.length} indisponivel(is). Um perfil com o mesmo nome nao prova que a pessoa do alvo seja a dona do perfil.`
    }};
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
