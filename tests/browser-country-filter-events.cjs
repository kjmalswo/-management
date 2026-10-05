const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium,devices}=require('playwright');
const {selectCountry}=require('./helpers/browser-input.cjs');
const source=path.join(__dirname,'../index.html'),output=process.env.TEST_OUTPUT_DIR;
const server=http.createServer((_,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(source));});
async function replayRestoration(page,selector,expected){
 for(const bubbles of [false,true])await page.locator(selector).evaluate((el,bubbles)=>{
  const reset=[...el.options].find(option=>option.value!==el.value)?.value;
  for(const type of ['change','input']){el.value=reset;el.dispatchEvent(new Event(type,{bubbles}));}
 },bubbles);
 assert.equal(await page.locator(selector).inputValue(),expected);
}
async function verifyCountries(page){
 const countries=await page.evaluate(()=>browseCountries(DB.leagues.filter(l=>l.kind==='domestic')).map(c=>c.id));
 await page.evaluate(()=>{screen='team';render();});
 for(const country of countries){
  await selectCountry(page,'#team-country',country);await replayRestoration(page,'#team-country',country);
  const leagues=await page.locator('#team-competition option').evaluateAll(options=>options.map(o=>o.value));
  assert.equal(await page.evaluate(({leagues,country})=>leagues.length>0&&leagues.every(id=>idx().leagues[id].country===country),{leagues,country}),true);
  await page.evaluate(()=>render());await replayRestoration(page,'#team-country',country);
 }
 await page.evaluate(()=>{screen='world';render();});
 for(const prefix of ['world-browse','world-player'])for(const country of ['EN','PT','IT','KR']){
  await selectCountry(page,'#'+prefix+'-country',country);await replayRestoration(page,'#'+prefix+'-country',country);
  const leagues=await page.locator('#'+prefix+'-league option').evaluateAll(options=>options.map(o=>o.value).filter(id=>id!=='all'));
  assert.equal(await page.evaluate(({leagues,country})=>leagues.length>0&&leagues.every(id=>idx().leagues[id].country===country),{leagues,country}),true);
 }
 await page.evaluate(()=>{screen='market';activeDeal=null;agentPane='contact';render();});
 for(const country of ['EN','PT','JP','KR']){await selectCountry(page,'#agent-country-filter',country);await replayRestoration(page,'#agent-country-filter',country);assert.equal(await page.evaluate(country=>agentTargetClubs().every(c=>idx().leagues[c.league].country===country),country),true);}
 await page.evaluate(()=>{screen='fixtures';reportId=null;render();});const fixtureCountry=await page.locator('#fixture-country option').last().getAttribute('value');await selectCountry(page,'#fixture-country',fixtureCountry);await replayRestoration(page,'#fixture-country',fixtureCountry);
 await page.evaluate(()=>{const review=state.seasonRecaps[0]||Core.captureSeasonReview(DB,Core.clone(state),true);if(!state.seasonRecaps.length)state.seasonRecaps.push(review);reviewSeason=review.season;reviewLeague=review.league;reviewPage=DB.seasonReviewRules.pages.indexOf('leagues');drawSeasonReview();});await selectCountry(page,'#review-country','EN');await replayRestoration(page,'#review-country','EN');assert.equal(await page.locator('#review-league').inputValue(),'en-1');await page.locator('[data-action="close"]').first().click();
 await page.evaluate(()=>{screen='team';render();});await selectCountry(page,'#team-country','EN');await replayRestoration(page,'#team-country','EN');assert.equal(await page.locator('#team-competition').inputValue(),'en-1');
 if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'country-filter-'+(await page.viewportSize()).width+'.png'),fullPage:true});}
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH}),errors=[];try{
 for(const device of [{name:'desktop',viewport:{width:1440,height:1000}},{...devices['Pixel 7'],name:'mobile'}]){
  const context=await browser.newContext(device),page=await context.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#profile-form');
  await selectCountry(page,'#profile-preferredLeague-country','EN');await replayRestoration(page,'#profile-preferredLeague-country','EN');assert.equal(await page.locator('#profile-preferredLeague option[value="en-1"]').count(),1);
  await selectCountry(page,'#profile-dreamClub-country','IT');await replayRestoration(page,'#profile-dreamClub-country','IT');assert.ok(await page.locator('#profile-dreamClub option[value="it1-0"]').count());
  if(process.env.COUNTRY_SAVE_FILE){await page.locator('#save-input').setInputFiles(path.resolve(process.env.COUNTRY_SAVE_FILE));await page.waitForFunction(()=>!storageLoading&&state?.player);}else await page.evaluate(()=>{state=Core.createCareer(DB,{...Core.clone(DB.profile.defaults),name:'국가 필터 회귀',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))},'domestic','kr2-0');});
  const snapshot=await page.evaluate(()=>JSON.stringify({date:state.date,player:state.player,fixtures:state.fixtures}));await verifyCountries(page);assert.equal(await page.evaluate(()=>JSON.stringify({date:state.date,player:state.player,fixtures:state.fixtures})),snapshot);await context.close();console.log(device.name+': native country selection, synthetic restoration blocked on every screen, rerender and career preservation passed');
 }assert.deepEqual(errors,[]);console.log('Browser errors: 0');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
