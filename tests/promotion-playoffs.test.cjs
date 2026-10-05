const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1],DB=JSON.parse(section('game-db')),ctx=vm.createContext({});
vm.runInContext(section('game-engine').replace('return {rolePerformance,','return {recordCompetitionStats,rolePerformance,')+';globalThis.C=FootballCore;',ctx);const C=ctx.C,ui=section('game-ui');
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast(')),imports=ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('));
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)},Core=FootballCore,t=k=>k;${validators}${imports};globalThis.V={validateDB,validateSave,prepareImportedCareer};`,ctx);
const plain=value=>JSON.parse(JSON.stringify(value));let base;
const create=()=>{base??=C.createCareer(DB,{...C.clone(DB.profile.defaults),name:'승강 검증',startingSeed:7,stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))},'domestic','kr2-0');return C.clone(base);};
function completeRegular(s,{gimLast=false,dropParent=null,reserveFirst=null}={},db=DB){
  for(const league of DB.leagues.filter(l=>l.kind==='domestic')){
    let clubs=DB.clubs.filter(c=>!c.parent&&!c.historical&&C.indexes(DB,s).clubs[c.id].league===league.id).map(c=>c.id);
    if(gimLast&&league.id==='kr-1')clubs=[...clubs.filter(id=>id!==DB.postseasonRules.krSpecial.forcedClub),DB.postseasonRules.krSpecial.forcedClub];
    if(clubs.includes(dropParent))clubs=[...clubs.filter(id=>id!==dropParent),dropParent];
    if(clubs.includes(reserveFirst))clubs=[reserveFirst,...clubs.filter(id=>id!==reserveFirst)];
    for(const f of s.fixtures[league.id]||[])f.result={duration:90,home:{stats:{goals:clubs.indexOf(f.home)<clubs.indexOf(f.away)?2:0}},away:{stats:{goals:clubs.indexOf(f.away)<clubs.indexOf(f.home)?2:0}}};
  }
  s.date=C.dateAdd(s.seasonStart,DB.calendarRules.scheduleEnd);s.trainingProgram.reviewDate=C.dateAdd(s.seasonStart,DB.calendarRules.finalDay);C.advancePostseason(db,s);return s;
}
function finish(s,db=DB,{bestOfThree=false}={}){
  for(let pass=0;pass<30;pass++){
    const waiting=Object.values(s.fixtures).flat().filter(f=>f.postseason&&!f.result).sort((a,b)=>a.date.localeCompare(b.date));if(!waiting.length)break;
    for(const f of waiting){s.date=f.date;const result={duration:90,home:{stats:{goals:0}},away:{stats:{goals:0}}};
      if(bestOfThree&&f.tie&&s.postseason.competitions[f.postseason].ties.find(t=>t.id===f.tie).bestOf){result.home.stats.goals=1;result.away.stats.goals=0;}
      if(C.needsPlayoffExtraTime(db,s,f,0,0)){result.extraTime=true;result.regulationDuration=90;result.duration+=db.postseasonRules.extraTimeMinutes;}
      C.resolvePlayoffResult(db,s,f,result);f.result=result;
    }C.advancePostseason(db,s);
  }
  assert.ok(Object.values(s.postseason.competitions).every(t=>t.status==='complete'));return s;
}
test('full new divisions, stable club identities, youth teams and US conference memberships validate',()=>{
  ctx.V.validateDB(DB);assert.equal(DB.clubs.filter(c=>!c.historical&&!c.parent).length,540);
  for(const [id,count] of Object.entries(DB.seasonCatalog.expectedTeams)){const clubs=DB.clubs.filter(c=>!c.parent&&!c.historical&&c.league===id);assert.equal(clubs.length,count);for(const c of clubs)assert.equal(DB.clubs.filter(y=>y.parent===c.id&&!y.historical).length,1);}
  assert.equal(new Set(DB.clubs.filter(c=>!c.parent&&!c.historical).map(c=>c.name)).size,540);
  for(const [id,east,west] of [['us-1',15,15],['us-2',13,12]]){assert.equal(DB.clubs.filter(c=>c.league===id&&c.conference==='east').length,east);assert.equal(DB.clubs.filter(c=>c.league===id&&c.conference==='west').length,west);}
  assert.equal(DB.clubs.find(c=>c.id==='en2-4').league,'en-champ');assert.equal(DB.clubs.find(c=>c.id==='es2-0').league,'es-segunda');assert.equal(DB.clubs.find(c=>c.id==='it1-4').league,'it-serieb');
});
test('every supported boundary seeds real playoffs; all US playoff rounds finish without promotion',()=>{
  const s=finish(completeRegular(create()));assert.equal(Object.keys(s.postseason.competitions).length,DB.postseasonRules.boundaries.length+2);
  for(const rule of DB.postseasonRules.boundaries){assert.ok(s.postseason.moves.some(m=>m.reason===rule.id));assert.ok(s.postseason.competitions[rule.id].ties.length||rule.automaticGap);}
  assert.ok(s.postseason.moves.every(m=>!m.from.startsWith('us-')&&!m.to.startsWith('us-')));
  for(const id of ['mls-cup','usl-cup']){const t=s.postseason.competitions[id];assert.ok(t.champion);assert.ok(t.ties.every(t=>t.winner));assert.equal(t.ties.filter(t=>t.id==='final').length,1);}
  assert.equal(s.postseason.competitions.en12.ties.length,5);assert.equal(s.postseason.competitions.br12.ties.length,2);
  assert.equal(s.postseason.moves.filter(m=>m.reason==='br23'&&m.to==='br-serieb').length,4);
  assert.equal(s.fixtures['post-br23'].filter(f=>f.group).length,24);
  const domesticBefore=JSON.stringify(C.standings(DB,s,'kr-2'));C.advancePostseason(DB,s);assert.equal(JSON.stringify(C.standings(DB,s,'kr-2')),domesticBefore);
  const allFixtures=Object.values(s.fixtures).flat();for(const club of DB.clubs.filter(c=>!c.parent&&!c.historical)){const dates=allFixtures.filter(f=>f.home===club.id||f.away===club.id).map(f=>f.date).sort();for(let i=1;i<dates.length;i++)assert.ok((Date.parse(dates[i])-Date.parse(dates[i-1]))/86400000>=DB.calendarRules.minimumMatchGapDays,club.id);}
});
test('Korean 2026 expansion handles Gimcheon last and non-last with distinct playoff formats',()=>{
  for(const gimLast of [true,false]){const s=finish(completeRegular(create(),{gimLast})),t=s.postseason.competitions.kr12,final=t.ties.find(t=>t.id==='final');assert.equal(final.legs,gimLast?2:1);assert.equal(t.ties.some(t=>t.id==='exchange'),!gimLast);assert.equal(s.postseason.moves.find(m=>m.club===DB.postseasonRules.krSpecial.forcedClub).to,'kr-2');
    C.applyPromotionOutcomes(DB,s);assert.equal(DB.clubs.filter(c=>!c.parent&&!c.historical&&s.world.clubs[c.id].league==='kr-1').length,14);
  }
});
test('two legs use aggregate scores; an undecided first leg has no shootout, while decisive ties use the configured rule',()=>{
  const s=completeRegular(create()),t=s.postseason.competitions.de12,tie=t.ties[0],list=tie.fixtures.map(id=>s.fixtures[t.competition].find(f=>f.id===id)),result=()=>({duration:90,home:{stats:{goals:0}},away:{stats:{goals:0}}});
  let first=result();C.resolvePlayoffResult(DB,s,list[0],first);assert.equal(first.winner,undefined);assert.equal(C.needsPlayoffExtraTime(DB,s,list[0],0,0),false);list[0].result=first;
  assert.equal(C.needsPlayoffExtraTime(DB,s,list[1],0,0),true);let last=result();C.resolvePlayoffResult(DB,s,list[1],last);assert.ok(last.winner);assert.notEqual(...last.penalties);assert.equal(last.home.stats.goals+last.away.stats.goals,0);
  const seeded={...list[1],drawRule:'seed'};last=result();C.resolvePlayoffResult(DB,s,seeded,last);assert.equal(last.winner,seeded.preferred);assert.equal(last.seedAdvantage,true);assert.equal(last.penalties,undefined);
});
test('MLS best-of-three schedules the third match only when necessary and uses no extra time in initial rounds',()=>{
  const s=finish(completeRegular(create()),DB,{bestOfThree:true}),ties=s.postseason.competitions['mls-cup'].ties.filter(t=>t.bestOf);
  assert.equal(ties.length,8);for(const tie of ties){assert.equal(tie.fixtures.length,3);for(const id of tie.fixtures){const f=s.fixtures['post-mls-cup'].find(f=>f.id===id);assert.equal(C.needsPlayoffExtraTime(DB,s,f,0,0),false);assert.equal(f.drawRule,'penalties');}}
});
test('reserve sides cannot promote into the parent division or from German tier three',()=>{
  const s=create(),german=DB.clubs.find(c=>c.league==='de-2'&&c.reserveParent),portuguese=DB.clubs.find(c=>c.league==='pt-liga2'&&c.reserveParent),spanish=DB.clubs.find(c=>c.league==='es-segunda'&&c.reserveParent);assert.ok(german&&portuguese&&spanish);
  assert.equal(C.promotionEligible(DB,s,german.id,'de-bundesliga2'),false);assert.equal(C.promotionEligible(DB,s,portuguese.id,'pt-1'),false);assert.equal(C.promotionEligible(DB,s,spanish.id,'es-1'),false);
});
test('a Spanish reserve follows a relegated parent out of the second division and preserves four relegation slots',()=>{
  const reserve=DB.clubs.find(c=>c.league==='es-segunda'&&c.reserveParent),s=completeRegular(create(),{dropParent:reserve.reserveParent,reserveFirst:reserve.id});
  assert.equal(s.postseason.moves.find(m=>m.club===reserve.reserveParent).to,'es-segunda');
  assert.ok(['es-2','es-2-b'].includes(s.postseason.moves.find(m=>m.club===reserve.id).to));
  assert.equal(s.postseason.moves.filter(m=>m.from==='es-segunda'&&['es-2','es-2-b'].includes(m.to)).length,4);
  assert.ok(!Object.values(s.postseason.competitions.es12.seeds).some(seed=>seed.club===reserve.id));
});
test('a saved playoff bracket resumes deterministically, blocks season transition, and carries final membership to youth and next fixtures',()=>{
  const s=completeRegular(create());for(const e of s.calendar.entries)e.completed=true;s.calendar.ended=true;assert.equal(C.seasonReady(s),false);
  const loaded=C.normalizeCareerSave(DB,C.clone(s));ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:loaded});finish(s);finish(loaded);assert.deepEqual(plain(loaded.postseason),plain(s.postseason));
  for(const e of loaded.calendar.entries)e.completed=true;loaded.calendar.ended=true;assert.equal(C.nextSeason(DB,loaded),true);assert.equal(loaded.archives[0].postseason.competitions['mls-cup'].status,'complete');
  for(const club of DB.clubs.filter(c=>!c.parent&&!c.historical)){const league=loaded.world.clubs[club.id].league;assert.ok(loaded.fixtures[league].some(f=>f.home===club.id||f.away===club.id));const youth=DB.clubs.find(c=>c.parent===club.id);assert.equal(loaded.world.clubs[youth.id].league,DB.leagues.find(l=>l.id===league).youthLeague);}
  assert.equal(DB.clubs.filter(c=>!c.parent&&!c.historical&&['es-2','es-2-b'].includes(loaded.world.clubs[c.id].league)).length,40);ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:loaded});
});
test('an actual detailed playoff extends active players through extra time and isolates competition records',()=>{
  const db=C.clone(DB),s=completeRegular(create()),t=s.postseason.competitions.de12,tie=t.ties[0],first=s.fixtures[t.competition].find(f=>f.id===tie.fixtures[0]),f=s.fixtures[t.competition].find(f=>f.id===tie.fixtures[1]);first.result={duration:90,home:{stats:{goals:0}},away:{stats:{goals:0}}};
  s.player.club=f.home;s.player.position='GK';s.player.trust=s.player.fitness=100;s.date=f.date;db.engine.shot.xgMax=0;db.engine.selection.fullMatchChance=1;
  const r=C.simulate(db,f,s);assert.equal(r.extraTime,true);assert.equal(r.duration,r.regulationDuration+DB.postseasonRules.extraTimeMinutes);assert.ok(r.events.some(e=>e.type==='extraTimeEvent'));assert.equal(r.home.stats.goals+r.away.stats.goals,0);
  for(const side of ['home','away']){assert.equal(r[side].players.reduce((n,p)=>n+p.match.goals,0),r[side].stats.goals);assert.ok(r[side].players.every(p=>p.match.minutes<=r.duration));}
  C.resolvePlayoffResult(db,s,f,r);const regular=JSON.stringify(C.standings(db,s,'de-1'));f.result=r;C.recordCompetitionStats(db,s,f,r);assert.equal(JSON.stringify(C.standings(db,s,'de-1')),regular);assert.ok(s.competitionStats.leagues[t.competition].player);s.player.history.push({...C.clone(f),club:s.player.club,season:s.season,league:t.competition,appearance:r.appearance,stats:C.clone(r.player)});ctx.V.validateSave({schema:db.meta.schema,db,state:s});
});
test('old saves preserve existing results, contracts and promoted teams while deferring absent leagues to the next season',()=>{
  const old=plain(DB),s=create();delete old.postseasonRules;delete s.postseason;
  const extra=new Set(['en-champ','es-segunda','de-bundesliga2','fr-ligue2','it-serieb','pt-liga2','br-serieb','jp-3']);old.leagues=old.leagues.filter(l=>!extra.has(l.id)&&!l.sourceLeagues&&!extra.has(l.parentLeague));old.clubs=old.clubs.filter(c=>old.leagues.some(l=>l.id===c.league));for(const id of Object.keys(s.fixtures))if(!old.leagues.some(l=>l.id===id))delete s.fixtures[id];
  s.world.clubs['kr2-0'].league='kr-1';s.world.clubs['kr1-0'].league='kr-2';C.applyClubPolicy(DB,s);s.fixtures['kr-1']=C.schedule(DB,'kr-1',s.season,s.seasonStart,s);s.fixtures['kr-2']=C.schedule(DB,'kr-2',s.season,s.seasonStart,s);const first=s.fixtures['kr-2'][0];first.result={duration:90,home:{stats:{goals:1}},away:{stats:{goals:0}}};s.world.clubs['kr2-0'].league='kr-1';old.meta.version='15.0.2';delete old.careerDecisionRules.rewardRevision;const before=plain({fixtures:s.fixtures,contract:s.player.contract,stats:s.player.stats});const loaded=ctx.V.prepareImportedCareer({schema:old.meta.schema,db:old,state:s});assert.deepEqual(plain(loaded.state.fixtures),before.fixtures);assert.deepEqual(plain(loaded.state.player.contract),before.contract);assert.deepEqual(plain(loaded.state.player.stats),before.stats);assert.equal(loaded.state.world.clubs['kr2-0'].league,'kr-1');assert.ok(loaded.state.postseason.deferred.includes('en-champ'));assert.equal(loaded.db.careerDecisionRules.focusDays,21);ctx.V.validateSave(loaded);
  const late=C.clone(s);late.date=C.dateAdd(late.seasonStart,DB.calendarRules.finalDay);late.trainingProgram.reviewDate=late.date;delete late.postseason;const after=ctx.V.prepareImportedCareer({schema:old.meta.schema,db:old,state:late});assert.ok(after.state.postseason.deferred.includes('kr-1'));assert.doesNotThrow(()=>C.advancePostseason(after.db,after.state));
});
test('invalid bracket references and duplicate movement data are rejected',()=>{
  const broken=C.clone(DB);broken.postseasonRules.boundaries[0].nodes[0].home='w:missing';assert.throws(()=>ctx.V.validateDB(broken),/postseason.node/);
  const s=completeRegular(create());s.postseason.moves.push(C.clone(s.postseason.moves[0]));assert.throws(()=>ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:s}),/postseason.state/);
});

test('normal Korean playoffs use actual bottom ranks in legacy twelve-team seasons',()=>{
  const s=create();s.seasonStart='2028-08-01';s.date=s.seasonStart;delete s.postseason;
  completeRegular(s);const t=s.postseason.competitions.kr12,upper=C.standings(DB,s,'kr-1');
  assert.equal(upper.length,12);
  assert.equal(t.nodes.find(n=>n.id==='exchange1').home,'u'+(upper.length-2));
  assert.equal(t.nodes.find(n=>n.id==='exchange2').home,'u'+(upper.length-1));
  finish(s);assert.equal(t.status,'complete');
  assert.equal(s.postseason.moves.filter(m=>m.reason==='kr12'&&m.to==='kr-2').length,s.postseason.moves.filter(m=>m.reason==='kr12'&&m.to==='kr-1').length);
});

test('a legacy season-end deadlock recovers without rewriting any created match or player record',()=>{
  const old=C.clone(DB);delete old.postseasonRules.boundaries.find(r=>r.id==='kr12').upperSeedOffsets;
  const s=create();s.seasonStart='2028-08-01';s.date=s.seasonStart;delete s.postseason;
  finish(completeRegular(s,{},old),old);const t=s.postseason.competitions.kr12;
  assert.equal(t.ties.length,3);assert.equal(t.seeds.u13,undefined);
  t.nodes.push(C.clone(old.postseasonRules.boundaries.find(r=>r.id==='kr12').nodes.find(n=>n.id==='exchange2')));t.status='playing';
  s.date=C.dateAdd(s.seasonStart,DB.calendarRules.finalDay);for(const e of s.calendar.entries)e.completed=true;s.calendar.ended=true;
  assert.equal(C.nextCalendar(s),null);assert.equal(C.seasonReady(s),false);
  const before=plain({fixtures:s.fixtures,player:s.player,moves:s.postseason.moves,date:s.date,ties:t.ties});
  const loaded=ctx.V.prepareImportedCareer({schema:old.meta.schema,db:old,state:s});
  assert.equal(C.seasonReady(loaded.state),true);assert.equal(loaded.state.postseason.competitions.kr12.status,'complete');
  assert.deepEqual(plain({fixtures:loaded.state.fixtures,player:loaded.state.player,moves:loaded.state.postseason.moves,date:loaded.state.date,ties:loaded.state.postseason.competitions.kr12.ties}),before);
  const normalized=plain(loaded.state);C.normalizeCareerSave(loaded.db,loaded.state);assert.deepEqual(plain(loaded.state),normalized);
  assert.equal(C.advance(loaded.db,loaded.state),false);assert.equal(C.nextSeason(loaded.db,loaded.state),true);assert.equal(loaded.state.season,s.season+1);
  const bad=C.clone(DB);bad.postseasonRules.boundaries.find(r=>r.id==='kr12').upperSeedOffsets.u13=0;assert.throws(()=>ctx.V.validateDB(bad),/postseason.upperSeedOffsets/);
});
