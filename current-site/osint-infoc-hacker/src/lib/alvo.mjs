const RE_EMAIL=/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const RE_DOM=/^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i;
const RE_IP4=/^(\d{1,3}\.){3}\d{1,3}$/;
const RE_IP6=/^[0-9a-f:]+$/i;
const so=d=>String(d??'').replace(/\D/g,'');

export function cpfOk(v){
  const c=so(v); if(c.length!==11||/^(\d)\1{10}$/.test(c)) return false;
  for(let t=9;t<11;t++){let s=0;for(let i=0;i<t;i++)s+=+c[i]*(t+1-i);
    if((s*10)%11%10!==+c[t])return false;} return true;
}
export function cnpjOk(v){
  const c=so(v); if(c.length!==14||/^(\d)\1{13}$/.test(c)) return false;
  const w1=[5,4,3,2,9,8,7,6,5,4,3,2],w2=[6,...w1];
  const dv=(arr,w)=>{const s=arr.reduce((a,d,i)=>a+d*w[i],0);const r=s%11;return r<2?0:11-r;};
  const d1=dv(c.slice(0,12).split('').map(Number),w1);
  const d2=dv([...c.slice(0,12).split('').map(Number),d1],w2);
  return +c[12]===d1 && +c[13]===d2;
}
export function detectar(bruto){
  const v=String(bruto??'').trim();
  if(RE_EMAIL.test(v)) return {tipo:'email',valor:v.toLowerCase()};
  if(RE_IP4.test(v)) return {tipo:'ip',valor:v};
  if(v.includes(':')&&RE_IP6.test(v)) return {tipo:'ip',valor:v};
  if(cnpjOk(v)) return {tipo:'cnpj',valor:so(v)};
  if(cpfOk(v)) return {tipo:'cpf',valor:so(v)};
  const d=so(v);
  if(d.length>=10&&d.length<=13&&!v.includes('@')) return {tipo:'telefone',valor:d};
  if(RE_DOM.test(v)) return {tipo:'dominio',valor:v.toLowerCase().replace(/^www\./,'')};
  if(v.length>=4 && /^[\p{L}][\p{L} .'-]+\s+[\p{L} .'-]+$/u.test(v)) return {tipo:'nome',valor:v.replace(/\s+/g,' ')};
  throw new Error('Alvo não reconhecido. Use e-mail, domínio, IP, CNPJ, CPF, telefone ou nome.');
}
