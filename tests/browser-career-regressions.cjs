const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium,devices}=require('playwright');
const file=path.join(__dirname,'../index.html'),output=process.env.TEST_OUTPUT_DIR,server=http.createServer((_,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end(fs.readFileSync(file));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),errors=[];
try{for(const device of [{name:'desktop',viewport:{width:1440,height:1050}},{...devices['Pixel 7'],name:'mobile'}]){
  const context=await browser.newContext(device),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#profile-form');
  await page.evaluate(()=>{const p={...Core.clone(DB.profile.defaults),name:'훈련·대회 확인',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))};state=Core.createCareer(DB,p,'europe','en1-0');screen='dashboard';render();});
  await page.locator('.training-card [data-tab="training"]').click();await page.locator('#training-plan-form [name="primary"]').selectOption('shooting');await page.locator('#training-plan-form button[type="submit"]').click();await page.evaluate(()=>{screen='dashboard';render();});assert.equal(await page.evaluate(()=>state.training),'shooting');
  const gain=await page.evaluate(()=>{while(state.date<Core.dateAdd(state.seasonStart,28))Core.advance(DB,state);render();return state.player.development.training.gains.shooting;});assert.ok(gain>0);
  assert.ok(await page.getByText('능력 변화 · 훈련 이력',{exact:true}).isVisible());assert.ok((await page.locator('.quick-abilities').first().innerText()).includes('+'));
  if(output)await page.screenshot({path:path.join(output,device.name+'-training-progress.png'),fullPage:true});
  await page.evaluate(()=>{screen='fixtures';reportId=null;fixtureScope='schedule';render();});await page.locator('#fixture-competition').selectOption('ucl');
  const schedule=await page.locator('table tbody tr').allTextContents();assert.ok(schedule.length>0);assert.ok(schedule.every(row=>row.includes('유럽 챔피언스 대회')));
  if(output)await page.screenshot({path:path.join(output,device.name+'-continental-schedule.png'),fullPage:true});
  await page.evaluate(()=>{screen='team';render();});await page.locator('#team-competition').selectOption('ucl');assert.equal(await page.locator('#team-competition').inputValue(),'ucl');
  if(output)await page.screenshot({path:path.join(output,device.name+'-continental-table.png'),fullPage:true});
  await page.evaluate(()=>{screen='career';render();});assert.ok((await page.locator('#app').innerText()).includes('+'));
  await context.close();console.log(device.name+': shooting training UI and separate domestic/European schedules and tables passed');
}assert.deepEqual(errors,[]);console.log('Browser script errors: 0');}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
