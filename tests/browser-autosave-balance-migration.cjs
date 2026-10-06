const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),cp=require('node:child_process'),assert=require('node:assert/strict'),{chromium,devices}=require('playwright');
const root=path.join(__dirname,'..'),current=fs.readFileSync(path.join(root,'index.html'),'utf8'),git=process.env.GIT_PATH||'git';
const historical=ref=>cp.execFileSync(git,['show',ref+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:10000000});
const legacy=historical('9d4b1ee'),broken=historical('47c9856');
const out=path.resolve(process.env.TEST_OUTPUT_DIR||path.join(root,'test-artifacts'));fs.mkdirSync(out,{recursive:true});
const server=http.createServer((request,response)=>{response.setHeader('Content-Type','text/html;charset=utf-8');response.setHeader('Cache-Control','no-store');response.end(request.url==='/legacy'?legacy:request.url==='/broken'?broken:current);});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),url='http://127.0.0.1:'+server.address().port,errors=[];
 try{for(const device of [{name:'desktop',viewport:{width:1440,height:1050}},{...devices['Pixel 7'],name:'mobile'}]){
  const context=await browser.newContext(device),page=await context.newPage();page.setDefaultTimeout(120000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url+'/legacy');await page.waitForFunction(()=>!storageLoading);
  const before=await page.evaluate(async()=>{
   state=Core.createCareer(DB,{...Core.clone(DB.profile.defaults),name:'이전 밸런스 저장 검증',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))},'domestic','kr2-0');
   while(!state.player.history.length)Core.advance(DB,state);state.matchPresentation=null;
   DB.scoutingRules.minRating=6.42;DB.balanceRules.previous.rules.valueBase=1777;
   if(!await persist(true))throw Error('Legacy autosave failed');
   localStorage.removeItem(DEFAULT_DB.meta.storageKey);localStorage.removeItem(DEFAULT_DB.storageRules.backupKey);persist=async()=>true;
   return JSON.parse(JSON.stringify({date:state.date,player:state.player,fixtures:state.fixtures}));
  });
  // The real previous release fails on the exact code reported by the user.
  await page.goto(url+'/broken');await page.waitForFunction(()=>!storageLoading);
  assert.equal(await page.evaluate(()=>state),null);
  assert.equal(await page.evaluate(async()=>{const record=await careerStorageOperation('get');try{prepareImportedCareer(parseCareerText(await decodeCareer(record)));return 'unexpected success';}catch(error){return error.message;}}),'DB.balanceRules.previous.rules.initialOverallMax');
  assert.equal(await page.evaluate(async()=>{const record=await careerStorageOperation('get');return parseCareerText(await decodeCareer(record)).db.balanceRules.previous.rules.initialOverallMax===undefined;}),true,'failed restoration keeps the legacy save');
  await page.goto(url);await page.waitForFunction(()=>!storageLoading&&state?.player.name==='이전 밸런스 저장 검증');
  assert.deepEqual(await page.evaluate(()=>({date:state.date,player:state.player,fixtures:state.fixtures})),before);
  assert.equal(await page.evaluate(()=>validateSave(envelope())),true);
  assert.equal(await page.evaluate(()=>DB.scoutingRules.minRating),6.42);
  assert.equal(await page.evaluate(()=>DB.balanceRules.previous.rules.valueBase),1777);
  assert.equal(await page.evaluate(()=>DB.balanceRules.revision),2);
  assert.equal(await page.locator('#profile-form').count(),0);
  await page.screenshot({path:path.join(out,device.name+'-restored-career.png'),fullPage:false});
  await page.evaluate(async()=>{await persist(true);localStorage.removeItem(DEFAULT_DB.meta.storageKey);localStorage.removeItem(DEFAULT_DB.storageRules.backupKey);});
  await page.reload();await page.waitForFunction(()=>!storageLoading&&state?.player.name==='이전 밸런스 저장 검증');
  assert.deepEqual(await page.evaluate(()=>({date:state.date,player:state.player,fixtures:state.fixtures})),before);
  assert.equal(await page.evaluate(()=>validateSave(envelope())),true);
  await context.close();console.log(device.name+': exact legacy validation failure reproduced; IndexedDB-only recovery and second reload preserve player, contracts, match history and fixtures');
 }assert.deepEqual(errors,[]);console.log('Browser errors: 0');}finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
