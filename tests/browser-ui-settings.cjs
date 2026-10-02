const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium,devices}=require('playwright');
const source=path.join(__dirname,'../index.html');
const output=process.env.TEST_OUTPUT_DIR;
if(output)fs.mkdirSync(output,{recursive:true});
const server=http.createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fs.readFileSync(source));});
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function scale(page,value){await page.locator('#setting-scale').evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},String(value));}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  const errors=[];
  try{
    for(const device of [{name:'desktop',viewport:{width:1440,height:1050}},{...devices['Pixel 7'],name:'mobile'}]){
      const context=await browser.newContext(device),page=await context.newPage();
      page.on('pageerror',error=>errors.push(device.name+': '+error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#profile-form');
      await page.locator('#profile-name').fill('설정 확인 '+device.name);
      await page.locator('#profile-number').fill('19');
      await page.locator('#profile-displayName').fill('검증');
      const draftBefore=await page.evaluate(()=>JSON.stringify(draft));
      await page.locator('[data-action="onboard-settings"]').click();
      assert.equal(await page.locator('#setting-scale').getAttribute('max'),'200');
      await scale(page,200);await frames(page);
      assert.equal(await page.locator('#setting-scale-value').textContent(),'200%');
      assert.equal(await page.evaluate(()=>document.body.style.zoom),'2');
      await page.locator('#setting-currency').selectOption('KRW');
      await page.locator('#setting-layout').selectOption('desktop');
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.layout),'desktop');
      await page.locator('#setting-layout').selectOption('auto');
      if(output)await page.screenshot({path:path.join(output,device.name+'-settings-200.png'),fullPage:true});
      await page.locator('[data-action="onboard-settings-back"]').click();
      assert.equal(await page.evaluate(()=>JSON.stringify(draft)),draftBefore);
      await page.locator('[data-action="onboard-settings"]').click();
      await page.locator('[data-action="settings-reset"]').click();
      assert.equal(await page.evaluate(()=>preferences.scale),100);
      assert.equal(await page.evaluate(()=>JSON.stringify(draft)),draftBefore);
      await scale(page,200);await page.reload();await page.waitForSelector('#profile-form');
      assert.equal(await page.evaluate(()=>preferences.scale),200);
      await page.locator('[data-action="onboard-settings"]').click();await scale(page,100);
      await page.locator('[data-action="onboard-settings-back"]').click();
      await page.locator('#begin-career').click();
      await page.locator('[data-action="onboard-settings"]').click();
      await page.locator('#setting-currency').selectOption('USD');
      await page.locator('[data-action="onboard-settings-back"]').click();
      assert.equal(await page.evaluate(()=>creationStep),'personality');
      await page.locator('[data-action="personality-next"]').click();await page.locator('[data-action="sign"]').first().click();await page.waitForSelector('.sidebar');
      // Use an actual saved match, then exercise only the presentation cursor.
      await page.evaluate(()=>{
        let progress;for(let step=0;step<100&&!progress?.report;step++)progress=Core.advance(DB,state);
        if(!progress?.report)throw Error('No scheduled match');
        const saved=envelope();saved.schema=saved.state.schema=saved.db.meta.schema=10;saved.db.settings.scale.max=125;delete saved.db.ui.labels.settingsBack;
        const imported=prepareImportedCareer(saved);DB=imported.db;state=imported.state;
        if(DB.settings.scale.max!==200||!DB.ui.labels.settingsBack)throw Error('Previous save did not upgrade settings');
        const record=state.player.history.at(-1);state.matchPresentation={reportId:record.id,phase:'live',cursor:15,paused:false};
        DB.matchBroadcast.feedKeep=12;render();clearMatchTimer();
      });
      await page.evaluate(()=>{
        const feed=document.querySelector('.live-events');feed.scrollTop=feed.scrollHeight;window.scrollTo(0,250);
        window.uiCheck={feed,speed:document.getElementById('broadcast-speed'),shell:document.querySelector('.match-shell'),removed:0};
        new MutationObserver(records=>{uiCheck.removed+=records.reduce((n,r)=>n+r.removedNodes.length,0);}).observe(document.getElementById('app'),{childList:true});
      });await frames(page);
      const before=await page.evaluate(()=>({pageY:scrollY,feedTop:uiCheck.feed.scrollTop}));
      await page.locator('[data-action="match-pause"]').focus();
      await page.evaluate(()=>{state.matchPresentation.cursor++;render();clearMatchTimer();});await frames(page);
      const following=await page.evaluate(()=>({same:uiCheck.feed===document.querySelector('.live-events')&&uiCheck.speed===document.getElementById('broadcast-speed')&&uiCheck.shell===document.querySelector('.match-shell'),pageY:scrollY,bottom:Math.ceil(uiCheck.feed.scrollTop+uiCheck.feed.clientHeight)>=uiCheck.feed.scrollHeight,focused:document.activeElement.dataset.action,removed:uiCheck.removed}));
      assert.equal(following.same,true);assert.equal(following.removed,0);assert.equal(following.bottom,true);assert.equal(following.focused,'match-pause');assert.equal(following.pageY,before.pageY);
      await page.evaluate(()=>{const feed=uiCheck.feed;feed.scrollTop=(feed.scrollHeight-feed.clientHeight)/2;});await frames(page);
      const reading=await page.evaluate(()=>{
        const feed=uiCheck.feed,top=feed.getBoundingClientRect().top;
        uiCheck.anchor=[...feed.children].find(event=>event.getBoundingClientRect().bottom>top);
        return {offset:uiCheck.anchor.getBoundingClientRect().top-top,pageY:scrollY};
      });
      await page.evaluate(()=>{state.matchPresentation.cursor++;render();clearMatchTimer();});await frames(page);
      const afterReading=await page.evaluate(()=>({offset:uiCheck.anchor.getBoundingClientRect().top-uiCheck.feed.getBoundingClientRect().top,pageY:scrollY,bottom:Math.ceil(uiCheck.feed.scrollTop+uiCheck.feed.clientHeight)>=uiCheck.feed.scrollHeight}));
      assert.ok(Math.abs(afterReading.offset-reading.offset)<=1,JSON.stringify({reading,afterReading}));assert.equal(afterReading.pageY,reading.pageY);assert.equal(afterReading.bottom,false);
      // A real timer tick also keeps the page and controls in place.
      await page.evaluate(()=>{uiCheck.feed.scrollTop=uiCheck.feed.scrollHeight;state.matchPresentation.paused=false;scheduleBroadcast();});
      const cursor=await page.evaluate(()=>state.matchPresentation.cursor);
      await page.waitForFunction(cursor=>state.matchPresentation.cursor>cursor,cursor);await page.evaluate(()=>clearMatchTimer());await frames(page);
      assert.equal(await page.evaluate(()=>uiCheck.removed),0);
      const finalY=await page.evaluate(()=>scrollY);
      await page.evaluate(()=>{state.matchPresentation.cursor=broadcastTimeline(presentationRecord()).length;state.matchPresentation.phase='finished';render();});await frames(page);
      assert.equal(await page.evaluate(()=>scrollY),finalY);assert.equal(await page.evaluate(()=>uiCheck.removed),0);
      assert.equal(await page.locator('[data-action="match-results"]').isEnabled(),true);
      if(output)await page.screenshot({path:path.join(output,device.name+'-broadcast.png'),fullPage:true});
      await page.locator('[data-action="match-results"]').click();await page.waitForSelector('.sidebar');
      console.log(device.name+': profile/settings round trip, 200% persistence, previous-save upgrade, stable live log/focus/page scroll, reading anchor, timer and finish passed');
      await context.close();
    }
    assert.deepEqual(errors,[]);console.log('Browser script errors: 0');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
