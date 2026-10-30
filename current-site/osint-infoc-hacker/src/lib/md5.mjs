export function md5(str){
  const s=new TextEncoder().encode(str),len=s.length,pad=((len+8>>>6)+1)*64,b=new Uint8Array(pad);
  b.set(s);b[len]=128;
  const bits=BigInt(len)*8n;for(let i=0;i<8;i++)b[pad-8+i]=Number((bits>>BigInt(i*8))&255n);
  const sh=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  const K=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*2**32)>>>0);
  let A=0x67452301,B=0xefcdab89,C=0x98badcfe,D=0x10325476;
  for(let off=0;off<pad;off+=64){
    const M=Array.from({length:16},(_,i)=>(b[off+i*4]|b[off+i*4+1]<<8|b[off+i*4+2]<<16|b[off+i*4+3]<<24)>>>0);
    let a=A,bb=B,c=C,d=D;
    for(let i=0;i<64;i++){
      let f,g,rot;
      if(i<16){f=(bb&c)|(~bb&d);g=i;rot=sh[i%4];}
      else if(i<32){f=(d&bb)|(~d&c);g=(5*i+1)%16;rot=sh[4+i%4];}
      else if(i<48){f=bb^c^d;g=(3*i+5)%16;rot=sh[8+i%4];}
      else{f=c^(bb|~d);g=(7*i)%16;rot=sh[12+i%4];}
      const sum=(a+f+K[i]+M[g])>>>0;
      const r=((sum<<rot)|(sum>>>(32-rot)))>>>0;
      [a,bb,c,d]=[d,(bb+r)>>>0,bb,c];
    }
    A=(A+a)>>>0;B=(B+bb)>>>0;C=(C+c)>>>0;D=(D+d)>>>0;
  }
  return [A,B,C,D].map(v=>[0,1,2,3].map(i=>((v>>>i*8)&255).toString(16).padStart(2,'0')).join('')).join('');
}
