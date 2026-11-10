import {DurableObject} from 'cloudflare:workers';
// One object per hashed IP. SQL uniqueness makes replay rejection atomic.
// Nonces contain no target, credential, or raw IP; KV remains rate-limit only.
//
// The schema comes from migrations/*.sql (applied in order, once each) and the
// job history lives here as well: only counts and source ids are stored, never
// the target, the e-mail or the IP.
import {MIGRACOES} from './migrations.mjs';
import {aplicarMigracoes} from './sql-migrations.mjs';

const RETENCAO_MS=7*24*60*60*1000;
const JANELA_MAX_MS=30*24*60*60*1000;

export class TokenGuard extends DurableObject {
 constructor(ctx,env){
   super(ctx,env);
   this.versoesAplicadas=aplicarMigracoes(this.ctx.storage.sql,MIGRACOES);
 }
 async consume(nonce,exp){
   const now=Date.now();
   if(typeof nonce!=='string'||nonce.length>100||!Number.isFinite(exp)||(exp+1)*1000<=now||exp*1000>now+61000)return false;
   this.ctx.storage.sql.exec('DELETE FROM used WHERE expires <= ?',now);
   const inserted=this.ctx.storage.sql.exec('INSERT OR IGNORE INTO used (nonce,expires) VALUES (?,?)',nonce,(exp+1)*1000).rowsWritten;
   if(!inserted)return false;
   await this.ctx.storage.setAlarm((exp+1)*1000);
   return true;
 }
 async alarm(){
   this.ctx.storage.sql.exec('DELETE FROM used WHERE expires <= ?',Date.now());
   const next=this.ctx.storage.sql.exec('SELECT MIN(expires) AS expires FROM used').one().expires;
   if(next)await this.ctx.storage.setAlarm(next);
 }
 // Registra o resultado de um scan. Guarda contagens e ids de fonte: nada de
 // alvo, e-mail ou IP. Retencao de 7 dias.
 async registrarJob(jobId,fontes=[],resumo={}){
   if(typeof jobId!=='string'||!jobId||jobId.length>64)return false;
   const db=this.ctx.storage.sql;
   const agora=Date.now();
   const lista=Array.isArray(fontes)?fontes:[];
   const ok=Number.isFinite(Number(resumo.ok))?Number(resumo.ok):0;
   const falhas=Number.isFinite(Number(resumo.falhas))?Number(resumo.falhas):lista.length-ok;
   const parcial=resumo.parcial?1:0;
   db.exec('INSERT OR REPLACE INTO jobs (job_id,criado_em,escopo,status,total_fontes,ok_fontes,falhas,parcial) VALUES (?,?,?,?,?,?,?,?)',
     jobId,agora,String(resumo.escopo||'visitante'),parcial?'parcial':'completo',lista.length,ok,falhas,parcial);
   for(const fonte of lista){
     if(!fonte||typeof fonte.id!=='string'||!fonte.id)continue;
     db.exec('INSERT OR REPLACE INTO job_fontes (job_id,fonte,status,erro_codigo,ms) VALUES (?,?,?,?,?)',
       jobId,fonte.id.slice(0,64),String(fonte.status||'erro'),
       fonte.erro_codigo?String(fonte.erro_codigo).slice(0,32):null,Number(fonte.ms)||0);
   }
   db.exec('DELETE FROM jobs WHERE criado_em < ?',agora-RETENCAO_MS);
   db.exec('DELETE FROM job_fontes WHERE job_id NOT IN (SELECT job_id FROM jobs)');
   return true;
 }
 // Painel de saude: contagens agregadas, sem alvo e sem credencial.
 async saude(janelaMs=86400000){
   const db=this.ctx.storage.sql;
   const janela=Math.max(60000,Math.min(Number(janelaMs)||86400000,JANELA_MAX_MS));
   const desde=Date.now()-janela;
   const schema=db.exec('SELECT versao,nome FROM schema_meta ORDER BY versao').all();
   const totals=db.exec('SELECT COUNT(*) AS total, SUM(CASE WHEN parcial = 1 THEN 1 ELSE 0 END) AS parciais FROM jobs WHERE criado_em >= ?',desde).one();
   const linhas=db.exec('SELECT fonte,status,erro_codigo,COUNT(*) AS n FROM job_fontes GROUP BY fonte,status,erro_codigo').all();
   const porFonte={};
   for(const linha of linhas){
     const id=String(linha.fonte||'');
     if(!id)continue;
     const item=porFonte[id]||(porFonte[id]={id,ok:0,falhas:0,codigos:{}});
     const n=Number(linha.n)||0;
     if(linha.status==='ok')item.ok+=n;
     else{
       item.falhas+=n;
       const codigo=linha.erro_codigo?String(linha.erro_codigo):'erro';
       item.codigos[codigo]=(item.codigos[codigo]||0)+n;
     }
   }
   const total=Number(totals?.total)||0;
   const parciais=Number(totals?.parciais)||0;
   return {
     janela_ms:janela,
     schema:(schema||[]).map(linha=>({versao:Number(linha.versao)||0,nome:String(linha.nome||'')})),
     versao_migracoes:MIGRACOES.length,
     jobs:{total,parciais,completos:total-parciais},
     fontes:Object.values(porFonte).sort((a,b)=>a.id.localeCompare(b.id))
   };
 }
}
