import assert from 'node:assert/strict';
import {aplicarStats,statsDe} from '../scripts/stats.mjs';
import {REGISTRY} from '../src/sources/registry.mjs';

const html='<div class="trust-row" data-stats="{{STATS_JSON}}"><b id="stat-total">{{STATS_TOTAL}}</b><b id="stat-auto">{{STATS_EMAIL}}</b><b id="stat-cats">{{STATS_CATEGORIAS}}</b><b id="stat-keys">{{STATS_KEYS}}</b></div>';
const out=aplicarStats(html,REGISTRY);
const m=out.match(/data-stats="([^"]*)"/);
assert.ok(m,'data-stats ausente apos aplicarStats');
const decodeAttr=v=>v.replace(/&quot;/g,'"').replace(/&#34;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const stats=JSON.parse(decodeAttr(m[1]));
assert.deepEqual(stats,{total:32,email:13,categorias:8,keys:0});
assert.ok(!out.includes('{{STATS_'));
const out2=aplicarStats(out,REGISTRY);
assert.equal(out2,out,'aplicarStats nao e idempotente');
assert.deepEqual(statsDe(REGISTRY),{total:32,email:13,categorias:8,keys:0});
assert.deepEqual(JSON.parse(decodeAttr(m[1])),{total:32,email:13,categorias:8,keys:0});
console.log(JSON.stringify({ok:true,stats}));
