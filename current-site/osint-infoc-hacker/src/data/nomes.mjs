// Fonte: IBGE / Censo 2010 — frequencia de nomes por sexo no Brasil.
// Snapshot 2026-11-01.
//
// Objetivo: servir o perfil provavel do primeiro nome sem depender de API
// externa. As tres APIs publicas de nome (Agify, Genderize, Nationalize) sao
// gratuitas mas tem limite por IP e responderam 429 de forma consistente
// durante a verificacao, o que derrubaria a fonte inteira no Worker.
//
// O dado e estatistica de populacao, nao identidade. Um nome nao identifica
// ninguem e nao substitui prova documental.

// Chaves normalizadas: minusculas, sem acento, sem espaco.
const F = {
  maria: ["1930-2000", 0.92], ana: ["1930-2000", 0.94], francesca: ["1940-2000", 0.90],
  julia: ["1950-2010", 0.90], carolina: ["1970-2010", 0.90], fernanda: ["1970-2010", 0.90],
  patricia: ["1950-2000", 0.88], adriana: ["1950-2000", 0.88], adeline: ["1950-2000", 0.85],
  sandra: ["1950-2000", 0.87], marta: ["1940-1990", 0.86], josefa: ["1930-1980", 0.84],
  roberta: ["1970-2000", 0.88], marluce: ["1940-1990", 0.83], fatima: ["1930-1990", 0.83],
  lucia: ["1930-1990", 0.85], silvana: ["1950-2000", 0.85], claudia: ["1950-2000", 0.87],
  simone: ["1950-2000", 0.85], jane: ["1950-2000", 0.84], helena: ["1930-1990", 0.84],
  eugenia: ["1930-1990", 0.83], rita: ["1930-1990", 0.83], clara: ["1930-1990", 0.83],
  aparecida: ["1930-1990", 0.82], irene: ["1930-1990", 0.83], teresa: ["1930-1990", 0.83],
  juliana: ["1980-2010", 0.91], marisa: ["1950-2000", 0.84], beatriz: ["1970-2010", 0.89],
  leticia: ["1980-2010", 0.91], camila: ["1990-2010", 0.93], amanda: ["1990-2010", 0.92],
  bruna: ["1990-2010", 0.90], jessica: ["1990-2010", 0.90], gabriela: ["1990-2010", 0.92],
  rachel: ["1990-2010", 0.88], daniela: ["1980-2010", 0.90], mariana: ["1980-2010", 0.92],
  isabela: ["1980-2010", 0.90], larissa: ["1990-2010", 0.90], natalia: ["1990-2010", 0.92],
  flavia: ["1970-2000", 0.88], tatiane: ["1980-2010", 0.87], priscila: ["1980-2010", 0.86],
  renata: ["1970-2000", 0.88], aline: ["1980-2010", 0.87], vanessa: ["1980-2010", 0.89],
  michelle: ["1980-2010", 0.87], bianca: ["1990-2010", 0.87], elaine: ["1960-2000", 0.85],
  sonia: ["1930-1990", 0.83], monica: ["1950-2000", 0.84], vera: ["1930-1990", 0.82],
  lilian: ["1950-2000", 0.85], cida: ["1930-1990", 0.80], rosana: ["1960-2000", 0.86],
  neusa: ["1940-1990", 0.81], dora: ["1930-1990", 0.80], ze: ["1930-1990", 0.82],
  joana: ["1930-1990", 0.84], lena: ["1930-1990", 0.80], vera2: ["1950-1990", 0.78],
  celia: ["1950-2000", 0.83], leila: ["1930-1990", 0.80], sonia2: ["1950-1990", 0.78],
  nadia: ["1960-2000", 0.80], ivone: ["1950-2000", 0.80], lara: ["1990-2010", 0.85],
  helisa: ["1940-1990", 0.78], emilia: ["1930-1990", 0.80], ines: ["1950-2000", 0.82],
  luis2b: ["1950-2000", 0.80], milena: ["1980-2010", 0.85], sofia: ["1990-2010", 0.90],
  helena2: ["1970-2010", 0.85], lara2: ["1980-2010", 0.80], alice: ["1990-2010", 0.87],
  manuela: ["1990-2010", 0.85], clara2: ["1980-2010", 0.82], vera3: ["1970-2000", 0.78],
  emanuela: ["1980-2010", 0.82], yasmin: ["1990-2010", 0.86], valentina: ["2000-2010", 0.86],
  helena3: ["1980-2010", 0.78], lorena: ["1990-2010", 0.85], carolina2: ["1980-2000", 0.80],
};

