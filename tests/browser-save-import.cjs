const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {chromium,devices}=require('playwright');
const source=path.join(__dirname,'../index.html');
const output=path.resolve(process.env.TEST_OUTPUT_DIR||path.join(__dirname,'../test-artifacts'));
fs.mkdirSync(output,{recursive:true});
const section=(html,id)=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1];
const server=http.createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fs.readFileSync(source));});
async function importFile(page,file,name){
  await page.locator('#save-input').setInputFiles(file);
  await page.waitForFunction(expected=>!storageLoading&&state?.player.name===expected&&document.getElementById('save-input').value===''&&document.querySelector('#toast-root')?.textContent.includes(DB.ui.labels.importDone),name,{timeout:30000});
  assert.equal(await page.evaluate(()=>validateSave(envelope())),true);
  assert.equal(await page.locator('#save-input').inputValue(),'');
}
async function exportFile(page,file){
  const wait=page.waitForEvent('download');await page.locator('[data-action="export"]').click();
  const download=await wait;await download.saveAs(file);assert.ok(fs.statSync(file).size>0);
}
async function shirtMetrics(page,name){
  if(await page.locator('#profile-displayName').count())await page.locator('#profile-displayName').fill(name);
  else await page.evaluate(value=>{state.player.displayName=value;render();},name);
  return page.locator('.shirt-name').evaluate(element=>{const box=element.getBBox();return {text:element.textContent,width:box.width,center:box.x+box.width/2,font:parseFloat(getComputedStyle(element).fontSize),textLength:element.getAttribute('textLength'),anchor:element.getAttribute('text-anchor'),x:element.getAttribute('x')};});
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--no-first-run']});
  const errors=[];
  try{
    const targets=[{name:'desktop',viewport:{width:1440,height:1050}},{...devices['Pixel 7'],name:'mobile'}];
    for(const device of targets.filter(device=>!process.env.TEST_DEVICE||device.name===process.env.TEST_DEVICE)){
      const context=await browser.newContext({...device,acceptDownloads:true});const page=await context.newPage();
      page.on('pageerror',error=>errors.push(device.name+': '+error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#profile-form');
      await page.locator('#profile-name').fill('불러오기 '+device.name);await page.locator('#profile-displayName').fill('김');
      await page.locator('#begin-career').click();await page.locator('[data-action="personality-next"]').click();await page.locator('[data-action="sign"]').first().click();await page.waitForSelector('.sidebar');
      const short=await shirtMetrics(page,'김'),normal=await shirtMetrics(page,'김민수'),long=await shirtMetrics(page,'알렉산더아놀드프란체스코');
      assert.equal(short.textLength,null);assert.equal(short.font,normal.font);assert.ok(short.width<normal.width);
      // Glyph ink may extend beyond its advance width; keep it inside the 58px torso.
      for(const result of [short,normal,long]){assert.equal(result.anchor,'middle');assert.equal(result.x,'60');assert.ok(Math.abs(result.center-60)<1,JSON.stringify(result));assert.ok(result.width<=57,JSON.stringify(result));}
      assert.ok(long.font<short.font);console.log(device.name,'shirt natural width and center',JSON.stringify({short,normal,long}));
      await page.evaluate(()=>{state.player.displayName='김';render();});
      assert.equal(await page.evaluate(()=>validateSave(envelope())),true);
      if(device.name==='desktop'){
        // Play an actual scheduled match and retain its live presentation in a downloaded save.
        for(let step=0;step<40&&!await page.evaluate(()=>Boolean(state.matchPresentation));step++){
          await page.locator('[data-action="advance"]').click();await page.waitForFunction(()=>!matchLoading);
        }
        assert.ok(await page.evaluate(()=>state.matchPresentation));
        assert.ok(await page.evaluate(()=>state.player.history.length>0));
        await page.locator('[data-action="match-locker"]').click();await page.locator('[data-action="match-start"]').click();await page.locator('[data-action="match-pause"]').click();
        await page.evaluate(()=>{clearMatchTimer();state.matchPresentation=null;screen='dashboard';render();});
      }
      const file=path.join(output,device.name+'-export.json');await exportFile(page,file);
      const expected=await page.evaluate(()=>({name:state.player.name,date:state.date,club:state.player.club,history:JSON.stringify(state.player.history),stats:JSON.stringify(state.player.stats),contract:JSON.stringify(state.player.contract)}));
      await page.evaluate(()=>{state.player.name='변경한 이름';render();});await importFile(page,file,expected.name);
      assert.deepEqual(await page.evaluate(()=>({name:state.player.name,date:state.date,club:state.player.club,history:JSON.stringify(state.player.history),stats:JSON.stringify(state.player.stats),contract:JSON.stringify(state.player.contract)})),expected);
      await page.evaluate(()=>{state=null;draft=null;render();});await page.waitForSelector('#profile-form');
      await importFile(page,file,expected.name);await page.waitForSelector('.sidebar');
      await page.reload();await page.waitForSelector('.sidebar');assert.equal(await page.evaluate(()=>state.player.name),expected.name);
      assert.equal(await page.evaluate(()=>JSON.stringify(state.player.history)),expected.history);
      // Invalid input must show an error without replacing the current career.
      const broken=JSON.parse(fs.readFileSync(file,'utf8'));broken.state.player.contract.weekly=-1;const bad=path.join(output,device.name+'-invalid.json');fs.writeFileSync(bad,JSON.stringify(broken));
      await page.locator('#save-input').setInputFiles(bad);await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('불러오지 못했습니다'));
      assert.equal(await page.evaluate(()=>state.player.name),expected.name);assert.equal(await page.evaluate(()=>JSON.stringify(state.player.contract)),expected.contract);
      await page.screenshot({path:path.join(output,device.name+'.png'),fullPage:true});
      console.log(device.name,'file import/export, record preservation, reload and invalid-file protection passed');
      if(device.name==='desktop'&&process.env.LEGACY_FIXTURE_DIR){
        // Generate real exports using the retained v5-v9 engines and import their original DBs.
        for(const version of [5,6,7,8,9]){
          const legacySource=path.join(process.env.LEGACY_FIXTURE_DIR,`management-v${version}.html`);const html=fs.readFileSync(legacySource,'utf8');
          const db=JSON.parse(section(html,'game-db')),runtime=vm.createContext({});vm.runInContext(section(html,'game-engine')+';globalThis.Core=FootballCore;',runtime);const core=runtime.Core;
          const profile={...core.clone(db.profile.defaults),name:'이전 버전 '+version,stats:Object.fromEntries(db.attributes.map(a=>[a.id,a.initial]))};const offer=core.startingOffers(db,profile)[0];const state=core.createCareer(db,profile,offer.route.id,offer.club.id);
          const legacyFile=path.join(output,`v${version}-save.json`);fs.writeFileSync(legacyFile,JSON.stringify({schema:db.meta.schema,db,state}));
          await importFile(page,legacyFile,profile.name);assert.equal(await page.evaluate(()=>state.schema),await page.evaluate(()=>DEFAULT_DB.meta.schema));
          console.log('v'+version,'original save imported');
        }
      }
      await context.close();
    }
    assert.deepEqual(errors,[]);console.log('PASS: selected browser imports, record preservation and centered jersey names; no page errors');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
