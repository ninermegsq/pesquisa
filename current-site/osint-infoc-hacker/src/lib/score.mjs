export function pontuar(res){
  let s=0;const motivos=[];let parcial=false;
  for(const r of res){
    if(r.status!=='ok'){parcial=true;continue;}
    const d=r.dados||{};
    if(r.id==='dns'&&d.dmarc==null)parcial=true;
    if(r.id==='xon'&&d.senhas?.disponivel===false)parcial=true;
    if(r.id==='xon'){
      if(d.total>0){s+=Math.min(d.total*9,45);motivos.push(`${d.total} breaches`);}
      const p=d.senhas?.textoPuro||0;
      if(p>0){s+=Math.min(p*4,16);motivos.push(`senha em texto puro em ${p}`);}
    }
    if(r.id==='hudsonrock'){
      if(d.infectado){s+=8;motivos.push('infostealer');}
      if((d.senhas||[]).length){s+=3;motivos.push('fragmentos de senha');}
    }
    if(r.id==='gravatar'&&d.existe){s+=4;motivos.push('gravatar público');}
    if(r.id==='dns'&&d.hasSPF===false){s+=6;motivos.push('SPF ausente');}
    if(r.id==='dns'&&d.dmarc===false){s+=7;motivos.push('DMARC ausente');}
    if(r.id==='internetdb'){s+=Math.min((d.vulns||[]).length*3,12);}
    if(r.id==='ceis'&&(d.total||0)>0){s+=8;motivos.push('sanção');}
    if(r.id==='emailrep'&&d.suspeito){s+=2;motivos.push('reputação suspeita');}
    if(r.id==='datajud'&&(d.total||0)>0){s+=Math.min(d.total*3,9);}
  }
  const valor=Math.max(0,Math.min(100,Math.round(s)));
  return {valor,nivel:res.length&&res.some(r=>r.status==='ok')?(valor>60?'CRITICO':valor>25?'MEDIO':'BAIXO'):'INCONCLUSIVO',parcial:parcial||!res.length,motivos};
}