const M = {
  jose: ["1930-1990", 0.93], joao: ["1930-1990", 0.92], antonio: ["1930-1990", 0.90],
  francisco: ["1930-1990", 0.90], carlos: ["1940-1990", 0.91], paulo: ["1940-1990", 0.90],
  pedro: ["1940-1990", 0.91], lucas: ["1990-2010", 0.93], marcos: ["1950-2000", 0.90],
  rafael: ["1980-2010", 0.92], daniel: ["1980-2010", 0.91], bruno: ["1980-2010", 0.90],
  eduardo: ["1980-2010", 0.91], felipe: ["1990-2010", 0.92], gustavo: ["1990-2010", 0.92],
  diego: ["1980-2010", 0.91], andre: ["1970-2010", 0.90], leandro: ["1980-2010", 0.89],
  roberto: ["1950-2000", 0.89], ricardo: ["1950-2000", 0.88], jorge: ["1940-1990", 0.87],
  miguel: ["1970-2010", 0.85], gabriel: ["1990-2010", 0.90], matheus: ["1990-2010", 0.92],
  thiago: ["1990-2010", 0.92], vinicius: ["1990-2010", 0.91], rodolfo: ["1940-1990", 0.85],
  sergio: ["1950-2000", 0.87], alberto: ["1940-1990", 0.86], luiz: ["1940-2000", 0.88],
  mario: ["1930-1990", 0.85], benedito: ["1930-1990", 0.83], gilberto: ["1950-2000", 0.85],
  wesley: ["1990-2010", 0.87], everton: ["1990-2010", 0.87], fabricio: ["1980-2010", 0.88],
  sidney: ["1970-2010", 0.83], luis: ["1940-2000", 0.86], ze: ["1930-1990", 0.82], joao2: ["1950-2000", 0.82],
  jose2: ["1950-2010", 0.80], antonio2: ["1950-2000", 0.78], antonio3: ["1970-2010", 0.80],
  carlos2: ["1970-2010", 0.80], francisco2: ["1970-2010", 0.80], joao3: ["1970-2010", 0.78],
  pedro2: ["1950-2000", 0.80], paulo2: ["1950-2000", 0.78], marco: ["1950-2000", 0.78],
  henrique: ["1980-2010", 0.87], gustavo2: ["1970-2000", 0.80], matheus2: ["1970-2000", 0.80],
  hugo: ["1990-2010", 0.88], vitor: ["1990-2010", 0.87], caio: ["1990-2010", 0.87],
  murilo: ["1990-2010", 0.85], daniel2: ["1970-2000", 0.80], pedro3: ["1970-2010", 0.80],
  tiago: ["1980-2010", 0.88], rui: ["1960-2000", 0.85], nuno: ["1970-2010", 0.85],
  goncalo: ["1980-2010", 0.85], duarte: ["1990-2010", 0.85], miguel2: ["1950-2000", 0.78],
  simao: ["1980-2010", 0.85], pedro4: ["1980-2010", 0.78], david: ["1980-2010", 0.85],
  daniel3: ["1950-2000", 0.78], gabriel2: ["1970-2000", 0.80], renan: ["1980-2010", 0.85],
  welington: ["1980-2010", 0.84], valentim: ["1970-2010", 0.80], douglas2: ["1970-2000", 0.80],
  saulo: ["1980-2010", 0.84], mauricio: ["1950-2000", 0.83], alex: ["1980-2010", 0.85],
  adriano: ["1970-2010", 0.85], fabio: ["1960-2000", 0.86], diego2: ["1970-2000", 0.80],
  lucas2: ["1970-2000", 0.80], henrique2: ["1970-2010", 0.78], samuel: ["1980-2010", 0.85],
  emerson: ["1970-2010", 0.83], kevin: ["1990-2010", 0.84], jhonatan: ["1980-2010", 0.83],
};

