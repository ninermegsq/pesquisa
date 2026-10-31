import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const source=(await readFile(new URL('../src/lib/token-guard.mjs',import.meta.url),'utf8')).replace(/^import .*\n/,'').replace('export class TokenGuard','class TokenGuard');
const TokenGuard=new Function('DurableObject',source+';return TokenGuard;')(class{constructor(ctx){this.ctx=ctx;}});
const db=new DatabaseSync(':memory:');let alarm;
const ctx={storage:{sql:{exec(sql,...args){const statement=db.prepare(sql);const rows=/^SELECT/i.test(sql)?statement.all(...args):[];const changes=/^SELECT/i.test(sql)?0:statement.run(...args).changes;return {rowsWritten:changes,toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];}};}},setAlarm:async value=>{alarm=value;}}};
const originalNow=Date.now;let now=Date.UTC(2026,9,30);Date.now=()=>now;
try{
 const guard=new TokenGuard(ctx,{});
 for(let hour=0;hour<6;hour++){
  now=Date.UTC(2026,9,30,hour);
  for(let i=0;i<10;i++){const r=await guard.authorize(`n-${hour}-${i}`,Math.floor(now/1000)+60);assert.equal(r.valid,true);assert.equal(r.retryAfter,0);}
  const r=await guard.authorize(`hour-exceeded-${hour}`,Math.floor(now/1000)+60);assert.equal(r.retryAfter,3600);
 }
 now=Date.UTC(2026,9,30,6);const r=await guard.authorize('day-exceeded',Math.floor(now/1000)+60);assert.equal(r.retryAfter,64800);
 now=Date.UTC(2026,9,31);const reset=await guard.authorize('reset',Math.floor(now/1000)+60);assert.equal(reset.retryAfter,0);assert.equal(reset.dayCount,1);
 assert.equal((await guard.authorize('reset',Math.floor(now/1000)+60)).valid,false);
 assert.ok(alarm>now);
 console.log(JSON.stringify({scope:'actual quota class with Node SQLite and controlled clock',hourLimit:10,dayLimit:60,dailyRetryAfter:64800,dayReset:true,replayRejected:true}));
}finally{Date.now=originalNow;db.close();}
