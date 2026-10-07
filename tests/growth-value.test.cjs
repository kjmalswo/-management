const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1],DB=JSON.parse(section('game-db')),ui=section('game-ui'),ctx=vm.createContext({});
vm.runInContext(section('game-engine')+';globalThis.C=FootballCore;',ctx);new vm.Script(ui);const C=ctx.C,clone=C.clone,plain=v=>JSON.parse(JSON.stringify(v));
const base=C.createCareer(DB,{...clone(DB.profile.defaults),name:'성장 기록 검증',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))},'domestic','kr2-0');
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast(')),imports=ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('));
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)};const Core=FootballCore;const t=key=>key;${validators}${imports};globalThis.reload=value=>prepareImportedCareer(parseCareerText(JSON.stringify(value)));`,ctx);
function player(ovr,talent,age){const p=clone(base.player);p.age=age;p.traits.talent=talent;for(const a of DB.attributes)p.stats[a.id]=ovr;return p;}
test('overall decay is monotonic and high talent shields it without eliminating it',()=>{
 for(const talent of [DB.dynamics.traitMin,DB.dynamics.traitMax]){let previous=Infinity;for(const ovr of [40,60,80,95]){const f=C.trainingGrowthFactors(DB,player(ovr,talent,18));assert.ok(f.total<previous);previous=f.total;}}
 const ratio=talent=>C.trainingGrowthFactors(DB,player(95,talent,18)).total/C.trainingGrowthFactors(DB,player(40,talent,18)).total;
 assert.ok(ratio(DB.dynamics.traitMax)>ratio(DB.dynamics.traitMin));assert.ok(ratio(DB.dynamics.traitMax)<1);
});
test('talented players gain more early but lose a greater share of growth late in their career',()=>{
 const low=DB.dynamics.traitMin,high=DB.dynamics.traitMax,f=(age,talent)=>C.trainingGrowthFactors(DB,player(65,talent,age)).age;
 assert.ok(f(18,high)>f(18,low));for(const talent of [low,high])assert.ok(f(18,talent)>f(26,talent)&&f(26,talent)>f(35,talent));
 assert.ok(f(35,high)/f(18,high)<f(35,low)/f(18,low));assert.ok(f(35,high)/f(26,high)<f(26,high)/f(18,high));assert.ok(f(80,high)>0);
});
test('actual grow applies decay to training and its weekly ceiling, while match growth is unchanged',()=>{
 const original=clone(base);original.player=player(70,DB.dynamics.traitMax,21);for(const a of DB.attributes){original.player.development.birth[a.id]=100;original.player.development.caps[a.id]=100;}
 const normal=clone(original),slow=clone(original),db=clone(DB);db.growthRules.trainingDecay.overallPenalty=.99;db.growthRules.trainingDecay.talentOverallShield=0;
 C.grow(DB,normal,0,{growth:100,attribute:null});C.grow(db,slow,0,{growth:100,attribute:null});assert.ok(C.overall(DB,normal.player.stats)>C.overall(DB,slow.player.stats));
 const matchA=clone(original),matchB=clone(original);C.grow(DB,matchA,90,{growth:0,attribute:null});C.grow(db,matchB,90,{growth:0,attribute:null});assert.deepEqual(plain(matchA.player.stats),plain(matchB.player.stats));
});
test('daily advancement records only after market close, exactly once, using the actual seasonal schedule',()=>{
 const s=clone(base),checkpoints=C.playerValueCheckpoints(DB,s),summer=checkpoints.find(x=>x.window==='summer'),winter=checkpoints.find(x=>x.window==='winter');s.date=summer.closedOn;s.playerValueHistory={since:s.date,records:[{date:s.date,value:C.marketValue(DB,s.player,s),kind:'initial'}]};
 assert.equal(C.recordPlayerValue(DB,s),false);C.advanceTrainingDays(DB,s,C.dateAdd(summer.date,1),false);assert.equal(s.playerValueHistory.records.length,2);assert.equal(s.playerValueHistory.records[1].date,summer.date);assert.equal(s.playerValueHistory.records[1].window,'summer');const old=JSON.stringify(s.playerValueHistory.records);
 assert.equal(C.recordPlayerValue(DB,s),false);s.date=winter.closedOn;assert.equal(C.recordPlayerValue(DB,s),false);s.date=winter.date;for(const a of DB.attributes)s.player.stats[a.id]+=1;assert.equal(C.recordPlayerValue(DB,s),true);assert.equal(C.recordPlayerValue(DB,s),false);assert.equal(JSON.stringify(s.playerValueHistory.records.slice(0,2)),old);assert.ok(s.playerValueHistory.records[2].value>0);s.trainingProgram.reviewDate=C.dateAdd(s.date,DB.trainingProgramRules.blockDays);ctx.reload({schema:DB.meta.schema,db:clone(DB),state:s});
 const custom=clone(DB);custom.transferWindows.find(w=>w.id==='summer').end+=5;assert.equal(C.playerValueCheckpoints(custom,s).find(x=>x.window==='summer').date,C.dateAdd(summer.date,5));s.date=C.dateAdd(s.seasonStart,153);assert.equal(C.recordPlayerValue(DB,s),false);
 const next={seasonStart:C.dateAdd(s.seasonStart,DB.calendarRules.seasonDays)};assert.equal(C.playerValueCheckpoints(DB,next)[0].date,C.dateAdd(summer.date,DB.calendarRules.seasonDays));
});
test('old saves start value history at the real load date without changing the player or inventing past records',()=>{
 const save={schema:DB.meta.schema,db:clone(DB),state:clone(base)};delete save.state.playerValueHistory;delete save.db.valueHistoryRules;delete save.db.growthRules.trainingDecay;const playerBefore=JSON.stringify(save.state.player),loaded=ctx.reload(save);
 assert.equal(JSON.stringify(loaded.state.player),playerBefore);assert.equal(loaded.state.playerValueHistory.records.length,1);assert.equal(loaded.state.playerValueHistory.since,save.state.date);assert.deepEqual(plain(loaded.db.growthRules.trainingDecay),DB.growthRules.trainingDecay);assert.equal(JSON.stringify(ctx.reload(loaded)),JSON.stringify(loaded));
 const legacy=clone(DB);delete legacy.growthRules;for(const [key,value] of Object.entries(DB.growthRules.previousTrainingLimits))legacy.trainingRules[key]=value;C.upgradeDatabase(DB,legacy);for(const key of Object.keys(DB.growthRules.previousTrainingLimits))assert.equal(legacy.trainingRules[key],DB.trainingRules[key]);
 const previous={schema:DB.meta.schema,db:clone(DB),state:clone(base)};delete previous.db.valueHistoryRules.windows;delete previous.db.valueHistoryRules.afterDays;previous.state.date='2027-01-01';previous.state.trainingProgram.reviewDate=C.dateAdd(previous.state.date,DB.trainingProgramRules.blockDays);previous.state.playerValueHistory.records.push({date:previous.state.date,value:12345,kind:'periodic'});const before=JSON.stringify(previous.state.playerValueHistory),restored=ctx.reload(previous);assert.equal(JSON.stringify(restored.state.playerValueHistory),before);assert.deepEqual(plain(restored.db.valueHistoryRules.windows),DB.valueHistoryRules.windows);
});
test('imports reject invalid value amounts, future dates and duplicate or off-schedule checkpoints',()=>{
 for(const mutate of [s=>s.playerValueHistory=null,s=>s.playerValueHistory.records[0].value=-1,s=>s.playerValueHistory.records[0].value=.5,s=>s.playerValueHistory.since='2099-01-01',s=>s.playerValueHistory.records.push({...s.playerValueHistory.records[0],kind:'periodic'}),s=>s.playerValueHistory.records.push({date:'2026-07-02',value:1,kind:'periodic'})]){const save={schema:DB.meta.schema,db:clone(DB),state:clone(base)};mutate(save.state);assert.throws(()=>ctx.reload(save),/playerValueHistory/);}
});
test('chart renders real checkpoints and selected-currency labels, including single zero-valued records',()=>{
 const fn=ui.slice(ui.indexOf('function playerValueHistoryCard(){'),ui.indexOf('function career(){'));const s=clone(base);s.date='2027-01-01';s.playerValueHistory={since:'2026-07-01',records:[{date:'2026-07-01',value:1000,kind:'initial'},{date:'2026-08-01',value:2000,kind:'periodic'},{date:'2027-01-01',value:3000,kind:'periodic'}]};
 const view=vm.createContext({DB,Core:C,state:s,h:String,t:key=>DB.ui.labels[key]||key,money:value=>'₩'+Math.round(value*1500).toLocaleString('ko-KR'),badge:String,detail:(key,value)=>key+value});vm.runInContext(fn+';globalThis.draw=playerValueHistoryCard;',view);let rendered=view.draw();assert.ok(rendered.includes('<polyline'));assert.ok(rendered.includes('₩4,500,000'));assert.ok(rendered.includes('2027-01'));assert.ok(rendered.includes(C.playerValueCheckpoints(DB,s).find(x=>x.window==='winter').date));assert.ok(!/NaN|Infinity/.test(rendered));
 s.playerValueHistory.records=[{date:'2026-07-01',value:0,kind:'initial'}];rendered=view.draw();assert.ok(rendered.includes('₩0'));assert.ok(!/NaN|Infinity/.test(rendered));assert.ok(/function career\(\)[\s\S]*?\$\{playerValueHistoryCard\(\)\}/.test(ui));assert.ok(/function valuationView\(\)[^\n]*playerValueHistoryCard\(\)/.test(ui));
});
