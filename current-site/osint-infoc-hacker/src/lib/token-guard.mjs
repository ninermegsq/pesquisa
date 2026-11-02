import {DurableObject} from 'cloudflare:workers';
// One object per hashed IP. Synchronous SQL coordinates replay and scan quotas.
export class TokenGuard extends DurableObject {
 constructor(ctx,env){
  super(ctx,env);
  this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS used (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
  this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS quotas (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
 }
 async authorize(nonce,exp){
  const now=Date.now();
  if(typeof nonce!=='string'||nonce.length>100||!Number.isFinite(exp)||(exp+1)*1000<=now||exp*1000>now+61000)return {valid:false};
  this.ctx.storage.sql.exec('DELETE FROM used WHERE expires <= ?',now);
  this.ctx.storage.sql.exec('DELETE FROM quotas WHERE expires <= ?',now);
  const inserted=this.ctx.storage.sql.exec('INSERT OR IGNORE INTO used (nonce,expires) VALUES (?,?)',nonce,(exp+1)*1000).rowsWritten;
  if(!inserted)return {valid:false};
  const hour=Math.floor(now/3600000),day=Math.floor(now/86400000);
  const count=key=>this.ctx.storage.sql.exec('SELECT count FROM quotas WHERE bucket = ?',key).toArray()[0]?.count||0;
  const h=count('h:'+hour),d=count('d:'+day);
  const retryAfter=h>=10?Math.ceil(((hour+1)*3600000-now)/1000):d>=60?Math.ceil(((day+1)*86400000-now)/1000):0;
  if(!retryAfter){
   this.ctx.storage.sql.exec('INSERT INTO quotas (bucket,count,expires) VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1','h:'+hour,1,(hour+1)*3600000);
   this.ctx.storage.sql.exec('INSERT INTO quotas (bucket,count,expires) VALUES (?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1','d:'+day,1,(day+1)*86400000);
  }
  await this.ctx.storage.setAlarm((exp+1)*1000);
  return {valid:true,retryAfter,hourCount:h+(retryAfter?0:1),dayCount:d+(retryAfter?0:1)};
 }
 async consume(nonce,exp){const result=await this.authorize(nonce,exp);return result.valid===true&&!result.retryAfter;}
 async alarm(){
  const now=Date.now();this.ctx.storage.sql.exec('DELETE FROM used WHERE expires <= ?',now);this.ctx.storage.sql.exec('DELETE FROM quotas WHERE expires <= ?',now);
  const a=this.ctx.storage.sql.exec('SELECT MIN(expires) AS expires FROM used').one().expires;
  const b=this.ctx.storage.sql.exec('SELECT MIN(expires) AS expires FROM quotas').one().expires;
  const next=Math.min(a||Infinity,b||Infinity);if(Number.isFinite(next))await this.ctx.storage.setAlarm(next);
 }
}
