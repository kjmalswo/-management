const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{chromium,devices}=require('playwright');
const source=path.join(__dirname,'../index.html'),output=path.resolve(process.env.TEST_OUTPUT_DIR||path.join(__dirname,'../test-artifacts'));
fs.mkdirSync(output,{recursive:true});
function legacySave(){
 const html=fs.readFileSync(source,'utf8'),section=id=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1],db=JSON.parse(section('game-db')),ctx=vm.createContext({});
 vm.runInContext(section('game-engine')+';globalThis.C=FootballCore;',ctx);const C=ctx.C;
 db.postseasonRules.specialYear='1990';delete db.postseasonRules.boundaries.find(r=>r.id==='kr12').upperSeedOffsets;
 const s=C.createCareer(db,{...C.clone(db.profile.defaults),name:'시즌 종료 복구',stats:Object.fromEntries(db.attributes.map(a=>[a.id,a.initial]))},'domestic','en1-2');
 for(const mail of C.pendingResponses(db,s))if(mail.reply==='coach')C.replyCoach(db,s,mail.id,db.inboxReplies[0].id);
 for(const list of Object.values(s.fixtures))for(const f of list)f.result={duration:90,home:{stats:{goals:1}},away:{stats:{goals:0}}};
 s.postseason.deferred=db.leagues.filter(l=>l.kind==='domestic'&&!['kr-1','kr-2'].includes(l.id)).map(l=>l.id);s.date=C.dateAdd(s.seasonStart,db.calendarRules.scheduleEnd);C.advancePostseason(db,s);
 for(let step=0;step<30&&s.postseason.competitions.kr12.status!=='complete';step++){
  for(const f of s.fixtures['post-kr12'].filter(f=>!f.result)){s.date=f.date;const r={duration:90,home:{stats:{goals:1}},away:{stats:{goals:0}}};C.resolvePlayoffResult(db,s,f,r);f.result=r;}
  C.advancePostseason(db,s);
 }
 const t=s.postseason.competitions.kr12;assert.equal(t.status,'complete');assert.equal(t.seeds.u13,undefined);
 t.nodes.push(C.clone(db.postseasonRules.boundaries.find(r=>r.id==='kr12').nodes.find(n=>n.id==='exchange2')));t.status='playing';
 s.date=C.dateAdd(s.seasonStart,db.calendarRules.finalDay);s.trainingProgram.reviewDate=s.date;for(const e of s.calendar.entries)e.completed=true;s.calendar.ended=true;
 assert.equal(C.seasonReady(s),false);assert.equal(C.nextCalendar(s),null);return {schema:db.meta.schema,db,state:s};
}
const original=process.env.CALENDAR_SAVE_FILE?JSON.parse(fs.readFileSync(process.env.CALENDAR_SAVE_FILE,'utf8')):legacySave(),hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expected={date:original.state.date,season:original.state.season,fixtures:hash(original.state.fixtures),history:hash(original.state.player.history),stats:hash(original.state.player.stats),contract:hash(original.state.player.contract)};
const server=http.createServer((_,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(source));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),errors=[];
 try{for(const device of [{name:'desktop',viewport:{width:1440,height:1000}},{...devices['Pixel 7'],name:'mobile'}]){
  const context=await browser.newContext(device),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#profile-form');
  await page.evaluate(envelope=>{const imported=prepareImportedCareer(envelope);DB=imported.db;state=imported.state;screen='dashboard';render();},original);
  async function snapshot(){return page.evaluate(async()=>{const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');return {date:state.date,season:state.season,fixtures:await hash(state.fixtures),history:await hash(state.player.history),stats:await hash(state.player.stats),contract:await hash(state.player.contract)};});}
  assert.deepEqual(await snapshot(),expected);assert.equal(await page.evaluate(()=>Core.seasonReady(state)),true);assert.equal(await page.locator('.top-actions [data-action="next-season"]').count(),1);
  // A drained calendar is an ordinary engine result. The UI must handle false.
  await page.evaluate(()=>startCalendarExperience());await page.waitForFunction(()=>!calendarLoading,null,{timeout:60000});assert.deepEqual(await snapshot(),expected);assert.equal(await page.getByText('일정을 진행하지 못했습니다. 다시 시도해 주세요.',{exact:true}).count(),0);
  await page.locator('[data-action="next-season"]').click();await page.locator('.review-tabs [data-action="review-page"]').last().click();await page.locator('[data-action="review-start"]').click();try{await page.waitForFunction(season=>state.season===season+1,expected.season,{timeout:60000});}catch(error){console.error('Next season errors',errors);console.error(await page.evaluate(()=>({date:state.date,season:state.season,toast:document.querySelector('#toast')?.textContent,button:document.querySelector('.top-actions>.primary')?.textContent})));throw error;}
  assert.equal(await page.evaluate(async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(state.archives.at(-1).fixtures))))].map(n=>n.toString(16).padStart(2,'0')).join('')),expected.fixtures);
  const next=await page.evaluate(()=>({date:state.date,season:state.season,next:Core.nextCalendar(state)?.date,version:DB.meta.version}));assert.ok(next.next>=next.date);assert.equal(next.version,await page.evaluate(()=>DEFAULT_DB.meta.version));
  await page.screenshot({path:path.join(output,'calendar-resume-'+device.name+'.png'),fullPage:true});await context.close();console.log(device.name+': legacy deadlock recovered, records preserved, exhausted-calendar UI passed, next season opened',next);
 }assert.deepEqual(errors,[]);console.log('Browser errors: 0');}finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
