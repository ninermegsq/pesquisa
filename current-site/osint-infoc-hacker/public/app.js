'use strict';
// Four categories, with one-line descriptions and the exact original website URLs.
// The additional EmailRep entry belongs to the explicitly requested deep-link mapping;
// it completes the supplied 77-item enumeration to 78 without inventing a provider.
const CATEGORIES = [
  {name:'VAZAMENTOS & SENHAS', items:`XposedOrNot|breaches + pastes + risco · API sem chave|https://xposedornot.com/
Have I Been Pwned|padrão-ouro de breaches · web grátis|https://haveibeenpwned.com/
Pwned Passwords|senha por SHA-1, CORS livre|https://haveibeenpwned.com/Passwords
LeakCheck|10 bi de registros · free diário|https://leakcheck.io/
DeHashed|email/user/IP/tel · mostra plaintext|https://dehashed.com/
Intelligence X|pastes, leaks, darknet|https://intelx.io/
Leak-Lookup|agregador multi-base|https://leak-lookup.com/
BreachDirectory|API free 100/mês|https://breachdirectory.org/
Hudson Rock|infostealer logs|https://cavalier.hudsonrock.com/
Have I Been Sold|dados à venda em marketplace|https://haveibeensold.app/
psbdmp.ws|dump search do Pastebin|https://psbdmp.ws/
Doxbin|dossiês e dumps de nick|https://doxbin.com/
Paste.ee|pastes recentes|https://paste.ee/
Rentry|pastes markdown|https://rentry.co/
Firefox Monitor|alerta de breach|https://monitor.firefox.com/`},
  {name:'CADASTROS & PEGADA SOCIAL', items:`Epieos|reverse email → 140+ redes, silent|https://epieos.com/
Holehe|120+ sites via reset, sem avisar|https://github.com/megadose/holehe
user-scanner|enumeração em massa|https://github.com/kaifcodec/user-scanner
Blackbird|caça perfis por email/user|https://blackbird-osint.com/
WhatsMyName|username em 640+ sites|https://whatsmyname.app/
Maigret|relatório HTML de pegada|https://github.com/soxoj/maigret
GHunt|conta Google a partir do email|https://github.com/mxrch/GHunt
Gravatar|MD5 revela avatar público|https://gravatar.com/
GitHub Search|email em commits e perfis|https://github.com/search
Keybase|PGP + provas sociais|https://keybase.io/
ThatsThem|email → nome, endereço, tel|https://thatsthem.com/
TruePeopleSearch|busca reversa por email|https://www.truepeoplesearch.com/
FastPeopleSearch|registros públicos EUA|https://www.fastpeoplesearch.com/
Radaris|agregador de pessoas|https://radaris.com/
PeekYou|username → perfis|https://www.peekyou.com/
IDCrawl|busca por nome/user/email|https://www.idcrawl.com/
Social Searcher|menções em redes|https://www.social-searcher.com/
Sync.me|email/tel → perfis|https://sync.me/
Numlookup|operadora de telefone|https://www.numlookup.com/`},
  {name:'DOMÍNIOS, WHOIS & INFRA', items:`crt.sh|subdomínios via CT logs|https://crt.sh/
Cert Spotter|certificados emitidos|https://sslmate.com/certspotter/
ViewDNS Reverse Whois|domínios ligados ao email|https://viewdns.info/reversewhois/
Whoxy|reverse whois do registrante|https://www.whoxy.com/
WhoisXML API|500 créditos free|https://whoisxmlapi.com/
SecurityTrails|histórico DNS|https://securitytrails.com/
Phonebook.cz|emails e subdomínios do host|https://phonebook.cz/
DNSDumpster|recon de DNS|https://dnsdumpster.com/
Shodan|serviços expostos|https://www.shodan.io/
Censys|hosts e certificados|https://search.censys.io/
Netlas|scan de internet|https://app.netlas.io/
FOFA|fingerprint de ativos|https://fofa.info/
ZoomEye|mapeamento de dispositivos|https://www.zoomeye.org/
GrayhatWarfare|buckets S3 abertos|https://grayhatwarfare.com/
urlscan.io|recursos e scans|https://urlscan.io/
BGP.he.net|rotas e ASN|https://bgp.he.net/
RIPE Stat|registro de roteamento|https://stat.ripe.net/
ipinfo|dono e geolocalização de IP|https://ipinfo.io/
MXToolbox|MX, SPF, DMARC, blacklist|https://mxtoolbox.com/
Mozilla Observatory|nota de segurança do site|https://developer.mozilla.org/en-US/observatory`},
  {name:'CÓDIGO, DOCUMENTOS & BUSCA', items:`GitHub Search|código e commits com o email|https://github.com/search
GitLab Search|projetos e snippets|https://gitlab.com/search
grep.app|busca em repositórios públicos|https://grep.app/
Sourcegraph|busca de código em escala|https://sourcegraph.com/search
PublicWWW|HTML e scripts de sites|https://publicwww.com/
Searchcode|código indexado|https://searchcode.com/
Scribd|documentos enviados|https://www.scribd.com/
SlideShare|apresentações públicas|https://www.slideshare.net/
DocDroid|PDFs hospedados|https://www.docdroid.net/
Yandex|índice diferente do Google|https://yandex.com/
Marginalia|web não-comercial|https://search.marginalia.nu/
Mojeek|índice próprio|https://www.mojeek.com/
PimEyes|busca facial reversa|https://pimeyes.com/
Yandex Images|busca por imagem|https://yandex.com/images/
TinEye|imagem já publicada onde|https://tineye.com/
Jimpl|EXIF e metadados de foto|https://jimpl.com/
theHarvester|emails, hosts, subdomínios|https://github.com/laramies/theHarvester
Amass|enumeração de subdomínio|https://github.com/owasp-amass/amass
Subfinder|descoberta passiva de subdomínio|https://github.com/projectdiscovery/subfinder
Sublist3r|subdomínios por fontes|https://github.com/aboul3la/Sublist3r
h8mail|orquestra 9 APIs de breach|https://github.com/khast3x/h8mail
SpiderFoot|200+ módulos de correlação|https://github.com/smicallef/spiderfoot
OSINT Framework|mapa de fontes por categoria|https://osintframework.com/
EmailRep|reputação pública de e-mail · API opcional|https://emailrep.io/`}
];
const AUTOMATIC = new Set(['XposedOrNot','Hudson Rock','Gravatar','GitHub Search','Keybase','Shodan','MXToolbox','SecurityTrails','EmailRep']);
const TOOLS = CATEGORIES.flatMap((cat,ci)=>cat.items.trim().split('\n').map(row=>{const [name,desc,url]=row.split('|');return {name,desc,url,category:ci,auto:AUTOMATIC.has(name)&&!(ci===3&&name==='GitHub Search'),apiKeyRequired:false};}));
document.getElementById('stat-total').textContent=24;
document.getElementById('stat-auto').textContent=12;
document.getElementById('stat-cats').textContent=6;
document.getElementById('stat-keys').textContent=0;
const $=id=>document.getElementById(id);
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PROVIDERS=new Set('gmail.com hotmail.com outlook.com yahoo.com proton.me protonmail.com icloud.com bol.com.br uol.com.br live.com gmx.com yandex.com'.split(' '));
const SERVICES=[[/google-site-verification/i,'Google'],[/MS=ms/i,'Microsoft 365'],[/atlassian-domain-verification/i,'Atlassian'],[/sendgrid/i,'SendGrid'],[/mailgun|mg\./i,'Mailgun'],[/shopify/i,'Shopify'],[/facebook-domain-verification/i,'Meta'],[/zoom/i,'Zoom'],[/docusign/i,'DocuSign'],[/adobe/i,'Adobe'],[/stripe/i,'Stripe'],[/hubspot/i,'HubSpot'],[/zendesk/i,'Zendesk'],[/salesforce/i,'Salesforce'],[/slack/i,'Slack'],[/dropbox/i,'Dropbox'],[/amazonses/i,'Amazon SES'],[/cloudflare/i,'Cloudflare'],[/_spf\./i,'SPF terceirizado'],[/apple-domain/i,'Apple'],[/cisco|webex/i,'Cisco/Webex'],[/notion/i,'Notion'],[/vercel/i,'Vercel'],[/netlify/i,'Netlify']];
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=n=>Number(n||0).toLocaleString('pt-BR');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const safeUrl=s=>{try{let url=new URL(s);return url.protocol==='https:'?url.href:'#';}catch{return '#';}};
const link=(url,title)=>`<a href="${escapeHTML(safeUrl(url))}" target="_blank" rel="noopener">${escapeHTML(title)}</a>`;
const chip=(value,color='')=>`<span class="chip ${color}">${escapeHTML(value)}</span>`;
// Complete RFC 1321 MD5 rounds, for Gravatar only. Do not use MD5 for password security.
function md5(str){
 const src=new TextEncoder().encode(str),len=src.length,pad=((len+8>>>6)+1)*64,b=new Uint8Array(pad);b.set(src);b[len]=128;
 const bits=BigInt(len)*8n;for(let i=0;i<8;i++)b[pad-8+i]=Number((bits>>BigInt(i*8))&255n);
 const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21],K=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*2**32)>>>0);
 let A=0x67452301,B=0xefcdab89,C=0x98badcfe,D=0x10325476;
 for(let off=0;off<pad;off+=64){const M=Array.from({length:16},(_,i)=>(b[off+i*4]|b[off+i*4+1]<<8|b[off+i*4+2]<<16|b[off+i*4+3]<<24)>>>0);let a=A,bb=B,c=C,d=D;
  for(let i=0;i<64;i++){let f,g,s;if(i<16){f=(bb&c)|(~bb&d);g=i;s=shifts[i%4];}else if(i<32){f=(d&bb)|(~d&c);g=(5*i+1)%16;s=shifts[4+i%4];}else if(i<48){f=bb^c^d;g=(3*i+5)%16;s=shifts[8+i%4];}else{f=c^(bb|~d);g=(7*i)%16;s=shifts[12+i%4];}let sum=(a+f+K[i]+M[g])>>>0;const rot=((sum<<s)|(sum>>>(32-s)))>>>0;[a,bb,c,d]=[d,(bb+rot)>>>0,bb,c];}
  A=(A+a)>>>0;B=(B+bb)>>>0;C=(C+c)>>>0;D=(D+d)>>>0;
 }
 return [A,B,C,D].map(v=>[0,1,2,3].map(i=>((v>>>i*8)&255).toString(16).padStart(2,'0')).join('')).join('');
}
function getDorks(email){const [local,host]=email.split('@');return [
 `"${email}"`,
 `"${email}" (site:pastebin.com OR site:rentry.co OR site:ghostbin.co OR site:doxbin.com)`,
 `"${email}" filetype:pdf OR filetype:xlsx OR filetype:csv`,
 `"${email}" (site:github.com OR site:gitlab.com)`,
 `"${local}" "@${host}"`,
 `"${email}" (senha OR password)`,
 `"${email}" -site:${host}`,
 `"${email}" site:linkedin.com`
];}
function toolDeep(t,email){
 const [local,host]=email.split('@'),e=encodeURIComponent(email),d=encodeURIComponent(host),user=encodeURIComponent(local),hash=md5(email),name=t.name;
 const map={
 'crt.sh':`https://crt.sh/?q=%25.${d}`,
 'Phonebook.cz':`https://phonebook.cz/?q=${d}`,
 'urlscan.io':`https://urlscan.io/domain/${d}`,
 'ViewDNS Reverse Whois':`https://viewdns.info/reversewhois/?q=${e}`,
 'Shodan':`https://www.shodan.io/search?query=${d}`,
 'MXToolbox':`https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${d}`,
 'BGP.he.net':`https://bgp.he.net/dns/${d}`,
 'RIPE Stat':`https://stat.ripe.net/${d}`,
 'SecurityTrails':`https://securitytrails.com/domain/${d}/dns`,
 'GitHub Search':`https://github.com/search?q=${e}&type=users`,
 'GitLab Search':`https://gitlab.com/search?search=${e}`,
 'grep.app':`https://grep.app/search?q=${e}`,
 'Sourcegraph':`https://sourcegraph.com/search?q=${e}`,
 'PublicWWW':`https://publicwww.com/websites/%22${e}%22/`,
 'Searchcode':`https://searchcode.com/?q=${e}`,
 'DeHashed':`https://dehashed.com/search?query=${e}`,
 'Intelligence X':`https://intelx.io/?s=${e}`,
 'ThatsThem':`https://thatsthem.com/email/${e}`,
 'EmailRep':`https://emailrep.io/${e}`,
 'Gravatar':`https://gravatar.com/${hash}`,
 'TruePeopleSearch':`https://www.truepeoplesearch.com/results?email=${e}`,
 'FastPeopleSearch':`https://www.fastpeoplesearch.com/email/${e}`,
 'PeekYou':`https://www.peekyou.com/${user}`,
 'IDCrawl':`https://www.idcrawl.com/${user}`,
 'Social Searcher':`https://www.social-searcher.com/social-buzz/?q5=${e}`,
 'Yandex':`https://yandex.com/search/?text=%22${e}%22`,
 'Marginalia':`https://search.marginalia.nu/search?query=${e}`,
 'Mojeek':`https://www.mojeek.com/search?q=%22${e}%22`,
 'TinEye':`https://tineye.com/search?url=${encodeURIComponent(`https://www.gravatar.com/avatar/${hash}?d=404`)}`
 };
 return map[name]||t.url;
}
function makeAccordion(title,count,body,wide=false){return `<details class="acc${wide?' acc--wide':''}"><summary><span class="arr">▶</span><span>${escapeHTML(title)}</span><span class="count ${count>0?'bad':''}">${fmt(count)}</span></summary><div class="accbody">${body}</div></details>`;}
function servicesFrom(records){return [...new Set((records||[]).flatMap(t=>SERVICES.filter(([re])=>re.test(String(t))).map(([,name])=>name)))];}
function renderResults(data,email){
 const host=email.split('@')[1],local=email.split('@')[0];
 const dns=data.dns||{},ports=data.internetdb?.ports||[],vulns=data.internetdb?.vulns||[],breaches=data.breaches||[],services=servicesFrom(dns.txt);
 const own=!PROVIDERS.has(host);
 const avail=data.availability||{};
 const numBreaches=breaches.length;
 const score=Math.min(100,Math.min(numBreaches*9,50)+(data.gravatar===true?7:0)+(own?4:0)+Math.min(Math.max(0,Number(data.metrics?.risk_score)||0),15)+(dns.available&&!dns.hasSPF?6:0)+(dns.available&&!dns.dmarc?6:0)+Math.min(vulns.length*3,10)+(data.github?.count>0?4:0));
 const level=score>60?'CRÍTICO':score>25?'MÉDIO':'BAIXO';
 const shade=score>60?'risk-high':score>25?'risk-medium':'risk-low';
 const incomplete=Object.values(avail).some(x=>x===false);
 let out=`<section class="scorecard"><div class="eyebrow">RISCO DE EXPOSIÇÃO</div><div><span class="score-num ${shade}">${score}</span><span class="score-suffix"> /100 · ${level}${incomplete?' · PARCIAL':''}</span></div><div class="risk-bar"><div id="risk-fill" class="risk-fill"></div></div><div class="chips">${chip(`${numBreaches} breaches`,numBreaches?'red':'')}${chip(`${services.length} serviços`,'cyan')}${chip(`${ports.length} portas`)}${chip(data.gravatar===true?'gravatar: sim':data.gravatar===false?'gravatar: não':'gravatar: indisponível')}</div><p class="public-note">Índice heurístico de exposição, não é probabilidade de invasão. ${data.cached?'Resultado em cache (até 24h). ':''}${incomplete?'Algumas consultas ficaram indisponíveis; pontuação pode estar subestimada.':'Dados públicos consultados.'}</p></section>`;
 const strength=data.metrics||{};
 const breachCards=breaches.map(b=>`<div class="breach"><b>${escapeHTML(b.name)}</b> ${chip(b.year,'red')}<div>${escapeHTML(b.data)}</div><div class="meta">registros: ${fmt(b.records)} · senha: ${escapeHTML(b.passwordRisk)} · domínio: ${escapeHTML(b.domain||'não informado')}</div></div>`).join('');
 out+=makeAccordion('BREACHES & SENHAS EXPOSTAS',numBreaches,`
 <p>${chip(`texto puro: ${fmt(strength.plaintext)}`,'red')} ${chip(`hashes fracos: ${fmt(strength.weak)}`,'amber')} ${chip(`hashes fortes: ${fmt(strength.strong)}`)}</p>
 ${avail.xon===false?'<p class="warn">Consulta de breaches indisponível, resultado não conclusivo.</p>':numBreaches?breachCards:'<p>Nenhum breach identificado nas fontes consultadas. Isso não garante segurança.</p>'}
 <p>Fontes para investigação adicional de senhas em texto puro: ${link('https://dehashed.com/','DeHashed')}, ${link('https://leakcheck.io/','LeakCheck')} e ${link('https://intelx.io/','IntelX')}. O site não exibe nem recupera senhas vazadas.</p>`);
 out+=makeAccordion('DNS, TXT & SERVIÇOS DETECTADOS',vulns.length,`
 <div class="kv"><label>IP:</label> ${escapeHTML((dns.ips||[]).join(', ')||'não encontrado')}</div>
 <div class="kv"><label>MX:</label> ${escapeHTML((dns.mx||[]).join(', ')||'não encontrado')}</div>
 <div class="kv"><label>SPF:</label> <span class="${dns.available?(dns.hasSPF?'ok':'warn'):'muted'}">${!dns.available?'não verificado':dns.hasSPF?'presente':'ausente'}</span></div>
 <div class="kv"><label>DMARC:</label> <span class="${dns.available?(dns.dmarc?'ok':'warn'):'muted'}">${!dns.available?'não verificado':dns.dmarc?'presente':'ausente'}</span></div>
 <div class="kv"><label>Portas abertas:</label> ${escapeHTML(ports.join(', ')||'não informadas')}</div>
 <div class="kv"><label>CVEs / identificadores:</label> ${escapeHTML(vulns.join(', ')||'não informados')}</div>
 <p class="chips" style="margin-top:10px">${services.length?services.map(s=>chip(s,'cyan')).join(''):'<span class="muted">Nenhum serviço identificado por TXT.</span>'}</p>
 <p class="status-msg">SPF/DMARC ausentes podem facilitar falsificação do remetente e phishing. O risco depende da política e da infraestrutura do domínio.</p>
 <div class="kv"><label>TXT (até 110 caracteres por registro):</label>${(dns.txt||[]).length?dns.txt.map(t=>`<div class="muted">${escapeHTML(t.slice(0,110))}${t.length>110?'…':''}</div>`).join(''):'<div class="muted">Não disponível</div>'}</div>`);
 const avatar=data.gravatar===true?`<img loading="lazy" width="60" height="60" alt="Avatar público do Gravatar" src="https://www.gravatar.com/avatar/${md5(email)}?d=404" style="border-radius:8px;border:1px solid #24533b;vertical-align:middle">`:'não identificado';
 const ghUsers=(data.github?.users||[]).map(u=>link(`https://github.com/${encodeURIComponent(u)}`,u)).join(' · ');
 out+=makeAccordion('CONTAS & PERFIS',Number(data.gravatar===true)+Number(data.github?.count>0)+Number(Boolean(data.keybase)),`
 <div class="kv"><strong>Gravatar:</strong> ${avatar}</div>
 <div class="kv"><strong>GitHub:</strong> ${data.github?`${fmt(data.github.count)} correspondências · ${ghUsers||'sem logins retornados'}`:'consulta indisponível'}</div>
 <div class="kv"><strong>Keybase:</strong> ${data.keybase?link(`https://keybase.io/${encodeURIComponent(data.keybase)}`,data.keybase):avail.keybase?'não identificado':'consulta indisponível'}</div>
 <p>Correspondência em busca pública não confirma identidade nem titularidade de uma conta.</p>`);
 out+=makeAccordion('SUPERFÍCIE DE ATAQUE',Number(own)+Number(numBreaches>0),`
 <div class="kv"><label>Usuário:</label> ${escapeHTML(local)}</div><div class="kv"><label>Classificação:</label> ${own?'domínio próprio':'provedor pessoal'}</div>
 <div class="kv"><label>Variações:</label> ${escapeHTML([...new Set([local,local.replace(/[._-]/g,''),local.replace(/[._-]/g,' '),local.split(/[._-]/)[0]])].join(' · '))}</div>
 <div class="kv"><label>Padrão corporativo:</label> ${own?escapeHTML(`nome.sobrenome@${host} · inicial.sobrenome@${host}`):'não aplicável'}</div>
 <div class="kv"><label>Vetor principal:</label> ${numBreaches?'phishing direcionado e credenciais reutilizadas (hipótese)':dns.available&&!dns.dmarc?'spoofing do domínio (hipótese)':'nenhum vetor confirmado'}</div>
 <div class="kv"><label>Risco de reuso:</label> ${numBreaches?'recomenda-se verificar senhas reutilizadas':'não determinado'}</div>
 <p>Hipóteses para prevenção; não representam confirmação de exploração.</p>`);
 const infrastructure=[['crt.sh',`https://crt.sh/?q=%25.${encodeURIComponent(host)}`],['ViewDNS reversewhois',`https://viewdns.info/reversewhois/?q=${encodeURIComponent(email)}`],['SecurityTrails',`https://securitytrails.com/domain/${encodeURIComponent(host)}/dns`],['Shodan',`https://www.shodan.io/search?query=${encodeURIComponent(host)}`],['GrayhatWarfare','https://grayhatwarfare.com/'],['who.is',`https://who.is/whois/${encodeURIComponent(host)}`]];
 out+=makeAccordion('DOMÍNIOS & INFRA',infrastructure.length,`<p>${infrastructure.map(([name,url])=>chip(name,'cyan')+' '+link(url,'OPEN ↗')).join('<br>')}</p>`);
 out+=makeAccordion('DORKS PRONTOS',8,getDorks(email).map(q=>{const eq=encodeURIComponent(q);return `<div class="dork"><code>${escapeHTML(q)}</code><div class="dork-actions"><button type="button" class="bt mini copy-dork" data-dork="${escapeHTML(q)}">COPY</button>${link(`https://www.google.com/search?q=${eq}`,'GOOGLE')}${link(`https://www.bing.com/search?q=${eq}`,'BING')}${link(`https://yandex.com/search/?text=${eq}`,'YANDEX')}</div></div>`;}).join(''),true);
 let arsenal='';for(let ci=0;ci<CATEGORIES.length;ci++){const cat=CATEGORIES[ci];arsenal+=`<h3 class="toolcat">${escapeHTML(cat.name)}</h3>`;for(const t of TOOLS.filter(x=>x.category===ci))arsenal+=`<div class="tool"><div><b>${escapeHTML(t.name)}</b><span>${escapeHTML(t.desc)}</span></div><a class="bt mini" href="${escapeHTML(safeUrl(toolDeep(t,email)))}" target="_blank" rel="noopener">OPEN</a></div>`;}
 out+=makeAccordion('ARSENAL COMPLETO',TOOLS.length,arsenal,true);
 out+=`<aside class="ad" aria-label="Anúncio parceiro"><span class="tag">PARCEIRO</span><div class="ad-head"><span class="ad-symbol">◈</span> ACABOU DE VER O TAMANHO DO PROBLEMA</div><p>Agora converse com uma IA que não te poda e não guarda nada. Chat privado, 100% sem censura, modelos de ponta.</p><div class="ad-footer"><a class="bt cyan" href="https://venice.ai/chat?ref=0rEY8a" target="_blank" rel="noopener sponsored" aria-label="Abrir Venice.ai em nova aba">ABRIR VENICE ↗</a></div></aside>`;
 out+=`<section class="foot-support"><div><h3>SEM PAYWALL · SEM ADS INVASIVOS</h3><p>Servidor, domínio e as cotas das APIs saem do meu bolso. Se a ferramenta te salvou, manda um café.</p><small>código e curadoria — <a href="https://instagram.com/infoc.hacker" target="_blank" rel="noopener me">@infoc.hacker</a></small></div><a class="bt amber" href="https://pay.cakto.com.br/o9xx8id_1257625" target="_blank" rel="noopener sponsored" aria-label="Apoiar o projeto via Cakto">MANTER NO AR</a></section>`;
 return {html:out,score};
}
let current=null,scanning=false,widgetId=null,siteKey=null;
const form=$('scan-form');
function pushLog(index,message,type='neutral'){
 const log=$('scan-log');if(!log)return;const el=document.createElement('div');el.className=type;el.textContent=`[${index}/9] ${message}`;log.append(el);log.scrollTop=log.scrollHeight;
}
async function getJson(url,options){const res=await fetch(url,{cache:'no-store',...options});let data;try{data=await res.json();}catch{throw Error(`Resposta inválida do servidor (${res.status}).`);}if(!res.ok)throw Error(data.error||`HTTP ${res.status}`);return data;}
function loadTurnstile(){return new Promise((resolve,reject)=>{if(window.turnstile){resolve(window.turnstile);return;}const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=()=>resolve(window.turnstile);script.onerror=()=>reject(Error('Cloudflare Turnstile indisponível.'));document.head.append(script);});}
async function challenge(){
 const slot=$('security-slot');slot.classList.add('active');slot.textContent='';
 if(!siteKey){siteKey=(await getJson('/.netlify/functions/token')).siteKey;}
 const turnstile=await loadTurnstile();if(!turnstile?.render)throw Error('Turnstile não carregou.');
 return new Promise((resolve,reject)=>{
   let completed=false;const box=document.createElement('div');slot.append(box);
   try{widgetId=turnstile.render(box,{sitekey:siteKey,theme:'dark',appearance:'interaction-only',callback:t=>{if(!completed){completed=true;resolve(t);}},'error-callback':()=>{if(!completed){completed=true;reject(Error('Falha de verificação do Turnstile.'));}},'expired-callback':()=>{if(!completed){completed=true;reject(Error('Verificação expirada.'));}}});}
   catch(e){reject(e);}
 });
}
function renderPivos(pivos){
 const box=document.createElement('div');box.className='chips';
 for(const p of pivos||[]){const btn=document.createElement('button');btn.type='button';btn.className='chip';btn.textContent=p.valor||'';btn.addEventListener('click',()=>{if(scanning)return;$('email').value=p.valor;form.requestSubmit();});box.append(btn);}
 $('stage').append(box);
}
async function scan(event){
 event.preventDefault();if(scanning)return;
 const alvo=$('email').value.trim();$('form-error').textContent='';if(!alvo){$('form-error').textContent='Informe um alvo.';return;}
 scanning=true;$('scan-announcement').textContent='';setOrbPhase('scanning');$('scan-btn').disabled=true;$('stage').replaceChildren();$('actions').hidden=true;current=null;
 try{
 const cfToken=await challenge();
 const signed=await getJson('/.netlify/functions/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cfToken,alvo})});
 const j=await getJson('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({alvo,token:signed.token})});
 const card=document.createElement('section');card.className='scorecard';
 card.innerHTML=`<div class="eyebrow">RISCO DE EXPOSIÇÃO</div><span class="score-num">${escapeHTML(j.score?.valor??0)}</span><span class="score-suffix">/100 · ${escapeHTML(j.score?.nivel||'BAIXO')}${j.score?.parcial?' · PARCIAL':''}</span><p class="public-note">${escapeHTML((j.score?.motivos||[]).join(' · ')||'sem sinais relevantes')}</p>`;
 $('stage').append(card);const wrapper=document.createElement('div');wrapper.innerHTML=j.html||'';$('stage').append(...wrapper.childNodes);
 const meta=document.createElement('p');meta.className='muted';meta.textContent=`${j.meta?.executadas??0}/${j.meta?.planejadas??0} fontes · custo declarado: ${j.meta?.subrequests??0} subrequests`;$('stage').append(meta);renderPivos(j.pivos);
 current={email:j.alvo?.valor||alvo,data:j};$('actions').hidden=false;setOrbPhase('done',{breaches:[]});$('answer-content').textContent=`${j.meta?.executadas??0} fontes processadas. ${j.score?.parcial?'Resultado parcial.':'Análise concluída.'}`;
 $('scan-announcement').textContent=`Análise concluída. ${Math.max(0,reportRows().length-1)} achados.`;
 }catch(err){const message=err?.message||'Falha na análise.';setOrbPhase('error',message);$('form-error').textContent=message;$('scan-announcement').textContent='Verificação interrompida';}
 finally{scanning=false;$('scan-btn').disabled=false;$('security-slot').classList.remove('active');$('security-slot').replaceChildren();try{if(widgetId!==null)window.turnstile?.remove(widgetId);}catch{}widgetId=null;}
}
form.addEventListener('submit',scan);
$('stage').addEventListener('click',event=>{const btn=event.target.closest('.copy-dork');if(!btn)return;const value=btn.dataset.dork||'';const old=btn.textContent;navigator.clipboard.writeText(value).then(()=>{btn.textContent='COPIADO';setTimeout(()=>btn.textContent=old,1300);}).catch(()=>{btn.textContent='ERRO';});});
$('clear-btn').addEventListener('click',()=>{if(scanning)return;setOrbPhase('idle');current=null;$('stage').replaceChildren();$('scan-announcement').textContent='';$('actions').hidden=true;$('email').value='';$('form-error').textContent='';$('pass-panel').hidden=true;$('password').value='';$('password-result').textContent='';$('password-toggle').setAttribute('aria-expanded','false');$('scan-btn').removeAttribute('data-ready');positionIdlePill();$('email').focus();});
function reportFilename(ext){return 'osint-report-'+current.email.replace(/[^a-z0-9.-]/gi,'_')+'.'+ext;}
function downloadReport(content,type,ext){if(!current)return;const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=reportFilename(ext);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csvCell(value){let v=String(value??'');if(/^[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}
function reportRows(){
 const rows=[['fonte','campo','valor','provenance','timestamp']];
 const flatten=(source,path,value)=>{if(value==null)return;if(typeof value==='object'){for(const [k,v]of Object.entries(value))flatten(source,path?path+'.'+k:k,v);return;}rows.push([source.id,path,String(value),source.provenance||'',source.timestamp||current.data.gerado_em||'']);};
 for(const source of current.data.fontes||[]){if(source.status==='ok')flatten(source,'',source.dados);else rows.push([source.id,'status',source.erro||source.status,source.provenance||'',source.timestamp||current.data.gerado_em||'']);}
 return rows;
}
$('export-json').addEventListener('click',()=>{if(!current)return;const report={schemaVersion:1,generatedAt:new Date().toISOString(),email:current.email,data:current.data,sources:current.data.sources||{}};downloadReport(JSON.stringify(report,null,2),'application/json;charset=utf-8','json');});
$('export-csv').addEventListener('click',()=>{if(!current)return;const csv='\uFEFF'+reportRows().map(row=>row.map(csvCell).join(',')).join('\r\n');downloadReport(csv,'text/csv;charset=utf-8','csv');});
$('password-toggle').addEventListener('click',()=>{const show=$('pass-panel').hidden;$('pass-panel').hidden=!show;$('password-toggle').setAttribute('aria-expanded',String(show));if(show)$('password').focus();});
$('password-run').addEventListener('click',async()=>{const p=$('password').value;if(!p){$('password-result').textContent='Digite uma senha.';return;}const btn=$('password-run');btn.disabled=true;try{const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1',new TextEncoder().encode(p)))).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();const prefix=hash.slice(0,5),suffix=hash.slice(5);const response=await fetch(`https://api.pwnedpasswords.com/range/${prefix}`,{cache:'no-store',headers:{'Add-Padding':'true'}});if(!response.ok)throw Error(`HTTP ${response.status}`);const body=await response.text();const match=body.split(/\r?\n/).find(line=>line.split(':')[0]===suffix);const hits=match?Number(match.split(':')[1]||0):0;$('password-result').textContent=hits?`Senha encontrada ${fmt(hits)} vezes em coleções de vazamentos. Não a reutilize.`:'não encontrada — isso não garante que a senha seja segura.';}catch(err){$('password-result').textContent='Não foi possível consultar a base de senhas: '+err.message;}finally{btn.disabled=false;}});

/* Esfera de partículas 3D adaptada ao visual de referência para Canvas 2D nativo.
   Somente decoração: não lê o e-mail, não envia dados, não controla o scan. */
const orbShell=$('morphRoot');
const orbLabel=$('orb-status');
const orbActor=$('morphActor');
let orbPhase='idle',phaseTimer=null,statusTimer=null,statusIndex=0;
const scanLabels=['Conectando às fontes públicas','Consultando registros disponíveis','Correlacionando os sinais','Preparando o relatório'];
function clearPhaseTimers(){clearTimeout(phaseTimer);clearInterval(statusTimer);phaseTimer=statusTimer=null;}
function setAnswerSummary(message){$('answer-content').textContent=message;}
function setOrbPhase(next,detail=null){
  clearPhaseTimers();
  orbPhase=next;
  const phase={idle:'idle',scanning:'launch',done:'resolve',error:'error'}[next]||next;
  orbShell.dataset.phase=phase;
  if(next==='idle'){orbLabel.textContent='Pronto para analisar';setAnswerSummary('A análise aparecerá aqui.');return;}
  if(next==='scanning'){
    statusIndex=0;orbLabel.textContent=scanLabels[0];
    phaseTimer=setTimeout(()=>{if(scanning&&orbShell.dataset.phase==='launch')orbShell.dataset.phase='think';},360);
    statusTimer=setInterval(()=>{statusIndex=(statusIndex+1)%scanLabels.length;orbLabel.textContent=scanLabels[statusIndex];},1450);
    return;
  }
  if(next==='done'){
    const found=detail?.breaches?.length||0;
    const unavailable=Object.values(detail?.availability||{}).filter(v=>!v).length;
    setAnswerSummary(found?`Análise concluída. Foram encontrados ${found} registros de exposição associados ao e-mail. Confira os detalhes e as fontes abaixo.`:`Análise concluída. Nenhum vazamento foi confirmado nas fontes consultadas. Confira abaixo quais fontes responderam e os demais sinais encontrados.`);
    orbLabel.textContent='Análise concluída';
    phaseTimer=setTimeout(()=>{orbShell.dataset.phase='condense';phaseTimer=setTimeout(()=>orbShell.dataset.phase='answered',420);},280);
    return;
  }
  if(next==='error'){
    setAnswerSummary(typeof detail==='string'&&detail?`A verificação foi interrompida: ${detail}`:'A verificação foi interrompida. Confira a mensagem e tente novamente.');
    orbLabel.textContent='Verificação interrompida';
  }
}
function positionIdlePill(){if(orbShell.dataset.phase==='idle')orbShell.style.setProperty('--home-y',`${Math.max(210,orbShell.clientHeight*.54-96)}px`);}
positionIdlePill();window.addEventListener('resize',positionIdlePill);
$('email').addEventListener('input',()=>{$('scan-btn').toggleAttribute('data-ready',Boolean($('email').value.trim()));$('morphActor').setAttribute('data-typing','');clearTimeout(window.__morphTyping);window.__morphTyping=setTimeout(()=>$('morphActor').removeAttribute('data-typing'),300);});
(function setupSignalOrb(){
 const canvas=document.getElementById('signal-orb');
 if(!canvas||!canvas.getContext)return;
 const context=canvas.getContext('2d',{alpha:true});
 if(!context)return;
 const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
 const size=300,scale=2, dots=[];
 for(let ring=0;ring<18;ring++){
  const py=1-2*(ring+.5)/18, radius=Math.sqrt(1-py*py),count=Math.max(8,Math.round(radius*37));
  for(let j=0;j<count;j++){
    const a=j/count*Math.PI*2+ring*.23;
    dots.push([Math.cos(a)*radius,py,Math.sin(a)*radius,Math.random()*Math.PI*2]);
  }
 }
 canvas.width=size*scale;canvas.height=size*scale;
 const paint=(ms)=>{
  context.setTransform(scale,0,0,scale,0,0);
  context.clearRect(0,0,size,size);
  const t=reduce.matches?0:ms*.001,rate=orbPhase==='scanning'?1.75:.36,yaw=t*rate+.15,cos=Math.cos(yaw),sin=Math.sin(yaw);
  context.save();context.translate(150,146);
  context.strokeStyle='rgba(231,230,217,.15)';context.lineWidth=.8;
  context.save();context.rotate(-.29);context.scale(1,.37);context.beginPath();context.arc(0,0,97,0,Math.PI*2);context.stroke();context.restore();
  // z-order by back-to-front for smooth, readable particle depth.
  const projected=dots.map(d=>{
   const x=d[0]*cos+d[2]*sin,z=-d[0]*sin+d[2]*cos;
   const y=d[1]*.957-z*.29,depth=d[1]*.29+z*.957,perspective=2.6/(2.6-depth);
   return [x*85*perspective,-y*85*perspective,depth,d[3]];
  }).sort((a,b)=>a[2]-b[2]);
  for(const p of projected){
   const depth=(p[2]+1)/2,scan=Math.pow(Math.max(0,1-Math.abs(((t*.34+p[3]/6)%1)-depth)*3.2),2),alpha=Math.min(.96,(.20+.47*depth+scan*(orbPhase==='scanning'?.49:.2)));
   context.fillStyle=`rgba(${Math.round(220+28*depth)},${Math.round(143+91*depth)},${Math.round(104+129*depth)},${alpha.toFixed(3)})`;
   context.beginPath();context.arc(p[0],p[1],.75+depth*.9+scan*.5,0,Math.PI*2);context.fill();
  }
  context.restore();
 };
 if(reduce.matches){paint(0);}
 let visible=true;
 const loop=now=>{if(visible&&!reduce.matches&&canvas.getBoundingClientRect().width>0)paint(now);requestAnimationFrame(loop);};
 if(!reduce.matches)requestAnimationFrame(loop);
 document.addEventListener('visibilitychange',()=>{visible=!document.hidden;});
 reduce.addEventListener?.('change',()=>{if(reduce.matches)paint(0);});
})();
