const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium,devices}=require('playwright');
const current=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),legacyRoot=process.env.LEGACY_UI_ROOT;
if(!legacyRoot)throw Error('Set LEGACY_UI_ROOT to the deployed v15.0.2 index.html directory');
const legacy=fs.readFileSync(path.join(legacyRoot,'index.html'),'utf8'),out=path.resolve(process.env.TEST_OUTPUT_DIR||path.join(__dirname,'../test-artifacts'));fs.mkdirSync(out,{recursive:true});let old=true;
const server=http.createServer((_,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(old?legacy:current);});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),errors=[];try{
 for(const device of [{name:'desktop',viewport:{width:1440,height:1050}},{...devices['Pixel 7'],name:'mobile'}]){
  old=true;const context=await browser.newContext(device),page=await context.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#profile-form').waitFor();
  const before=await page.evaluate(async()=>{state=Core.createCareer(DB,{...Core.clone(DB.profile.defaults),name:'이전 자동저장 선수',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))},'domestic','kr2-0');while(!state.player.history.length)Core.advance(DB,state);state.matchPresentation=null;state.careerStories.pending=null;screen='dashboard';render();if(!await persist(true))throw Error('Old autosave failed');return JSON.parse(JSON.stringify({date:state.date,history:state.player.history,stats:state.player.stats,contract:state.player.contract,fixtures:state.fixtures}));});
  old=false;await page.reload();await page.waitForFunction(()=>!storageLoading&&state?.player.name==='이전 자동저장 선수');
  assert.deepEqual(await page.evaluate(()=>({date:state.date,history:state.player.history,stats:state.player.stats,contract:state.player.contract,fixtures:state.fixtures})),before);assert.equal(await page.evaluate(()=>validateSave(envelope())),true);assert.equal(await page.locator('#profile-form').count(),0);
  await page.screenshot({path:path.join(out,device.name+'-autosave-upgrade.png'),fullPage:false});
  // Exercise IndexedDB on its own and then the compressed local backup on its own.
  await page.evaluate(async()=>{await persist(true);localStorage.removeItem(DEFAULT_DB.meta.storageKey);localStorage.removeItem(DEFAULT_DB.storageRules.backupKey);});await page.reload();await page.waitForFunction(()=>!storageLoading&&state?.player.name==='이전 자동저장 선수');
  // A malformed newest record must restore the independent IndexedDB backup,
  // even when this full career is too large for localStorage.
  await page.evaluate(async()=>{await persist(true);localStorage.removeItem(DEFAULT_DB.meta.storageKey);localStorage.removeItem(DEFAULT_DB.storageRules.backupKey);await careerStorageOperation('put',{encoding:'json',payload:new Blob(['{"broken":true}']),savedAt:Date.now()+1});persist=async()=>true;});await page.reload();await page.waitForFunction(()=>!storageLoading&&state?.player.name==='이전 자동저장 선수');
  assert.deepEqual(await page.evaluate(()=>({date:state.date,history:state.player.history,stats:state.player.stats,contract:state.player.contract,fixtures:state.fixtures})),before);
  await context.close();console.log(device.name+': actual v15 autosave migration, unchanged records, IndexedDB-only and malformed-newest backup recovery passed');
 }assert.deepEqual(errors,[]);console.log('Browser errors: 0');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
