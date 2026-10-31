import {isIP} from 'node:net';
import {DDD} from '../data/ddd.mjs';
const RE_EMAIL=/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const RE_DOM=/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
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
  if(typeof bruto!=='string')throw new Error('Informe um alvo em texto.');
  const v=bruto.trim();
  if(!v||v.length>254||/[\x00-\x1f\x7f]/.test(v))throw new Error('Alvo vazio, muito longo ou inválido.');
  if(RE_EMAIL.test(v)) return {tipo:'email',valor:v.toLowerCase()};
  if(isIP(v))return {tipo:'ip',valor:v.toLowerCase()};
  if(RE_IP4.test(v)||v.includes(':'))throw new Error('Endereço IP inválido.');
  if(cnpjOk(v)) return {tipo:'cnpj',valor:so(v)};
  if(cpfOk(v)) return {tipo:'cpf',valor:so(v)};
  const d=so(v);
  if(/^[+\d(). -]+$/.test(v)){
    const nacional=d.length>11&&d.startsWith('55')?d.slice(2):d;
    if([10,11].includes(nacional.length)&&DDD[nacional.slice(0,2)]&&(d.length<=11||d.startsWith('55')))return {tipo:'telefone',valor:'55'+nacional};
  }
  if(RE_DOM.test(v)) return {tipo:'dominio',valor:v.toLowerCase().replace(/^www\./,'')};
  if(v.length>=4 && /^[\p{L}][\p{L} .'-]+\s+[\p{L} .'-]+$/u.test(v)) return {tipo:'nome',valor:v.replace(/\s+/g,' ')};
  throw new Error('Alvo não reconhecido. Use e-mail, domínio, IP, CNPJ, telefone brasileiro com DDD ou nome.');
}
