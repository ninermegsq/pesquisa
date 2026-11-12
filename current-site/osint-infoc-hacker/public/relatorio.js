'use strict';
/* Relatorio em PDF do scan OSINT.
   PDF 1.4 montado a mao (objetos, xref e trailer) porque o projeto roda sem
   npm e sem bundler: nao ha biblioteca de PDF disponivel. O relatorio leva
   alvo, indice de risco, situacao de cada fonte consultada e todos os achados
   coletados. A paleta e a mesma do site (fundo quase preto, creme, brasa,
   verde e vermelho). */
(function(){
const C={fundo:'0.02 0.02 0.02',painel:'0.055 0.055 0.05',linha:'0.16 0.16 0.15',creme:'0.906 0.902 0.851',fraco:'0.55 0.54 0.5',brasa:'0.902 0.635 0.455',verde:'0.29 0.87 0.5',vermelho:'0.97 0.44 0.44',ambar:'0.96 0.62 0.04'};
const LAT=595.28,ALT=841.89,M=42;
const TITULOS={xon:'BREACHES & SENHAS',hudsonrock:'INFOSTEALER',gravatar:'GRAVATAR',keybase:'KEYBASE',analytics:'ANALYTICS DE BREACH',pgp:'PGP',github:'GITHUB',emailrep:'REPUTACAO',email_registro:'CADASTRO DE E-MAIL',dns:'DNS & E-MAIL',crtsh:'SUBDOMINIOS',wayback:'URLS HISTORICAS',internetdb:'EXPOSICAO',ipgeo:'REDE',asn:'ASN',cnpj_br:'EMPRESA',ceis:'SANCOES',ddd:'REGIAO',phone_footprint:'RASTREIO DE TELEFONE',numverify:'VALIDADE DO NUMERO',wikidata:'WIKIDATA',datajud:'PROCESSOS',telegram:'TELEGRAM',gitlab:'GITLAB',npm:'NPM',bluesky:'BLUESKY',rdap:'RDAP',ssllabs:'SSL LABS',urlscan:'URLSCAN',cpf_valida:'CPF',cpf_brasilapi:'CADASTRO DE CPF',placa_footprint:'RASTREIO DE PLACA',placa_consultarplaca:'VEICULO',nome_perfil:'PERFIS'};
function tituloDe(id){
 const el=document.querySelector('[data-fonte="'+id+'"] summary span:nth-of-type(2)');
 if(el&&el.textContent.trim())return el.textContent.trim();
 return TITULOS[id]||id;
}
// Texto do PDF e Latin-1 (WinAnsi): o que passa de 255 vira "?" e o
// Parentese e a barra sao escapados para nao quebrar o stream.
function textoPdf(s){
 let out='';
 for(const ch of String(s==null?'':s)){
  const code=ch.codePointAt(0);
  if(code<32||code===127){out+=' ';continue;}
  if(code<256){out+=String.fromCharCode(code);continue;}
  out+='?';
 }
 return out.replace(/([()\\])/g,'\\$1');
}
function largura(s,tam){return String(s==null?'':s).length*tam*0.5;}
function quebrar(texto,tam,max){
 const out=[];let linha='';
 for(const palavra of String(texto==null?'':texto).split(/\s+/)){
  if(!palavra)continue;
  const teste=linha?linha+' '+palavra:palavra;
  if(largura(teste,tam)>max&&linha){out.push(linha);linha=palavra;}else linha=teste;
 }
 if(linha)out.push(linha);
 return out.length?out:[''];
}
function achados(fontes){
 const grupos=[];
 for(const fonte of fontes||[]){
  const linhas=[];
  const achatar=(path,value)=>{
   if(value==null)return;
   if(typeof value==='object'){for(const[k,v]of Object.entries(value))achatar(path?path+'.'+k:k,v);return;}
   linhas.push([path,String(value)]);
  };
  if(fonte.status==='ok')achatar('',fonte.dados);
  else linhas.push(['status',fonte.erro||fonte.status]);
  if(linhas.length)grupos.push({fonte,linhas});
 }
 return grupos;
}
function relatorio(dados,alvo){
 const fontes=(dados&&dados.fontes)||[];
 const score=(dados&&dados.score)||{};
 const meta=(dados&&dados.meta)||{};
 const grupos=achados(fontes);
 const ok=fontes.filter(f=>f.status==='ok').length;
 const valor=Number(score.valor||0);
 const nivel=String(score.nivel||'BAIXO');
 const corScore=valor>60?C.vermelho:valor>25?C.ambar:C.verde;
 const paginas=[];let c='';let y=0;
 const add=t=>{c+=t;};
 const nova=()=>{if(c)paginas.push(c);c='';};
 const txt=(s,x,yy,tam,cor,fonte)=>{add(cor+' rg BT /'+(fonte||'F1')+' '+tam+' Tf 1 0 0 1 '+x.toFixed(1)+' '+yy.toFixed(1)+' Tm ('+textoPdf(s)+') Tj ET\n');};
 const txtDir=(s,x,yy,tam,cor,fonte)=>txt(s,x-largura(s,tam),yy,tam,cor,fonte);
 const ret=(x,yy,w,h,cor)=>{add(cor+' rg '+x.toFixed(1)+' '+yy.toFixed(1)+' '+w.toFixed(1)+' '+h.toFixed(1)+' re f\n');};
 const lin=(x1,y1,x2,y2,cor,g)=>{add(cor+' RG '+(g||0.6)+' w '+x1.toFixed(1)+' '+y1.toFixed(1)+' m '+x2.toFixed(1)+' '+y2.toFixed(1)+' l S\n');};
 const carimbo=new Date((dados&&dados.gerado_em)||Date.now()).toISOString().replace('T',' ').slice(0,16)+' UTC';
 const cabecalho=()=>{
  ret(0,0,LAT,ALT,C.fundo);
  ret(0,ALT-8,LAT,8,C.brasa);
  txt('INFOC.HACKER',M,ALT-56,21,C.brasa,'F2');
  txt('RELATORIO DE EXPOSICAO OSINT',M,ALT-72,9,C.fraco);
  txtDir('GERADO EM',LAT-M,ALT-56,8,C.fraco);
  txtDir(carimbo,LAT-M,ALT-70,9,C.creme);
  lin(M,ALT-88,LAT-M,ALT-88,C.brasa,1);
  y=ALT-118;
 };
 const paginaNova=()=>{nova();cabecalho();};
 const espaco=h=>{if(y-h<68)paginaNova();};
 const secao=t=>{espaco(40);txt(t,M,y,9.5,C.brasa,'F2');lin(M,y-9,LAT-M,y-9,C.linha,0.5);y-=26;};
 cabecalho();
 const yAlvo=y;
 txt('ALVO',M,yAlvo,8,C.fraco);
 const colX=LAT-M-215;
 const info=[['TIPO','e-mail'],['ORIGEM',String(meta.pais||'BR')],['FONTES',(meta.executadas==null?fontes.length:meta.executadas)+'/'+(meta.planejadas==null?fontes.length:meta.planejadas)],['SUBREQUESTS',String(meta.subrequests||0)],['JOB',String(meta.job_id||'-')]];
 let sy=yAlvo;
 for(const par of info){txt(par[0],colX,sy,7.5,C.fraco);txtDir(String(par[1]),LAT-M,sy,9,C.creme);sy-=16;}
 y=yAlvo-20;
 for(const l of quebrar(alvo,15,330)){txt(l,M,y,15,C.creme,'F2');y-=19;}
 y-=8;
 const cardTop=y,cardH=100;
 ret(M,cardTop-cardH,270,cardH,C.painel);
 lin(M,cardTop-cardH,M+270,cardTop-cardH,C.linha,0.6);
 lin(M,cardTop,M+270,cardTop,C.linha,0.6);
 lin(M,cardTop-cardH,M,cardTop,C.linha,0.6);
 lin(M+270,cardTop-cardH,M+270,cardTop,C.linha,0.6);
 txt('RISCO DE EXPOSICAO',M+16,cardTop-24,8,C.fraco);
 txt(String(valor),M+16,cardTop-64,36,corScore,'F2');
 txt('/100',M+16+largura(String(valor),36)+10,cardTop-64,12,C.fraco);
 txt(nivel,M+16,cardTop-86,11,corScore,'F2');
 if(score.parcial)txt('PARCIAL',M+16+largura(nivel,11)+14,cardTop-86,9,C.ambar,'F2');
 y=cardTop-cardH-16;
 if((score.motivos||[]).length){
  txt('SINAIS CONSIDERADOS NO INDICE',M,y,8,C.fraco);y-=14;
  for(const m of score.motivos){for(const l of quebrar(m,9.5,LAT-M*2)){espaco(13);txt('- '+l,M+8,y,9.5,C.creme);y-=13;}}
 }
 secao('FONTES CONSULTADAS');
 const cols=[M,M+150,M+235,M+300];
 txt('FONTE',cols[0],y,7.5,C.fraco);txt('STATUS',cols[1],y,7.5,C.fraco);txt('TEMPO',cols[2],y,7.5,C.fraco);txt('DETALHE',cols[3],y,7.5,C.fraco);
 y-=6;lin(M,y,LAT-M,y,C.linha,0.5);y-=13;
 for(const f of fontes){
  espaco(34);
  const falhou=f.status!=='ok';
  txt(tituloDe(f.id),cols[0],y,8.5,C.creme);
  txt(falhou?'FALHOU':'OK',cols[1],y,8.5,falhou?C.vermelho:C.verde,'F2');
  txt(f.ms==null?'-':f.ms+' ms',cols[2],y,8.5,C.fraco);
  const detalhe=falhou?(f.erro||f.status||'erro'):(f.provenance||'respondido');
  const linhas=quebrar(detalhe,8.5,LAT-M-cols[3]);
  txt(linhas[0],cols[3],y,8.5,C.fraco);
  y-=12;
  for(let i=1;i<linhas.length;i++){txt(linhas[i],cols[3],y,8.5,C.fraco);y-=11;}
  y-=5;
 }
 secao('ACHADOS POR FONTE');
 for(const g of grupos){
  espaco(44);
  const falhou=g.fonte.status!=='ok';
  txt(tituloDe(g.fonte.id),M,y,9,falhou?C.vermelho:C.creme,'F2');
  txtDir(falhou?'FALHOU':'OK',LAT-M,y,8,falhou?C.vermelho:C.verde,'F2');
  y-=14;
  for(const par of g.linhas){
   const rotulo=par[0]?par[0]+': ':'';
   for(const l of quebrar(rotulo+par[1],8.5,LAT-M*2-14)){espaco(12);txt(l,M+8,y,8.5,C.creme);y-=11.5;}
  }
  y-=8;
 }
 nova();
 const total=paginas.length;
 for(let i=0;i<total;i++){
  paginas[i]+=C.fraco+' rg 0.45 0.45 0.42 RG 0.5 w '+M+' 42 m '+(LAT-M)+' 42 l S\n';
  paginas[i]+=C.fraco+' rg BT /F1 7.5 Tf 1 0 0 1 '+M+' 28 Tm (INFOC.HACKER - RELATORIO DE EXPOSICAO) Tj ET\n';
  const marca='pagina '+(i+1)+'/'+total;
  paginas[i]+=C.fraco+' rg BT /F1 7.5 Tf 1 0 0 1 '+(LAT-M-largura(marca,7.5)).toFixed(1)+' 28 Tm ('+textoPdf(marca)+') Tj ET\n';
 }
 return arquivo(paginas);
}
function arquivo(paginas){
 const objs=[];
 objs[1]='<< /Type /Catalog /Pages 2 0 R >>';
 objs[2]='<< /Type /Pages /Kids [] /Count 0 >>';
 objs[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
 objs[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
 const kids=[];let id=5;
 for(const p of paginas){
  objs[id]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+LAT+' '+ALT+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+(id+1)+' 0 R >>';
  objs[id+1]='<< /Length '+p.length+' >>\nstream\n'+p+'endstream';
  kids.push(id+' 0 R');id+=2;
 }
 objs[2]='<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+kids.length+' >>';
 let out='%PDF-1.4\n%'+String.fromCharCode(226,227,207,211)+'\n';
 const offsets=[];
 for(let i=1;i<objs.length;i++){offsets[i]=out.length;out+=i+' 0 obj\n'+objs[i]+'\nendobj\n';}
 const xref=out.length;
 out+='xref\n0 '+objs.length+'\n0000000000 65535 f \n';
 for(let i=1;i<objs.length;i++)out+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
 out+='trailer\n<< /Size '+objs.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 const bytes=new Uint8Array(out.length);
 for(let i=0;i<out.length;i++)bytes[i]=out.charCodeAt(i)&255;
 return bytes;
}
window.OSINTRelatorio={pdf:relatorio};
})();
