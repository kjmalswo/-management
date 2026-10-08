const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1],DB=JSON.parse(section('game-db')),engine=section('game-engine'),ui=section('game-ui'),ctx=vm.createContext({});
vm.runInContext(engine+';globalThis.C=FootballCore;',ctx);const C=ctx.C,plain=x=>JSON.parse(JSON.stringify(x)),profile={...C.clone(DB.profile.defaults),name:'시작 계약 검증',startingSeed:73,stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))},offers=C.startingOffers(DB,profile),europe=offers.find(o=>o.route.id==='europe');
const initial=C.createCareer(DB,profile,'europe',europe.club.id),career=()=>C.clone(initial);
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast(')),imports=ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('));
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)},Core=FootballCore,t=key=>key;${validators}${imports};globalThis.V={validateDB,validateSave,prepareImportedCareer};`,ctx);
const uiFunction=name=>ui.slice(ui.indexOf('function '+name+'('),ui.indexOf('\nfunction ',ui.indexOf('function '+name+'(')+1));

test('new-career rules validate and European default/alternative previews equal actual monthly-band rookie contracts',()=>{
 ctx.V.validateDB(DB);assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname,'../version.json'))).version,DB.meta.version);
 const r=DB.startingRouteRules.initialContract.europe;
 for(const club of DB.clubs.filter(c=>!c.historical&&c.quality<=europe.route.qualityMax&&DB.startingRouteRules.europeLeagues.includes(c.league))){
  const wage=C.initialWage(DB,club.id,profile,'europe'),monthly=wage*DB.rules.annualSalaryWeeks/r.monthsPerYear*DB.settings.currencies.find(c=>c.id==='KRW').rate;assert.ok(monthly>=r.minimumMonthlyKRW&&monthly<=r.maximumMonthlyKRW,club.id);
 }
 assert.equal(initial.player.contract.weekly,C.initialWage(DB,europe.club.id,profile,'europe'));
 const alternative=C.createCareer(DB,profile,'europe',europe.alternatives[1].id);assert.equal(alternative.player.contract.weekly,C.initialWage(DB,europe.alternatives[1].id,profile,'europe'));
 for(const route of offers.filter(o=>o.route.id!=='europe')){const rule=DB.startingRouteRules.initialContract[route.route.id],monthly=C.initialWage(DB,route.club.id,profile,route.route.id)*DB.rules.annualSalaryWeeks/rule.monthsPerYear*DB.settings.currencies.find(c=>c.id==='KRW').rate;assert.ok(monthly>=rule.minimumMonthlyKRW&&monthly<=rule.maximumMonthlyKRW);}
 const screen=vm.createContext({DB,draft:C.clone(profile),Core:{...C,startingOffers:()=>offers},h:String,t:key=>key,idx:()=>C.indexes(DB),creationSteps:()=>'',badge:()=>'',crest:()=>'',clubTier:()=>'',money:n=>'WAGE:'+n,detail:(key,value)=>key+':'+value,btn:(label,action,attributes)=>attributes,openModal:content=>screen.content=content});
 vm.runInContext(uiFunction('showContracts'),screen);screen.showContracts();
 const card=()=>screen.content.split('<article').find(s=>s.includes('data-starting-route="europe"'));
 assert.ok(card().includes('weeklyWage:WAGE:'+initial.player.contract.weekly));assert.ok(card().includes('data-club="'+europe.club.id+'"'));
 screen.draft.startingClubSelections.europe=europe.alternatives[1].id;screen.showContracts();assert.ok(card().includes('weeklyWage:WAGE:'+alternative.player.contract.weekly));assert.ok(card().includes('data-club="'+alternative.player.club+'"'));
});

test('optional-position form clears and disables tertiary, re-enables it without inventing a role, and preserves a valid primary during swaps',()=>{
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',disabled:false,textContent:'',setAttribute(k,v){this[k]=v;},set innerHTML(value){this.markup=value;const selected=value.match(/value="([^"]+)" selected/);if(selected)this.value=selected[1];}});return elements.get(id);};
 const form=element('profile-form'),draft={...plain(profile),traits:Object.fromEntries(DB.traits.map(t=>[t.id,t.initial]))};
 function fill(){for(const f of DB.profile.fields)element('profile-'+f.id).value=draft[f.id];for(const a of DB.attributes)element('stat-'+a.id).value=draft.stats[a.id];for(const a of DB.traits)element('trait-'+a.id).value=draft.traits[a.id];}
 const screen=vm.createContext({DB,draft,Core:C,document:{getElementById:element},FormData:class{constructor(){this.values=new Map([...elements].filter(([,e])=>!e.disabled).map(([id,e])=>[id.replace(/^profile-/,''),e.value]));}get(key){return this.values.get(key)??null;}},h:String,t:key=>DB.ui.labels[key]||key,n:String,abilityLabel:String,shirt:()=>'',fitShirtNames:()=>{}});
 vm.runInContext(uiFunction('positionOptions')+'\n'+uiFunction('updateDraft'),screen);fill();screen.updateDraft();
 assert.ok(!screen.positionOptions('position').includes('value="none"'));assert.ok(screen.positionOptions('secondaryPosition').includes('선택 안함'));assert.equal(element('profile-tertiaryPosition').disabled,true);assert.equal(element('begin-career').disabled,false);
 const change=(field,value)=>{element('profile-'+field).value=value;screen.updateDraft({target:element('profile-'+field)});};
 change('secondaryPosition','LW');assert.equal(element('profile-tertiaryPosition').disabled,false);assert.equal(draft.tertiaryPosition,'none');change('tertiaryPosition','AM');
 change('secondaryPosition','none');assert.equal(draft.tertiaryPosition,'none');assert.equal(element('profile-tertiaryPosition').disabled,true);assert.equal(element('begin-career').disabled,false);
 change('secondaryPosition','ST');assert.equal(draft.position,'ST');assert.equal(draft.secondaryPosition,'none');
 change('secondaryPosition','LW');change('tertiaryPosition','AM');change('position','LW');assert.deepEqual([draft.position,draft.secondaryPosition,draft.tertiaryPosition],['LW','ST','AM']);
 change('tertiaryPosition','none');change('tertiaryPosition','LW');assert.equal(draft.position,'LW');assert.equal(draft.tertiaryPosition,'none');assert.equal(element('begin-career').disabled,false);
});

function tactical(s,formation='433',personality='balanced'){
 const id=s.player.club,m=s.world.clubs[id].manager,plan=C.coachStrategy(DB,s,id);plan.personality=personality;plan.planA=formation;plan.planB=formation==='433'?'352':'433';m.tactic=formation;
 for(const npc of s.world.rosters[id]){npc.injury=0;for(const a of DB.attributes)npc.stats[a.id]=55;}
 s.player.fitness=100;s.player.trust=80;s.player.traits.adaptability=100;for(const a of DB.attributes)s.player.stats[a.id]=90;
 return id;
}
test('specialists compete only at primary; versatile players use declared skill and actual position competition, with manager-dependent bench value',()=>{
 const s=career(),id=tactical(s);let role=C.roleAssignment(DB,s.player,id,s);assert.equal(role.position,'ST');assert.equal(role.type,'positionSpecialist');assert.equal(role.coverage,0);assert.equal(role.benchChance,DB.engine.selection.subChance);
 s.player.secondaryPosition='LW';s.player.tertiaryPosition='RW';const balanced=C.roleAssignment(DB,s.player,id,s);assert.equal(balanced.type,'positionVersatile');assert.equal(balanced.coverage,2);
 C.coachStrategy(DB,s,id).personality='conviction';const conviction=C.roleAssignment(DB,s.player,id,s);C.coachStrategy(DB,s,id).personality='flexible';const flexible=C.roleAssignment(DB,s.player,id,s);assert.ok(conviction.benchChance<balanced.benchChance&&balanced.benchChance<flexible.benchChance);
 s.player.traits.adaptability=DB.profile.positionUsage.adaptabilityFloor;assert.equal(C.roleAssignment(DB,s.player,id,s).benchChance,DB.engine.selection.subChance);
 // A strong specialist at ST changes the player's best available role to LW.
 s.world.rosters[id].push({...C.clone(s.world.rosters[id][0]),id:'test:forward',position:'ST',secondaryPosition:'none',tertiaryPosition:'none',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,100]))});
 assert.equal(C.roleAssignment(DB,s.player,id,s).position,'LW');s.player.secondaryPosition='none';s.player.tertiaryPosition='none';assert.equal(C.roleAssignment(DB,s.player,id,s).position,'ST');
 s.player.position='LW';C.coachStrategy(DB,s,id).planA='352';const missing=C.roleAssignment(DB,s.player,id,s);assert.equal(missing.position,'LW');assert.equal(missing.available,false);assert.equal(C.selection(DB,s),0);
 s._strategy={teams:{[id]:{tactic:'352',experiment:true}}};assert.equal(C.roleAssignment(DB,s.player,id,s).available,false);
 s.player.secondaryPosition='ST';assert.equal(C.roleAssignment(DB,s.player,id,s).position,'ST');assert.ok(C.selection(DB,s)>0);
 // GK cannot become an outfield option through an optional role.
 s.player.position='GK';s.player.secondaryPosition='ST';assert.equal(C.roleAssignment(DB,s.player,id,s).position,'GK');
});

test('live tactical changes retain declared roles, reject an unavailable specialist role, and substitute into an eligible current slot',()=>{
 const s=career(),id=tactical(s),other=europe.alternatives[1].id,db=C.clone(DB);db.strategyRules.liveChanceCap=1;db.leagueMetaRules.adaptFloor=1;db.leagueMetaRules.adaptWeight=0;db.strategyRules.personalities.forEach(p=>p.liveChance=1);
 const makeTeam=(club,player=true)=>({club,tactic:C.clone(DB.tactics.find(t=>t.id==='433')),stats:{goals:0},redIds:[],players:DB.tactics.find(t=>t.id==='433').formation.map((position,slot)=>({id:player&&slot===8?'player':club+':'+slot,position,slot,entryMinute:1,exitMinute:90}))});
 const setup=()=>{const teams=[makeTeam(id),makeTeam(other,false)];teams[1].stats.goals=1;s._strategy={fixture:'live-role-test',teams:Object.fromEntries([id,other].map(club=>[club,{profile:{personality:'balanced',planA:'433',planB:'352'},tactic:'433',liveMinute:60,changes:[],experiment:false}]))};return teams;};
 s.player.position='LW';let teams=setup();C.strategyLive(db,s,teams,60,[]);assert.equal(teams[0].tactic.id,'433');assert.equal(teams[0].players.find(p=>p.id==='player').position,'LW');
 s.player.secondaryPosition='ST';teams=setup();C.strategyLive(db,s,teams,60,[]);assert.equal(teams[0].tactic.id,'352');assert.equal(teams[0].players.find(p=>p.id==='player').position,'ST');assert.equal(new Set(teams[0].players.map(p=>p.slot)).size,11);
 // Execute the actual simulation's substitution closure after a formation remap.
 const start=engine.indexOf('    const substitute=(side,'),end=engine.indexOf('    const injuryCheck=',start),source=engine.slice(start,end);
 teams=[{club:id,players:[{id:'wrong-slot',position:'CM',slot:6,entryMinute:1,exitMinute:90,stats:s.player.stats},{id:'forward',position:'ST',slot:10,entryMinute:1,exitMinute:90,stats:s.player.stats},{id:'player',position:'LW',slot:8,entryMinute:91,exitMinute:90}],redIds:[],substitutions:0,subWindows:[]}];
 const sandbox=vm.createContext({db:DB,state:s,teams,duration:90,events:[],registeredPositions:C.registeredPositions,suitability:C.suitability,roleFit:(db,p,position)=>C.registeredPositions(db,p).indexOf(position)===0?1:.88});vm.runInContext(source+';globalThis.substitute=substitute;',sandbox);
 assert.equal(sandbox.substitute(0,'wrong-slot','player',70),true);assert.equal(teams[0].players[0].replaced,undefined);assert.equal(teams[0].players[1].replaced,true);assert.equal(teams[0].players[2].position,'ST');
 s.player.secondaryPosition='none';s.player.tertiaryPosition='none';teams[0].players[2].entryMinute=91;teams[0].players[1].replaced=false;teams[0].players[1].exitMinute=90;assert.equal(sandbox.substitute(0,'wrong-slot','player',71),false);
});

test('specialist and optional-role saves round-trip, old declared positions and contracts stay intact, and malformed references fail',()=>{
 const s=career(),saved={schema:DB.meta.schema,db:DB,state:s};ctx.V.validateSave(saved);const loaded=ctx.V.prepareImportedCareer(saved);assert.equal(loaded.state.player.secondaryPosition,'none');assert.equal(loaded.state.player.tertiaryPosition,'none');assert.equal(loaded.state.player.contract.weekly,s.player.contract.weekly);
 const legacyDB=C.clone(DB);legacyDB.meta.version='20.8.10';delete legacyDB.profile.optionalPositionId;delete legacyDB.profile.positionUsage;delete legacyDB.startingRouteRules.initialContract;
 s.player.secondaryPosition='LW';s.player.tertiaryPosition='AM';s.player.contract.weekly=9000;const old=ctx.V.prepareImportedCareer({schema:DB.meta.schema,db:legacyDB,state:s});assert.deepEqual(plain([old.state.player.position,old.state.player.secondaryPosition,old.state.player.tertiaryPosition]),['ST','LW','AM']);assert.equal(old.state.player.contract.weekly,9000);assert.equal(old.db.profile.optionalPositionId,'none');
 for(const mutate of [p=>p.position='none',p=>p.secondaryPosition='missing',p=>{p.secondaryPosition='none';p.tertiaryPosition='AM';}]){const bad=career();mutate(bad.player);assert.throws(()=>ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:bad}));}
 const bad=C.clone(DB);bad.startingRouteRules.initialContract.europe.maximumMonthlyKRW=100;assert.throws(()=>ctx.V.validateDB(bad));
});
