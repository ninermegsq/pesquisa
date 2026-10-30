import {DurableObject} from 'cloudflare:workers';
// One object per hashed IP. SQL uniqueness makes replay rejection atomic.
// Nonces contain no target, credential, or raw IP; KV remains rate-limit only.
export class TokenGuard extends DurableObject {
 constructor(ctx,env){
   super(ctx,env);
   this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS used (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
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
}
