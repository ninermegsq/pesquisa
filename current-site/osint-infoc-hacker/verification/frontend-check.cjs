const path=require('node:path');const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');const {webcrypto}=require('node:crypto');
(async()=>{
const elements=new Map(),created=[],downloads=[];
class Element{constructor(){this.listeners={};this.classList={add(){},remove(){}};this.dataset={};this.style={setProperty(){}};this.clientHeight=600;this.hidden=false;this.value='';this.textContent='';this.innerHTML='';this.childNodes=[];}addEventListener(n,cb){this.listeners[n]=cb;}append(){}remove(){}replaceChildren(){}setAttribute(){}removeAttribute(){}toggleAttribute(){}focus(){}click(){}getContext(){return null;}}
const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const document={getElementById:get,createElement:()=>{const e=new Element();created.push(e);return e;},body:new Element(),head:new Element(),addEventListener(){},hidden:false};
const URL2=URL;URL2.createObjectURL=blob=>{downloads.push(blob);return 'blob:fixture';};URL2.revokeObjectURL=()=>{};
let errorMode=false;const report={alvo:{tipo:'email',valor:'fixture@example.invalid'},gerado_em:'2026-10-30T00:00:00Z',fontes:[{id:'xon',status:'ok',provenance:'fixture',timestamp:'2026-10-30T00:00:00Z',dados:{total:2,breaches:[{nome:'=formula'},{nome:'<script>'}]}}],score:{valor:18,nivel:'BAIXO',parcial:false,motivos:[]},meta:{executadas:1,planejadas:1},pivos:[],html:'<p>Fixture report</p>'};
const window={addEventListener(){},matchMedia:()=>({matches:true,addEventListener(){}}),turnstile:{render:(box,options)=>{options.callback('dummy');return 0;},remove(){}}};
const fetch=async(url,options)=>{if(errorMode)return Response.json({erro:'Mensagem correta'},{status:429});if(url==='/api/scan')return Response.json(report);if(url.includes('/token'))return Response.json(options?.method==='POST'?{token:'fixture'}:{siteKey:'fixture'});throw Error('Unexpected request '+url);};
const context=vm.createContext({document,window,fetch,Response,URL:URL2,Blob,crypto:webcrypto,TextEncoder,navigator:{clipboard:{writeText:async()=>{}}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},requestAnimationFrame(){},console});
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8'),context);
get('email').value='fixture@example.invalid';await vm.runInContext('scan({preventDefault(){}})',context);
assert.ok(created.some(e=>e.innerHTML.includes('DORKS PRONTOS')));
get('export-json').listeners.click();const json=JSON.parse(await downloads.pop().text());assert.equal(json.alvo.tipo,'email');assert.equal(json.fontes[0].provenance,'fixture');assert.equal(json.schemaVersion,2);assert.equal(json.email,undefined);
get('export-csv').listeners.click();const csv=await downloads.pop().text();assert.ok(csv.includes('"severidade"'));assert.ok(csv.includes("'=formula"));assert.ok(csv.includes('2026-10-30T00:00:00Z'));
errorMode=true;await assert.rejects(()=>vm.runInContext("getJson('/fixture')",context),/Mensagem correta/);
assert.equal(vm.runInContext('countFindings(current.data)',context),2);
assert.ok(vm.runInContext("csvCell(' =1+1')",context).includes("' =1+1"));
console.log(JSON.stringify({scope:'frontend VM; network and DOM simulated',jsonFullReport:true,csvSeverityAndProvenance:true,csvFormulaEscaped:true,dorksRestored:true,backendErrorDisplayed:true,findingsCount:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
