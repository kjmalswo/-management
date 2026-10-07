const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1];
const DB=JSON.parse(section('game-db')),ui=section('game-ui');new vm.Script(ui);
const clone=v=>JSON.parse(JSON.stringify(v)),flush=()=>new Promise(resolve=>setImmediate(resolve));
function updateContext(replies){
 const roots=new Map(),requests=[],intervals=[],timers=new Map(),events={window:{},document:{}};let serial=0;
 const element=()=>({id:'',innerHTML:'',style:{setProperty(){}},replaceChildren(){this.innerHTML='';}});roots.set('update-root',element());
 const document={visibilityState:'visible',documentElement:{clientWidth:1280,clientHeight:720},body:{append(el){roots.set(el.id,el);}},getElementById:id=>roots.get(id),createElement:element,addEventListener(type,fn){events.document[type]=fn;}};
 const context=vm.createContext({DEFAULT_DB:clone(DB),DB:clone(DB),preferences:{scale:100},location:{href:'https://example.test/game/index.html?existing=1#career',protocol:'https:'},document,window:{visualViewport:null,addEventListener(type,fn){events.window[type]=fn;}},URL,AbortController,Date,
  setInterval(fn,ms){intervals.push({fn,ms});return ++serial;},setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
  DOMParser:class{parseFromString(text){return {getElementById:id=>id==='game-db'&&text.includes('game-db')?{textContent:JSON.stringify({meta:JSON.parse(text.split('META:')[1])})}:null};}},
  fetch:async(url,options)=>{requests.push({url:String(url),options});const reply=replies.shift();if(typeof reply==='function')return reply(options);if(reply instanceof Error)throw reply;return {ok:reply?.ok!==false,json:async()=>{if(reply?.invalidJSON)throw Error('JSON');return reply?.meta;},text:async()=>reply?.html??''};},
  h:v=>String(v),t:(key,values={})=>String(DB.ui.labels[key]||key).replace(/\{(\w+)\}/g,(_,k)=>values[k]??'')});
 const source=ui.slice(ui.indexOf('let availableUpdate='),ui.indexOf('async function applyAppUpdate('));
 const eventStart=ui.indexOf("window.addEventListener('online',()=>checkAppUpdate());"),eventEnd=ui.indexOf('function postseasonCard(',eventStart);
 vm.runInContext(source+ui.slice(eventStart,eventEnd)+';globalThis.API={checkAppUpdate,startAppUpdateChecks,drawUpdateNotice,newerAppVersion,status:()=>({availableUpdate,updateChecking,updateCheckTimer})};',context);
 return {context,api:context.API,roots,requests,intervals,timers,events,document};
}
const meta=version=>({title:DB.meta.title,version}),page=version=>'<script id="game-db">META:'+JSON.stringify(meta(version));
test('polling registers once before pending restoration or version fetch completes',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve),ctx=updateContext([()=>pending]);ctx.api.startAppUpdateChecks();ctx.api.startAppUpdateChecks();assert.equal(ctx.intervals.length,1);assert.equal(ctx.intervals[0].ms,DB.updateRules.checkIntervalMs);assert.equal(ctx.api.status().updateChecking,true);
 assert.ok(ui.includes('startAppUpdateChecks();bootGame();'));assert.ok(!ui.includes('bootGame().then(()=>{checkAppUpdate();'));
 release({ok:true,json:async()=>meta('20.9.0')});await flush();assert.equal(ctx.api.status().availableUpdate,'20.9.0');assert.equal(ctx.api.status().updateChecking,false);assert.equal(ctx.timers.size,0);
});
test('a small no-cache version manifest shows the notice without downloading game HTML',async()=>{
 const ctx=updateContext([{meta:meta('20.9.0')}]);await ctx.api.checkAppUpdate();assert.equal(ctx.requests.length,1);assert.equal(new URL(ctx.requests[0].url).pathname,'/game/version.json');assert.ok(new URL(ctx.requests[0].url).searchParams.has(DB.updateRules.queryKey));assert.equal(ctx.requests[0].options.cache,'no-store');assert.equal(new URL(ctx.requests[0].url).hash,'');assert.ok(ctx.roots.get('update-root').innerHTML.includes(DB.ui.labels.updateAvailable));assert.ok(ctx.roots.get('update-root').innerHTML.includes('data-action="app-update"'));
});
test('missing, malformed or stale manifests fall back to the deployed HTML',async()=>{
 for(const first of [{ok:false},{invalidJSON:true},{meta:meta(DB.meta.version)},{meta:{title:'Other game',version:'99.0.0'}}]){const ctx=updateContext([first,{html:page('20.9.0')}]);await ctx.api.checkAppUpdate();assert.equal(ctx.requests.length,2);assert.equal(new URL(ctx.requests[1].url).pathname,'/game/index.html');assert.equal(new URL(ctx.requests[1].url).searchParams.get('existing'),'1');assert.equal(ctx.api.status().availableUpdate,'20.9.0');assert.equal(ctx.timers.size,0);}
});
test('failure and request abort release the lock so the next check can detect an update',async()=>{
 const ctx=updateContext([new Error('offline'),new Error('offline'),{meta:meta('20.9.0')}]);await ctx.api.checkAppUpdate();assert.equal(ctx.api.status().updateChecking,false);await ctx.api.checkAppUpdate();assert.equal(ctx.api.status().availableUpdate,'20.9.0');
 const abort=updateContext([options=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')))),{html:page('20.9.0')}]);const run=abort.api.checkAppUpdate();assert.equal(abort.timers.size,1);abort.timers.values().next().value.fn();await run;assert.equal(abort.api.status().availableUpdate,'20.9.0');assert.equal(abort.timers.size,0);
});
test('parallel checks are suppressed and later older replies cannot downgrade the notice',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve),ctx=updateContext([()=>pending,{meta:meta('20.8.2')}]);const first=ctx.api.checkAppUpdate();await ctx.api.checkAppUpdate();assert.equal(ctx.requests.length,1);release({ok:true,json:async()=>meta('20.9.0')});await first;await ctx.api.checkAppUpdate();assert.equal(ctx.api.status().availableUpdate,'20.9.0');
});
test('focus, pageshow and visibility recovery redraw and recheck without losing the notice',async()=>{
 const ctx=updateContext([{meta:meta('20.9.0')},{meta:meta('20.9.0')},{meta:meta('20.9.0')},{meta:meta('20.9.0')}]);await ctx.api.checkAppUpdate();ctx.roots.delete('update-root');ctx.events.window.focus();await flush();assert.ok(ctx.roots.get('update-root').innerHTML.includes('20.9.0'));ctx.events.window.pageshow();await flush();ctx.document.visibilityState='hidden';ctx.events.document.visibilitychange();await flush();assert.equal(ctx.requests.length,3);ctx.document.visibilityState='visible';ctx.events.document.visibilitychange();await flush();assert.equal(ctx.requests.length,4);
});
test('offline files and hidden tabs do not issue web requests',async()=>{
 const ctx=updateContext([]);ctx.context.location.protocol='file:';await ctx.api.checkAppUpdate();ctx.context.location.protocol='https:';ctx.document.visibilityState='hidden';await ctx.api.checkAppUpdate();assert.equal(ctx.requests.length,0);
});
function strengthContext(stats){
 const state={player:{stats:{speed:40,shooting:40,passing:40,physical:40,defending:40,dribbling:40,...stats}}};
 const context=vm.createContext({DB:clone(DB),state,Core:{template:(str,vars)=>str.replace(/\{(\w+)\}/g,(_,k)=>vars[k]??'')},h:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),t:(key,values={})=>String(DB.ui.labels[key]||key).replace(/\{(\w+)\}/g,(_,k)=>values[k]??''),badge:v=>'<span>'+v+'</span>',abilityLabel:v=>String(Math.round(v))});
 vm.runInContext(ui.slice(ui.indexOf('function playerStrengthProfile('),ui.indexOf('function career(){'))+';globalThis.API={playerStrengthProfile,playerStrengthsCard};',context);return {api:context.API,state};
}
test('single highest skill gets a meaningful player type and raw stats stay unchanged',()=>{
 const ctx=strengthContext({shooting:83}),before=JSON.stringify(ctx.state);const p=ctx.api.playerStrengthProfile();assert.equal(p.type,DB.ui.playerStrengths.types.shooting.name);assert.deepEqual(Array.from(p.strengths,a=>a.id),['shooting']);assert.equal(JSON.stringify(ctx.state),before);
});
test('all ties and skills within three raw points are selected; outside the boundary is excluded',()=>{
 const ctx=strengthContext({shooting:80,dribbling:80,speed:77,physical:76.99});const p=ctx.api.playerStrengthProfile();assert.deepEqual(Array.from(p.strengths,a=>a.id),['shooting','dribbling','speed']);assert.ok(p.type.includes('복합형'));assert.ok(p.type.includes('스피드'));
});
test('paired skills, balanced attributes and growth produce clear current player types',()=>{
 const pair=strengthContext({shooting:81,dribbling:80});assert.equal(pair.api.playerStrengthProfile().type,DB.ui.playerStrengths.combinations.find(c=>c.id==='shooting-dribble').name);
 const all=strengthContext(Object.fromEntries(DB.attributes.map(a=>[a.id,64])));assert.equal(all.api.playerStrengthProfile().strengths.length,DB.attributes.length);assert.equal(all.api.playerStrengthProfile().type,DB.ui.playerStrengths.allRoundType);
 pair.state.player.stats.passing=90;assert.equal(pair.api.playerStrengthProfile().type,DB.ui.playerStrengths.types.passing.name);
});
test('strengths remain in the player profile and are absent from the overview and NPC profiles',()=>{
 const ctx=strengthContext({passing:82}),full=ctx.api.playerStrengthsCard(),compact=ctx.api.playerStrengthsCard(true);assert.ok(full.includes('패스'));assert.ok(full.includes('82'));assert.ok(full.includes(DB.ui.labels.playerStrengths));assert.ok(compact.includes('compact'));
 assert.equal((ui.match(/playerStrengthsCard\(\)/g)||[]).length,1);assert.equal((ui.match(/playerStrengthsCard\(true\)/g)||[]).length,0);
});
test('version manifest matches HTML and old presentation DB gains rules without changing player data',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../version.json'),'utf8'));assert.equal(manifest.version,DB.meta.version);assert.equal(manifest.title,DB.meta.title);
 const ctx=vm.createContext({});vm.runInContext(section('game-engine')+';const Core=FootballCore;const DEFAULT_DB='+JSON.stringify(DB)+';const t=key=>key;'+ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast('))+ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('))+';globalThis.API={upgradePresentationDatabase,validateDB};',ctx);
 const old=clone(DB);delete old.ui.playerStrengths;delete old.updateRules.manifestPath;old.ui.labels.welcome='개인 환영';const attributes=JSON.stringify(old.attributes);ctx.API.upgradePresentationDatabase(old);assert.deepEqual(clone(old.ui.playerStrengths),DB.ui.playerStrengths);assert.equal(old.updateRules.manifestPath,DB.updateRules.manifestPath);assert.equal(old.ui.labels.welcome,'개인 환영');assert.equal(JSON.stringify(old.attributes),attributes);assert.doesNotThrow(()=>ctx.API.validateDB(old));
 old.ui.playerStrengths.nearTopGap=-1;assert.throws(()=>ctx.API.validateDB(old),/playerStrengths/);
});
test('catalog upgrade applies branded names and tenfold living costs only to former defaults',()=>{
 const ctx=vm.createContext({});vm.runInContext(section('game-engine')+';const Core=FootballCore;const DEFAULT_DB='+JSON.stringify(DB)+';const t=key=>key;'+ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast('))+ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('))+';globalThis.API={upgradePresentationDatabase,validateDB};',ctx);
 const old=clone(DB),rules=DB.economyRules.catalogUpgrade,ids=JSON.stringify(old.economyRules.assets.map(a=>a.id));delete old.economyRules.catalogUpgrade;
 for(const asset of old.economyRules.assets)if(rules.assetNames[asset.id])asset.name=rules.assetNames[asset.id][0];
 for(const life of old.economyRules.lifestyles)Object.assign(life,rules.lifestyleCosts[life.id]);
 const custom=clone(old);custom.economyRules.assets.find(a=>a.id==='watch').name='내 시계';custom.economyRules.lifestyles[0].spending=111;
 ctx.API.upgradePresentationDatabase(old);assert.equal(JSON.stringify(old.economyRules.assets.map(a=>a.id)),ids);assert.deepEqual(old.economyRules.assets,DB.economyRules.assets);assert.deepEqual(old.economyRules.lifestyles,DB.economyRules.lifestyles);assert.doesNotThrow(()=>ctx.API.validateDB(old));
 const once=JSON.stringify(old);ctx.API.upgradePresentationDatabase(old);assert.equal(JSON.stringify(old),once);
 const recent=clone(old);recent.economyRules.assets.find(a=>a.id==='watch').name='최고급 시계 컬렉션';ctx.API.upgradePresentationDatabase(recent);assert.equal(recent.economyRules.assets.find(a=>a.id==='watch').name,DB.economyRules.assets.find(a=>a.id==='watch').name);ctx.API.upgradePresentationDatabase(custom);assert.equal(custom.economyRules.assets.find(a=>a.id==='watch').name,'내 시계');assert.equal(custom.economyRules.lifestyles[0].spending,111);assert.equal(custom.economyRules.lifestyles[0].rent,DB.economyRules.lifestyles[0].rent);
 for(const life of DB.economyRules.lifestyles)for(const key of ['rent','spending'])assert.equal(life[key],rules.lifestyleCosts[life.id][key]*10);
 assert.deepEqual(DB.economyRules.lifestyles.map(d=>d.rent+d.spending),[1800,9000,65000]);
});
