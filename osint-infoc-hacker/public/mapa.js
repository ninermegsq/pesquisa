/* Mapa de conexoes do scanner OSINT.
   Sem dependencias externas (o projeto nao tem bundler nem npm): o mapa e
   desenhado em SVG puro a partir das fontes que o ultimo scan consultou.
   Cada fonte vira um no; o arco ate o no mostra o caminho percorrido e a
   cor mostra o resultado: brasa (#e6a274) quando a fonte respondeu, vermelho
   (#f87171) quando falhou. A paleta e a mesma do site (creme sobre #050505)
   para nao abrir divergencia visual.

   Copia identica de current-site/osint-infoc-hacker/public/mapa.js.
   O pacote Netlify monta a lista de fontes consultadas a partir do contrato
   legado (availability) e entrega o mesmo objeto `fontes` para o mapa. */(function(){
// O estilo do mapa mora aqui (e nao no HTML) para que qualquer pagina que
// carregue este arquivo ja Tenha o desenho pronto: o Worker, a previa local
// e a variante Netlify. As regras repetem o que ja existe no index.html do
// site -- duplicar aqui e inofensivo (mesmos valores) e evita que a variante
// alternativa fique sem o mapa estilizado.
const ESTILO='.mapa-bloco{grid-column:1/-1;border:1px solid var(--border,rgba(231,230,217,.15));border-radius:10px;background:#0c0c0b;padding:16px 18px 14px;margin:0}.mapa-topo{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}.mapa-contagem{font:10px var(--font-mono,monospace);color:rgba(231,230,217,.5);letter-spacing:.06em}.mapa-contagem b{color:#e6a274;font-weight:600}.mapa-contagem .mapa-falhas-n{color:#f87171}.mapa-livro{position:relative}.mapa-svg{display:block;width:100%;height:auto;overflow:visible}.mapa-terra circle{fill:rgba(231,230,217,.13)}.mapa-arco{fill:none;stroke-width:1;stroke-linecap:round}.mapa-arco.ok{stroke:#e6a274;stroke-dasharray:3 6;animation:mapa-fluxo 3s linear infinite}.mapa-arco.falha{stroke:#f87171;stroke-dasharray:3 6;opacity:.9;animation:mapa-fluxo 2.2s linear infinite}.mapa-pacote{opacity:.9}@keyframes mapa-fluxo{to{stroke-dashoffset:-36}}.mapa-no{cursor:pointer;outline:none}.mapa-no:hover circle:nth-child(2),.mapa-no:focus circle:nth-child(2){r:4.4}.mapa-no:focus-visible circle:last-child{stroke:#e7e6d9;stroke-width:1.4}.mapa-tip{position:absolute;left:0;top:0;pointer-events:none;opacity:0;transform:translate(-50%,-118%);background:#0f0f0e;border:1px solid var(--border,rgba(231,230,217,.15));border-radius:8px;padding:8px 10px;font:10px/1.55 var(--font-mono,monospace);color:#e7e6d9;max-width:270px;box-shadow:0 18px 40px -18px #000;transition:opacity .16s;z-index:6}.mapa-tip.on{opacity:1}.mapa-tip b{display:block;letter-spacing:.08em;margin-bottom:2px}.mapa-tip-st.ok{color:#4ade80}.mapa-tip-st.falha{color:#f87171}.mapa-tip-erro{display:block;color:#f87171;margin-top:2px}.mapa-tip-dim{display:block;color:rgba(231,230,217,.5);margin-top:2px}.mapa-legenda{display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;font:9.5px var(--font-mono,monospace);letter-spacing:.07em;color:rgba(231,230,217,.48)}.mapa-legenda i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:0}.mapa-nota{margin:10px 0 0;font-size:9.5px;color:rgba(231,230,217,.38)}.mapa-fontes{margin-top:14px!important}.mapa-flash{box-shadow:0 0 0 2px rgba(230,162,116,.6)}';
function aplicarEstilo(){
 try{
  if(!document||!document.head||typeof document.createElement!=='function')return;
  if(document.querySelector('style[data-mapa]'))return;
  const estilo=document.createElement('style');
  estilo.setAttribute('data-mapa','1');
  estilo.textContent=ESTILO;
  document.head.appendChild(estilo);
 }catch(e){/* sem estilo o mapa ainda renderiza */}
}
if(typeof document!=='undefined'&&document&&typeof document.addEventListener==='function'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',aplicarEstilo);
 else aplicarEstilo();
}
const TITULOS={xon:'BREACHES & SENHAS',hudsonrock:'INFOSTEALER',gravatar:'GRAVATAR',keybase:'KEYBASE',analytics:'ANALYTICS DE BREACH',pgp:'PGP',github:'GITHUB',emailrep:'REPUTACAO',email_registro:'CADASTRO DE E-MAIL',dns:'DNS & E-MAIL',crtsh:'SUBDOMINIOS',wayback:'URLS HISTORICAS',internetdb:'EXPOSICAO',ipgeo:'REDE',asn:'ASN',cnpj_br:'EMPRESA',ceis:'SANCOES',ddd:'REGIAO',phone_footprint:'RASTREIO DE TELEFONE',numverify:'VALIDADE DO NUMERO',wikidata:'WIKIDATA',datajud:'PROCESSOS',telegram:'TELEGRAM',gitlab:'GITLAB',npm:'NPM',bluesky:'BLUESKY',rdap:'RDAP',ssllabs:'SSL LABS',urlscan:'URLSCAN',cpf_valida:'CPF',cpf_brasilapi:'CADASTRO DE CPF',placa_footprint:'RASTREIO DE PLACA',placa_consultarplaca:'VEICULO',nome_perfil:'PERFIS'};
// Onde cada fonte mora. `local:true` marca as fontes que nao saem para um
// host unico (calculo local, dorks locais ou consulta em varios sites).
const GEO={
 gravatar:{host:'gravatar.com',lat:39.74,lon:-104.99},
 pgp:{host:'keys.openpgp.org',lat:49.45,lon:11.08},
 gitlab:{host:'gitlab.com',lat:39.04,lon:-77.49},
 npm:{host:'registry.npmjs.org',lat:39.04,lon:-77.49},
 bluesky:{host:'public.api.bsky.app',lat:37.77,lon:-122.42},
 telegram:{host:'t.me',lat:52.37,lon:4.90},
 xon:{host:'api.xposedornot.com',lat:45.52,lon:-122.68},
 hudsonrock:{host:'cavalier.hudsonrock.com',lat:41.90,lon:12.50},
 github:{host:'api.github.com',lat:37.77,lon:-122.42},
 emailrep:{host:'emailrep.io',lat:37.77,lon:-122.42},
 dns:{host:'dns.google',lat:37.39,lon:-122.08},
 crtsh:{host:'api.subdomain.center',lat:52.37,lon:4.90},
 wayback:{host:'web.archive.org',lat:37.77,lon:-122.42},
 rdap:{host:'rdap.registro.br',lat:-23.55,lon:-46.63},
 ssllabs:{host:'api.ssllabs.com',lat:37.39,lon:-122.08},
 urlscan:{host:'urlscan.io',lat:52.52,lon:13.40},
 internetdb:{host:'internetdb.shodan.io',lat:37.77,lon:-122.42},
 keybase:{host:'keybase.io',lat:37.77,lon:-122.42},
 analytics:{host:'api.xposedornot.com',lat:45.52,lon:-122.68},
 ipgeo:{host:'ipwho.is',lat:37.77,lon:-122.42},
 asn:{host:'team-cymru.com',lat:42.33,lon:-83.05},
 numverify:{host:'apilayer.com',lat:37.77,lon:-122.42},
 wikidata:{host:'query.wikidata.org',lat:39.04,lon:-77.49},
 cnpj_br:{host:'brasilapi.com.br',lat:-23.55,lon:-46.63},
 ceis:{host:'portaldatransparencia.gov.br',lat:-15.79,lon:-47.88},
 datajud:{host:'datajud.cnj.jus.br',lat:-15.79,lon:-47.88},
 cpf_brasilapi:{host:'brasilapi.com.br',lat:-23.55,lon:-46.63},
 placa_consultarplaca:{host:'consultarplaca.com.br',lat:-23.55,lon:-46.63},
 ddd:{local:true,nota:'Anatel · snapshot local'},
 phone_footprint:{local:true,nota:'dorks locais · PhoneInfoga'},
 cpf_valida:{local:true,nota:'calculo local de digito verificador'},
 placa_footprint:{local:true,nota:'dorks locais · Mercosul'},
 email_registro:{local:true,nota:'varios sites de cadastro'},
 nome_perfil:{local:true,nota:'varios sites de perfil'}
};
// Origem da consulta: pais do visitante (quando o Worker informa).
const PAISES={BR:[-23.55,-46.63],US:[39.04,-77.49],PT:[38.72,-9.14],ES:[40.42,-3.70],FR:[48.86,2.35],DE:[52.52,13.40],GB:[51.51,-0.13],IT:[41.90,12.50],NL:[52.37,4.90],SE:[59.33,18.07],NO:[59.91,10.75],FI:[60.17,24.94],PL:[52.23,21.01],UA:[50.45,30.52],RU:[55.76,37.62],TR:[41.01,28.98],EG:[30.04,31.24],MA:[33.57,-7.59],DZ:[36.75,3.06],AR:[-34.60,-58.38],CL:[-33.45,-70.67],CO:[4.71,-74.07],PE:[-12.05,-77.04],VE:[10.49,-66.88],MX:[19.43,-99.13],JP:[35.68,139.69],CN:[31.23,121.47],IN:[19.08,72.88],ID:[-6.21,106.85],AU:[-33.87,151.21],NZ:[-36.85,174.76],IE:[53.35,-6.26],BE:[50.85,4.35],AT:[48.21,16.37],CH:[47.38,8.54],CA:[43.65,-79.38],ZA:[-26.20,28.05],NG:[6.52,3.37],KE:[-1.29,36.82],IL:[32.09,34.78],SA:[24.71,46.68],AE:[25.20,55.27],PK:[24.86,67.01],BD:[23.81,90.41],TH:[13.76,100.50],VN:[21.03,105.85],PH:[14.60,120.98],MY:[3.14,101.69],SG:[1.35,103.82],KR:[37.57,126.98],TW:[25.03,121.57],HK:[22.32,114.17],IR:[35.69,51.39],IQ:[33.31,44.36],GH:[5.60,-0.19],AO:[-8.84,13.23],MZ:[-25.97,32.57],UY:[-34.90,-56.16],PY:[-25.26,-57.58],BO:[-16.29,-63.59],EC:[-0.18,-78.47],CU:[23.11,-82.37],CR:[9.93,-84.08],GT:[14.63,-90.51],PA:[8.98,-79.52],DO:[18.49,-69.93],JM:[18.11,-77.30]};
// Contornos simplificados dos continentes. A projection e equirretangular e o
// rasterizado vira a malha de pontos (o visual de mapa pontilhado).
const POLIGONOS={
 norte:[[-168,66],[-165,69],[-157,71],[-141,70],[-128,70],[-115,69],[-100,69],[-90,70],[-81,73],[-72,70],[-64,62],[-56,52],[-60,47],[-67,45],[-70,42],[-74,40],[-76,36],[-81,31],[-80,25],[-83,29],[-88,30],[-94,29],[-97,26],[-97,22],[-92,18],[-88,21],[-88,16],[-84,10],[-79,8],[-77,8],[-80,6],[-85,10],[-92,15],[-96,16],[-105,20],[-110,24],[-114,28],[-117,32],[-121,35],[-124,40],[-124,46],[-131,54],[-140,59],[-150,59],[-158,56],[-165,54],[-168,60]],
 groenlandia:[[-45,60],[-52,64],[-54,68],[-58,72],[-62,76],[-56,80],[-42,83],[-28,82],[-20,77],[-22,71],[-30,67],[-38,64]],
 sul:[[-78,8],[-75,11],[-71,12],[-63,11],[-60,8],[-52,5],[-50,0],[-44,-3],[-38,-5],[-35,-8],[-39,-13],[-40,-20],[-48,-25],[-53,-34],[-57,-38],[-62,-40],[-65,-45],[-68,-50],[-70,-55],[-75,-52],[-73,-45],[-73,-37],[-71,-30],[-70,-20],[-75,-15],[-81,-6],[-80,-1],[-77,2]],
 eurasia:[[-9,43],[-9,38],[-6,36],[0,39],[3,42],[7,44],[11,44],[14,41],[18,40],[20,40],[23,38],[26,40],[29,41],[33,36],[36,36],[35,33],[34,31],[38,29],[43,13],[45,13],[52,17],[56,25],[58,23],[61,25],[67,24],[72,21],[73,16],[76,9],[80,13],[84,19],[87,21],[89,22],[92,21],[95,16],[98,10],[100,6],[104,2],[106,10],[109,15],[108,21],[110,21],[113,22],[117,24],[120,26],[122,30],[122,37],[126,40],[129,43],[135,45],[140,47],[143,53],[150,59],[157,61],[163,58],[170,60],[178,65],[179,68],[170,70],[160,71],[150,72],[140,73],[130,73],[120,74],[110,76],[100,77],[92,76],[85,74],[78,74],[70,73],[60,70],[55,68],[50,69],[43,66],[40,68],[33,69],[26,70],[23,71],[19,70],[15,68],[10,60],[6,58],[5,59],[7,57],[10,55],[13,54],[17,54],[21,56],[24,59],[27,62],[30,66],[33,68],[40,67],[45,68],[50,68],[55,68],[60,70],[67,69],[70,73],[78,74],[85,74],[92,76],[100,77],[110,76],[120,74],[130,73],[140,73],[150,72],[160,71],[170,70],[179,68],[178,65],[170,60],[163,58],[157,61],[150,59],[143,53],[140,47],[135,45],[129,43],[126,40],[122,37],[122,30],[120,26],[117,24],[113,22],[110,21],[108,21],[109,15],[106,10],[104,2],[100,6],[98,10],[95,16],[92,21],[89,22],[87,21],[84,19],[80,13],[76,9],[73,16],[72,21],[67,24],[61,25],[58,23],[56,25],[52,17],[45,13],[43,13],[38,29],[34,31],[35,33],[36,36],[33,36],[29,41],[26,40],[23,38],[20,40],[18,40],[14,41],[11,44],[7,44],[3,42],[0,39],[-6,36]],
 africa:[[-6,36],[-9,33],[-13,27],[-16,21],[-17,15],[-13,9],[-8,4],[-4,5],[4,6],[9,4],[9,0],[11,-5],[12,-18],[18,-34],[28,-33],[33,-26],[35,-18],[40,-10],[42,-2],[48,3],[51,11],[43,12],[40,16],[37,21],[35,28],[32,31],[25,32],[18,31],[11,33],[8,37],[3,36],[-2,35]],
 australia:[[113,-22],[114,-26],[115,-32],[118,-35],[123,-34],[129,-32],[134,-33],[138,-35],[141,-38],[146,-39],[150,-37],[153,-30],[153,-25],[146,-19],[142,-11],[137,-12],[132,-11],[130,-13],[126,-14],[122,-17],[117,-21]],
 tasmania:[[145,-41],[148,-41],[148,-43],[145,-43]],
 japao:[[130,31],[133,34],[137,35],[141,39],[140,42],[145,45],[141,45],[139,40],[136,36],[132,33]],
 britannica:[[-5,50],[1,51],[0,53],[-1,54],[-3,56],[-2,58],[-5,58],[-6,56],[-5,53]],
 irlanda:[[-10,52],[-6,52],[-6,55],[-10,54]],
 islândia:[[-24,65],[-14,65],[-14,66],[-22,67]],
 madagascar:[[43,-12],[50,-15],[50,-20],[47,-25],[45,-25],[43,-21]],
 nova_zelandia_n:[[173,-34],[178,-37],[176,-41],[172,-40]],
 nova_zelandia_s:[[174,-41],[172,-45],[167,-47],[168,-44]],
 sumatra:[[95,6],[99,3],[106,-6],[104,-6],[100,0],[95,5]],
 java:[[105,-6],[114,-8],[110,-8],[106,-7]],
 borneu:[[109,2],[117,4],[119,-3],[110,-3]],
 sulawesi:[[119,1],[125,1],[123,-5],[120,-3],[120,0]],
 nova_guine:[[131,-1],[141,-3],[147,-6],[150,-10],[143,-9],[137,-8],[131,-4]],
 filipinas:[[120,18],[122,14],[126,10],[126,6],[122,6],[120,12]],
 sri_lanka:[[80,9],[82,7],[81,6],[80,7]],
 cuba:[[-84,22],[-77,20],[-74,20],[-79,23]],
 hispaniola:[[-74,20],[-68,19],[-68,18],[-72,18]],
 svalbard:[[10,77],[20,79],[28,79],[20,76],[12,76]],
 novaya_zemlya:[[52,71],[60,74],[68,76],[62,71],[55,70]],
 taiwan:[[120,25],[122,25],[121,22],[120,23]]
};
const LAT_MAX=84,LAT_MIN=-58;
const PX=lon=>20+(lon+180)/360*960;
const PY=lat=>8+(LAT_MAX-lat)/(LAT_MAX-LAT_MIN)*384;
const C_RED='#f87171',C_EMBER='#e6a274',C_CREAM='#e7e6d9';
let terraCache=null;
function dentro(x,y,p){
 let dentro=false;
 for(let i=0,j=p.length-1;i<p.length;j=i++){
  const xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1];
  if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi) dentro=!dentro;
 }
 return dentro;
}
function terra(){
 if(terraCache)return terraCache;
 const pontos=[];
 const polys=Object.values(POLIGONOS);
 for(let lat=LAT_MAX-1;lat>LAT_MIN;lat-=2){
  for(let lon=-179;lon<180;lon+=2){
   let sim=false;
   for(const p of polys){if(dentro(lon,lat,p)){sim=true;break;}}
   if(sim)pontos.push([PX(lon),PY(lat)]);
  }
 }
 terraCache=pontos;
 return terraCache;
}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function tituloDe(id){
 const no=document.querySelector('[data-fonte="'+id+'"] summary span:nth-of-type(2)');
 if(no&&no.textContent.trim())return no.textContent.trim();
 return TITULOS[id]||id;
}
// ---------------------------------------------------------------------------
// Layout do mapa.
// Os nos sao posicionados em pixels (e nao em graus) para que fontes que
// dividem a mesma regiao nao fiquem empilhadas num unico ponto. Os arcos saem
// de um anel ao redor da origem, cada um por um angulo diferente, para que as
// linhas se distribuam em vez de se empilharem.
// ---------------------------------------------------------------------------
const RAIO_PARTIDA=36,RAIO_REGIAO=42,DIST_MIN=26,LIMITE_REGIAO=26,SEP_ANG=0.16,SEP_ENTRADA=0.30,FAN=0.45,SEP_LEQUE=0.34,LANE=18,MIN_SEP=8,DESVIO_MAX=70;
function arco(x1,y1,c1x,c1y,c2x,c2y,x2,y2){
 return 'M'+x1.toFixed(1)+' '+y1.toFixed(1)+' C'+c1x.toFixed(1)+' '+c1y.toFixed(1)+' '+c2x.toFixed(1)+' '+c2y.toFixed(1)+' '+x2.toFixed(1)+' '+y2.toFixed(1);
}
function layout(fontes,hx,hy){
 const grupos=new Map(),regiao=[];
 for(const f of fontes){
  const g=GEO[f.id];
  if(!g)continue;
  if(g.local){regiao.push(f);continue;}
  const gx=PX(g.lon),gy=PY(g.lat);
  // Fonte da propria regiao da origem: fica no anel interno, sem arco.
  if(Math.hypot(gx-hx,gy-hy)<LIMITE_REGIAO){regiao.push(f);continue;}
  const k=g.lat.toFixed(2)+','+g.lon.toFixed(2);
  if(!grupos.has(k))grupos.set(k,[]);
  grupos.get(k).push(f);
 }
 const nos=[];
 let gid=0;
 for(const[k,lista]of grupos){
  const[lat,lon]=k.split(',').map(Number);
  const bx=PX(lon),by=PY(lat),n=lista.length;
  // Mesmo ponto: os nos ganham um circulo em volta, nunca por cima uns dos outros.
  const r=n>1?DIST_MIN/(2*Math.sin(Math.PI/n)):0;
  const id=gid++;
  lista.forEach((f,i)=>{
   const ang=(i/n)*Math.PI*2-Math.PI/2;
   // cx/cy guardam o centro do agrupamento e gid o identifica: as linhas que
   // vao para o mesmo ponto sao separadas em faixas, para nao se empilharem.
   nos.push({fonte:f,id:f.id,host:GEO[f.id].host,gid:id,cx:bx,cy:by,grupo:n,x:bx+(n>1?Math.cos(ang)*r:0),y:by+(n>1?Math.sin(ang)*r:0)});
  });
 }
 // Anel interno: fontes locais e fontes da propria regiao da origem.
 const total=regiao.length;
 regiao.forEach((f,i)=>{
  const ang=(i/Math.max(1,total))*Math.PI*2-Math.PI/2;
  nos.push({fonte:f,id:f.id,regiao:true,host:GEO[f.id].host,nota:GEO[f.id].nota,gid:-1,cx:hx,cy:hy,grupo:0,x:hx+Math.cos(ang)*RAIO_REGIAO,y:hy+Math.sin(ang)*RAIO_REGIAO});
 });
 // Regioes vizinhas ainda podem se encostar: afasta os nos uns dos outros.
 for(let it=0;it<90;it++){
  let moveu=false;
  for(let i=0;i<nos.length;i++)for(let j=i+1;j<nos.length;j++){
   const a=nos[i],b=nos[j];
   let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
   if(d<1e-4){dx=(i%2?1:-1)*0.01;dy=(j%2?1:-1)*0.01;d=Math.hypot(dx,dy);}
   if(d<DIST_MIN){
    const p=(DIST_MIN-d)*0.3;
    a.x-=dx/d*p;a.y-=dy/d*p;b.x+=dx/d*p;b.y+=dy/d*p;moveu=true;
   }
  }
  if(!moveu)break;
 }
 return nos;
}
// Distribui as saidas e as curvas dos arcos.
//
// O problema: as fontes se agrupam (sete nos na mesma coordenada dos EUA,
// cinco na Europa) e as linhas que saem da origem para o mesmo grupo andavam
// uma por cima da outra -- o novelo que o mapa mostrava. A solucao e em
// tres passos:
//  1. as saidas nascem em angulos diferentes (nenhuma duas linhas saem do
//     mesmo ponto do anel);
//  2. dentro de um leque (fontes que saem quase na mesma direcao) cada linha
//     ganha uma faixa lateral propria, deslocada perpendicularmente ao
//     cordao: e o deslocamento que abre o novelo no meio do caminho;
//  3. uma passada final afasta qualquer curva que ainda encoste na vizinha.
function partirArcos(nos,hx,hy){
 const lista=[];
 for(const no of nos){
  if(no.regiao)continue;
  const dx=no.x-hx,dy=no.y-hy;
  lista.push({no:no,dist:Math.hypot(dx,dy),bearing:Math.atan2(dy,dx)});
 }
 if(!lista.length)return lista;
 // Gira a lista para que o maior vazio angular fique no fim (mantem juntos o
 // que esta em torno de +/-180 graus).
 let maiorGap=-1,corte=0;
 for(let i=0;i<lista.length;i++){
  const a=lista[i].bearing,b=lista[(i+1)%lista.length].bearing;
  const gap=(i+1===lista.length?b+2*Math.PI:b)-a;
  if(gap>maiorGap){maiorGap=gap;corte=i+1;}
 }
 if(corte>0)lista.push(...lista.splice(0,corte));
 let anterior=null;
 for(const a of lista){
  if(anterior!==null&&a.bearing-anterior>Math.PI)a.bearing-=2*Math.PI;
  anterior=a.bearing;
 }
 // Leques: as fontes que saem praticamente na mesma direcao formam um leque.
 const grupos=[];let atual=[];
 for(const a of lista){
  if(atual.length&&a.bearing-atual[atual.length-1].bearing>SEP_LEQUE){grupos.push(atual);atual=[];}
  atual.push(a);
 }
 if(atual.length)grupos.push(atual);
 for(const g of grupos){
  const n=g.length;
  const bs=g.map(a=>a.bearing);
  const bMin=Math.min.apply(null,bs),bMax=Math.max.apply(null,bs);
  const natural=bMax-bMin;
  // O leque do grupo abre ate caber uma saida por fonte, sem encostar.
  const spread=Math.max(natural,(n-1)*SEP_ANG);
  const meio=(bMin+bMax)/2;
  // Eixo do leque: a perpendicular media do leque e a direcao em que as
  // faixas se abrem. Todas as linhas do leque deslizam para a mesma
  // perpendicular, o que mantem o grupo paralelo (sem cruzamento) e o
  // separa das demais linhas.
  let cx=0,cy=0;
  for(const a of g){cx+=a.no.x;cy+=a.no.y;}
  cx/=n;cy/=n;
  const dx=cx-hx,dy=cy-hy;
  const dl=Math.hypot(dx,dy)||1;
  const px=-dy/dl,py=dx/dl;
  // Ordena pela projecao no eixo: a faixa de cada fonte acompanha a ordem
  // dos alvos, entao as linhas do leque nao se cruzam.
  const ordem=g.slice().sort((a,b)=>((a.no.x-hx)*px+(a.no.y-hy)*py)-((b.no.x-hx)*px+(b.no.y-hy)*py));
  ordem.forEach((a,i)=>{
   // A saida fica na mesma posicao relativa do alvo dentro do leque: a
   // linha nao precisa dar volta para voltar a direcao do alvo.
   const p=natural>0?(a.bearing-bMin)/natural:(i+0.5)/n-0.5;
   a.angulo=meio-spread/2+p*spread;
   // Posicao dentro do leque: define a faixa lateral da linha.
   a.fatia=i-(n-1)/2;
   a.px=px;
   a.py=py;
  });
 }
 // Passagem final: nenhuma saida pode encostar na anterior.
 const ord=lista.slice().sort((a,b)=>a.bearing-b.bearing);
 for(let i=1;i<ord.length;i++){
  if(ord[i].angulo-ord[i-1].angulo<SEP_ANG)ord[i].angulo=ord[i-1].angulo+SEP_ANG;
 }
 for(const a of lista){
  a.sx=hx+Math.cos(a.angulo)*RAIO_PARTIDA;
  a.sy=hy+Math.sin(a.angulo)*RAIO_PARTIDA;
 }
 // Cada linha vira uma curva cubica com dois controles: um na saida (radial,
 // para as linhas sairem ja abertas) e um na chegada (inclinado, para cada
 // linha entrar no alvo por um lado diferente). Os dois controles recebem o
 // mesmo deslocamento lateral (a faixa do leque): o cordao desliza para o
 // lado e a linha deixa de andar por cima da vizinha.
 for(const a of lista){
  a.hx0=hx;
  a.hy0=hy;
  a.desvio=a.fatia*LANE;
  montarControles(a);
 }
 // Passada final: se duas linhas ainda se tocam no meio do caminho, as faixas
 // se afastam ate o ponto em que cada uma volta a ter o seu corredor.
 afastaCurvas(lista);
 for(const a of lista)montarControles(a);
 return lista;
}
function montarControles(a){
 const no=a.no;
 const d=Math.hypot(no.x-a.sx,no.y-a.sy)||1;
 // Angulo de chegada: a visada ate o alvo, corrigida pela faixa do leque.
 let chegada=Math.atan2(no.y-a.hy0,no.x-a.hx0)+a.fatia*SEP_ENTRADA;
 // Fontes do mesmo agrupamento entram pelo seu proprio lado do circulo.
 if(no.grupo>1){
  const radial=Math.atan2(no.y-no.cy,no.x-no.cx);
  chegada+=(Math.cos(radial)>=0?1:-1)*FAN;
 }
 const l1=Math.min(d*0.45,240),l2=Math.min(d*0.42,220);
 a.c1x=a.sx+Math.cos(a.angulo)*l1+a.px*a.desvio;
 a.c1y=a.sy+Math.sin(a.angulo)*l1+a.py*a.desvio;
 a.c2x=no.x-Math.cos(chegada)*l2+a.px*a.desvio;
 a.c2y=no.y-Math.sin(chegada)*l2+a.py*a.desvio;
}
function pontoDaCurva(a,t){
 const u=1-t;
 return [
  u*u*u*a.sx+3*u*u*t*a.c1x+3*u*t*t*a.c2x+t*t*t*a.no.x,
  u*u*u*a.sy+3*u*u*t*a.c1y+3*u*t*t*a.c2y+t*t*t*a.no.y
 ];
}
// Afasta as curvas que andam uma por cima da outra: as faixas laterais sao
// empurradas para os lados ate cada linha ter o seu corredor limpo.
function afastaCurvas(lista){
 const passo=0.05;
 const limita=v=>Math.max(-DESVIO_MAX,Math.min(DESVIO_MAX,v));
 for(let it=0;it<60;it++){
  let mexeu=false;
  for(let i=0;i<lista.length;i++){
   for(let j=i+1;j<lista.length;j++){
    const a=lista[i],b=lista[j];
    let menor=Infinity,pa=null,pb=null;
    for(let t=0.12;t<=0.88;t+=passo){
     const p=pontoDaCurva(a,t),q=pontoDaCurva(b,t);
     const d=Math.hypot(p[0]-q[0],p[1]-q[1]);
     if(d<menor){menor=d;pa=p;pb=q;}
    }
    if(menor>=MIN_SEP||!pa)continue;
    // Empurra cada linha para o lado que afasta as duas.
    const ux=pa[0]-pb[0],uy=pa[1]-pb[1];
    const empurra=(MIN_SEP-menor)*0.5;
    const sA=(a.px*ux+a.py*uy)>=0?1:-1;
    const sB=(b.px*ux+b.py*uy)>=0?-1:1;
    a.desvio=limita(a.desvio+sA*empurra);
    b.desvio=limita(b.desvio+sB*empurra);
    montarControles(a);
    montarControles(b);
    mexeu=true;
   }
  }
  if(!mexeu)break;
 }
}
function render(el,opts){
 if(!el)return;
 const fontes=Array.isArray(opts.fontes)?opts.fontes:[];
 const ok=fontes.filter(f=>f.status==='ok'),falhas=fontes.filter(f=>f.status!=='ok');
 const hub=PAISES[String(opts.pais||'').toUpperCase()]||PAISES.BR;
 const hx=PX(hub[1]),hy=PY(hub[0]);
 const pontos=terra();
 const nos=layout(fontes,hx,hy);
 const arcos=partirArcos(nos,hx,hy);
 const arcosSvg=[],nosSvg=[];
 arcos.forEach((a,i)=>{
  const f=a.no.fonte;
  const falhou=f.status!=='ok';
  const cor=falhou?C_RED:C_EMBER;
  const tracejado=(2.5+(i%3)*0.5).toFixed(1)+' '+(9-(2.5+(i%3)*0.5)).toFixed(1);
  arcosSvg.push('<path id="mapa-arco-'+esc(f.id)+'" class="mapa-arco '+(falhou?'falha':'ok')+'" style="stroke-dasharray:'+tracejado+'" d="'+arco(a.sx,a.sy,a.c1x,a.c1y,a.c2x,a.c2y,a.no.x,a.no.y)+'"/>');
  arcosSvg.push('<circle class="mapa-pacote" r="1.8" fill="'+cor+'"><animateMotion dur="'+(falhou?'2.2':'3.4')+'s" repeatCount="indefinite" begin="'+(i*.28)+'s"><mpath href="#mapa-arco-'+esc(f.id)+'" xlink:href="#mapa-arco-'+esc(f.id)+'"/></animateMotion></circle>');
 });
 for(const n of nos){
  const f=n.fonte;
  const falhou=f.status!=='ok';
  const cor=falhou?C_RED:C_EMBER;
  const x=n.x.toFixed(1),y=n.y.toFixed(1);
  if(falhou)nosSvg.push('<circle class="mapa-halo" cx="'+x+'" cy="'+y+'" r="4" fill="none" stroke="'+C_RED+'" stroke-width="1"><animate attributeName="r" values="4;13" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="2s" repeatCount="indefinite"/></circle>');
  nosSvg.push('<g class="mapa-no" data-nodo="'+esc(f.id)+'" tabindex="0" role="button" aria-label="'+esc(tituloDe(f.id)+' · '+(falhou?'falhou':'respondeu'))+'">'+
   '<circle cx="'+x+'" cy="'+y+'" r="8" fill="transparent"/>'+
   '<circle cx="'+x+'" cy="'+y+'" r="3.1" fill="'+cor+'" stroke="#050505" stroke-width="1"/>'+
   '<circle cx="'+x+'" cy="'+y+'" r="5.4" fill="none" stroke="'+cor+'" stroke-width=".6" opacity=".5"/>'+
   '</g>');
 }
 const svg='<svg class="mapa-svg" viewBox="0 0 1000 400" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="Mapa das fontes consultadas no scan">'+
  '<g class="mapa-terra">'+pontos.map(p=>'<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="1.55"/>').join('')+'</g>'+
  '<g class="mapa-arcos">'+arcosSvg.join('')+'</g>'+
  '<g class="mapa-nos"><g class="mapa-origem">'+
   '<circle cx="'+hx.toFixed(1)+'" cy="'+hy.toFixed(1)+'" r="'+RAIO_PARTIDA+'" fill="none" stroke="'+C_CREAM+'" stroke-width=".6" opacity=".28" stroke-dasharray="2 5"/>'+
   '<circle cx="'+hx.toFixed(1)+'" cy="'+hy.toFixed(1)+'" r="4.6" fill="none" stroke="'+C_CREAM+'" stroke-width="1" opacity=".9"><animate attributeName="r" values="4.6;12" dur="2.6s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="2.6s" repeatCount="indefinite"/></circle>'+
   '<circle cx="'+hx.toFixed(1)+'" cy="'+hy.toFixed(1)+'" r="2.6" fill="'+C_CREAM+'"/></g>'+nosSvg.join('')+'</g>'+
  '</svg>';
 el.innerHTML='<div class="mapa-topo"><span class="eyebrow">MAPA DE CONEXOES · FONTES CONSULTADAS</span>'+
  '<span class="mapa-contagem"><b>'+ok.length+'</b> ok · <b class="mapa-falhas-n">'+falhas.length+'</b> falha'+(falhas.length===1?'':'s')+' · '+fontes.length+' no total</span></div>'+
  '<div class="mapa-livro">'+svg+'<div class="mapa-tip" role="status" aria-live="polite"></div></div>'+
  '<div class="mapa-legenda"><span><i style="background:'+C_EMBER+'"></i>respondeu</span><span><i style="background:'+C_RED+'"></i>falhou</span><span><i style="background:'+C_CREAM+'"></i>origem da consulta</span><span>clique em um no para abrir os detalhes da fonte</span></div>'+
  '<p class="mapa-nota">Origem: '+(opts.pais?String(opts.pais).toUpperCase():'BR')+' · cada arco sai da origem por um angulo diferente e termina na fonte consultada; fontes da sua regiao ficam no anel interno.</p>';
 const tip=el.querySelector('.mapa-tip');
 const livro=el.querySelector('.mapa-livro');
 const mostrar=(f,nodo)=>{
  const falhou=f.status!=='ok';
  const linhas=[];
  linhas.push('<b>'+esc(tituloDe(f.id))+'</b>');
  linhas.push('<span class="mapa-tip-st '+(falhou?'falha':'ok')+'">'+(falhou?'FALHOU':'RESPONDEU')+'</span>'+(f.ms!=null?' · '+esc(f.ms)+' ms':'')+(f.cache==='hit'?' · cache':''));
  if(falhou&&f.erro)linhas.push('<span class="mapa-tip-erro">'+esc(f.erro)+'</span>');
  if(!falhou){const g=GEO[f.id];linhas.push('<span class="mapa-tip-dim">'+esc(g&&g.host?g.host+(g.nota?' · '+g.nota:''):(g&&g.nota?g.nota:'fonte local'))+'</span>');}
  else if(GEO[f.id]&&GEO[f.id].host)linhas.push('<span class="mapa-tip-dim">'+esc(GEO[f.id].host)+'</span>');
  if(f.provenance)linhas.push('<span class="mapa-tip-dim">'+esc(f.provenance)+'</span>');
  tip.innerHTML=linhas.join('<br>');
  const r=nodo.getBoundingClientRect(),lr=livro.getBoundingClientRect();
  tip.style.left=(r.left-lr.left+r.width/2)+'px';
  tip.style.top=(r.top-lr.top)+'px';
  tip.classList.add('on');
 };
 const esconder=()=>tip.classList.remove('on');
 for(const nodo of el.querySelectorAll('[data-nodo]')){
  const f=fontes.find(x=>x.id===nodo.dataset.nodo);
  if(!f)continue;
  nodo.addEventListener('mouseenter',()=>mostrar(f,nodo));
  nodo.addEventListener('focus',()=>mostrar(f,nodo));
  nodo.addEventListener('mouseleave',esconder);
  nodo.addEventListener('blur',esconder);
  nodo.addEventListener('click',()=>abrirFonte(f.id));
  nodo.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();abrirFonte(f.id);}});
 }
}
function abrirFonte(id){
 const alvo=document.querySelector('[data-fonte="'+id+'"]');
 if(!alvo)return;
 let pai=alvo.parentElement;
 while(pai&&pai.tagName!=='DETAILS')pai=pai.parentElement;
 if(pai)pai.open=true;
 alvo.open=true;
 alvo.scrollIntoView({behavior:'smooth',block:'center'});
 alvo.classList.add('mapa-flash');
 setTimeout(()=>alvo.classList.remove('mapa-flash'),1600);
}
window.OSINTMapa={render:render,abrirFonte:abrirFonte};
})();
