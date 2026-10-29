const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const artifacts=process.env.ARTIFACT_DIR||'/tmp/cinematic-check';fs.mkdirSync(artifacts,{recursive:true});
const baseURL=process.env.BASE_URL||'http://127.0.0.1:8888';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://challenges.cloudflare.com/**',route=>route.fulfill({contentType:'application/javascript',body:`window.turnstile={render(box,o){window.testWidget=o;setTimeout(()=>o.callback('test-widget-token'),250);return 'test-id';},remove(){},reset(){}};`}));
 await page.route('**/.netlify/functions/token',route=>route.fulfill({json:{success:true,token:'signed-test-token'}}));
 let scanMode='success',scanCalls=0;
 await page.route('**/.netlify/functions/scan',async route=>{
  scanCalls++;
  await new Promise(r=>setTimeout(r,1200));
  await route.fulfill(scanMode==='success'?{json:{breaches:[{name:'Fonte simulada',year:'2024',data:'E-mail',records:10,passwordRisk:'não informado'}],availability:{xon:true,dns:true,github:true,keybase:false,gravatar:true},dns:{available:true,hasSPF:true,dmarc:true},github:{count:0,users:[]},gravatar:false}}:{status:503,json:{error:'Fonte temporariamente indisponível.'}});
 });
 await page.goto(baseURL);
 await page.waitForFunction(()=>window.CinematicOrb);
 await page.screenshot({path:path.join(artifacts,'cinematic-idle-desktop.png'),fullPage:true});
 await page.locator('#email').fill('invalid');await page.locator('#scan-btn').click();
 assert.match(await page.locator('#form-error').textContent(),/inválido/);assert.equal(scanCalls,0);
 await page.locator('#email').fill('demo@example.com');
 await page.evaluate(()=>{window.phases=[];new MutationObserver(()=>window.phases.push(document.querySelector('#scan-form').dataset.phase)).observe(document.querySelector('#scan-form'),{attributes:true,attributeFilter:['data-phase']});});
 await page.locator('#scan-btn').click();
 await page.waitForFunction(()=>document.querySelector('#scan-form').dataset.phase==='think');
 await page.screenshot({path:path.join(artifacts,'cinematic-thinking-desktop.png'),fullPage:true});
 await page.waitForFunction(()=>document.querySelector('#scan-form').dataset.phase==='answered',null,{timeout:15000});
 await page.waitForSelector('#stage .scorecard');
 await page.screenshot({path:path.join(artifacts,'cinematic-result-desktop.png'),fullPage:true});
 const phases=await page.evaluate(()=>window.phases);
 for(const p of ['launch','assemble','think','resolve','condense','unfold','answered'])assert.ok(phases.includes(p),p);
 assert.equal(await page.locator('.acc[open]').count(),0);
 await page.locator('.acc').first().locator('summary').click();assert.equal(await page.locator('.acc[open]').count(),1);
 await page.locator('.mo-reset').click();
 await page.waitForFunction(()=>document.querySelector('#scan-form').dataset.phase==='idle');
 assert.equal(await page.locator('#email').inputValue(),'');assert.equal(await page.locator('#stage .scorecard').count(),0);
 scanMode='error';await page.locator('#email').fill('demo@example.com');await page.locator('#scan-btn').click();
 await page.waitForFunction(()=>document.querySelector('#scan-form').dataset.result==='error');
 assert.match(await page.locator('#form-error').textContent(),/indisponível/);
 assert.equal(await page.locator('#scan-btn').isDisabled(),false);
 await page.locator('#scan-btn').click();await page.keyboard.press('Escape');
 await page.waitForFunction(()=>!document.querySelector('#scan-btn').disabled);
 assert.equal(await page.locator('#stage .scorecard').count(),0);
 // A denied Turnstile verification must never start the scanner.
 await page.reload();await page.waitForFunction(()=>window.CinematicOrb);
 await page.unroute('**/.netlify/functions/token');
 await page.route('**/.netlify/functions/token',route=>route.fulfill({status:401,json:{success:false,error:'Verificação recusada.'}}));
 const beforeDenied=scanCalls;
 await page.locator('#email').fill('demo@example.com');await page.locator('#scan-btn').click();
 await page.waitForFunction(()=>document.querySelector('#scan-form').dataset.result==='error');
 assert.equal(scanCalls,beforeDenied);assert.match(await page.locator('#form-error').textContent(),/recusada/);
 await page.unroute('**/.netlify/functions/token');
 await page.route('**/.netlify/functions/token',route=>route.fulfill({json:{success:true,token:'signed-test-token'}}));
 // Responsive geometry and keyboard focus in the same real DOM.
 for(const width of [375,768,1024,1440]){
  await page.setViewportSize({width,height:900});await page.reload();await page.waitForFunction(()=>window.CinematicOrb);
  const geom=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,rect:document.querySelector('.mo-actor').getBoundingClientRect().toJSON()}));
  assert.equal(geom.overflow,false,`overflow ${width}`);assert.ok(geom.rect.x>=0 && geom.rect.right<=width,`input fits ${width}`);
  if(width===375)await page.screenshot({path:path.join(artifacts,'cinematic-idle-mobile.png'),fullPage:true});
 }
 await page.emulateMedia({reducedMotion:'reduce'});scanMode='success';
 await page.locator('#email').fill('demo@example.com');await page.locator('#scan-btn').click();
 await page.waitForFunction(()=>document.querySelector('#scan-form').dataset.phase==='answered',null,{timeout:15000});
 assert.equal(await page.locator('#scan-btn').isDisabled(),false);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,phases,widths:[375,768,1024,1440],reducedMotion:true,errors},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