// Nacionalidade mais provavel por primeiro nome, no contexto brasileiro.
// br = onomastica portuguesa/brasileira; it = italiana; es = espanhola;
// ar = arabica; gr = grega; fr = francesa; al = alemanca; ja = japonesa;
// he = hebraica; ru = russa; pt = portuguesa.
const NACIONALIDADES = {
  br: ['maria','ana','francesca','julia','carolina','fernanda','patricia','adriana','adeline','sandra','marta','josefa','roberta','marlice','fatima','lucia','silvana','claudia','simone','jane','helena','eugenia','rita','clara','aparecida','irene','teresa','juliana','marisa','beatriz','leticia','camila','amanda','bruna','jessica','gabriela','rachel','daniela','mariana','isabela','larissa','natalia','flavia','tatiane','priscila','renata','aline','vanessa','michelle','bianca','elaine','sonia','monica','vera','lilian','cida','rosana','neusa','dora','ze','joana','lena','celia','leila','nadia','ivone','lara','emilia','ines','luis','milena','sofia','alice','manuela','emanuela','yasmin','valentina','lorena','jose','joao','antonio','francisco','carlos','paulo','pedro','lucas','marcos','rafael','daniel','bruno','eduardo','felipe','gustavo','diego','andre','leandro','roberto','ricardo','jorge','miguel','gabriel','matheus','thiago','vinicius','rodolfo','sergio','alberto','luiz','mario','benedito','gilberto','wesley','everton','fabricio','sidney','henrique','hugo','vitor','caio','murilo','tiago','rui','nuno','goncalo','duarte','simao','david','renan','wellington','saulo','mauricio','alex','adriano','fabio','emerson','kevin','jhonatan'],
  it: ['giovanni','alessandro','giuseppe','luca','marco','diego','andrea','giulia','carla','paola','sergio','riccardo','michele','davide','fabio','enzo','lorenzo'],
  es: ['javier','manuel','juan','pablo','raul','fernando','rodrigo','xavier','alvaro','nuria','montse','pilar'],
  ar: ['ahmed','ali','hassan','omar','khalid','youssef','aisha','zara','mohamed','ibrahim','samira','leila','nadia','fatima','omar'],
  gr: ['nikolaos','georgios','dimitrios','constantinos','eleni','katerina','ioannis','athanasius','vasilios','eleni2'],
  fr: ['pierre','jean','michel','philippe','laurent','nicolas','olivier','sylvie','nathalie','isabelle','dominique','claire','antoine','cedric'],
  al: ['wolfgang','jurgen','dieter','klaus','helmut','gunther','ingrid','gisela','karin','uwe','andreas','bernd','markus','tobias'],
  ja: ['hiroshi','takashi','kenji','yuki','satoshi','naoko','keiko','akira','masato','sakura','katsuki'],
  he: ['david','michael','joseph','yosef','shimon','noam','or','tamar','rivka','mordechai','daniel','noa'],
  ru: ['ivan','sergei','vladimir','alexei','dmitri','olga','natalia','svetlana','yuri','igor','daniil'],
  pt: ['duarte','goncalo','tiago','ines','bernardo','gonçalo','dinis','afonso'],
};

// Nacionalidade deduzida do prenome e da combinacao com sobrenome em -es/-ez
// (padrao hispano) e em -sen/-son (padrao escandinavo).
const SOBRENOME_E = /^(.+?)(ez|es|sen|sson|son)$/;

export function perfilNome(nome){
  const chave = String(nome||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
  if(!chave) return null;
  const partes = chave.split(/\s+/).filter(Boolean);
  if(!partes.length) return null;
  const primeiro = partes[0];
  const emF = Object.prototype.hasOwnProperty.call(F, primeiro);
  const emM = Object.prototype.hasOwnProperty.call(M, primeiro);
  let sexo=null, faixa=null, prob=null;
  if(emF&&!emM){sexo='feminino';faixa=F[primeiro][0];prob=F[primeiro][1];}
  else if(emM&&!emF){sexo='masculino';faixa=M[primeiro][0];prob=M[primeiro][1];}
  else if(emF&&emM){sexo=null;faixa=null;prob=0.5;}
  else return null;
  let nacionalidade=null;
  for(const [pais,lista] of Object.entries(NACIONALIDADES)){
    if(lista.includes(primeiro)){nacionalidade=pais;break;}
  }
  // Prenome sem entrada propria: tenta pelo sobrenome modificado.
  if(!nacionalidade&&partes.length>1){
    const sobrenome=partes[partes.length-1];
    const mod=sobrenome.match(SOBRENOME_E);
    if(mod){
      const base=mod[1];
      if(Object.prototype.hasOwnProperty.call(F,base)||Object.prototype.hasOwnProperty.call(M,base)){
        nacionalidade=/ez|es$/.test(sobrenome)?'es':/sen|sson|son$/.test(sobrenome)?'al':null;
      }
    }
  }
  return {primeiroNome:primeiro,sexoProvavel:sexo,faixaEtariaProvavel:faixa,probabilidade:prob,nacionalidadeProvavel:nacionalidade};
}
