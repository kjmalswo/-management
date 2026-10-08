const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=id=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1];
const DB=JSON.parse(section('game-db'));
const ctx=vm.createContext({});
vm.runInContext(section('game-engine')+';globalThis.Core=FootballCore;',ctx);
const C=ctx.Core;
const ui=section('game-ui');
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast('));
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)};const Core=FootballCore;const t=key=>key;${validators};globalThis.validation={validateDB,validateSave};`,ctx);
const profile=(position=DB.profile.defaults.position)=>({...C.clone(DB.profile.defaults),position,stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))});
const create=(route='domestic',position)=>{const p=profile(position),o=C.startingOffers(DB,p).find(o=>o.route.id===route);return C.createCareer(DB,p,route,o.club.id);};
const normalize=value=>JSON.parse(JSON.stringify(value));
function verifyReport(result){
  for(const [side,other] of [['home','away'],['away','home']]){
    const team=result[side],opponent=result[other],sum=key=>team.players.reduce((n,p)=>n+p.match[key],0),s=team.stats;
    for(const key of DB.ui.statFields.filter(f=>!f.derived&&!['rating','minutes'].includes(f.id)).map(f=>f.id))assert.ok(Math.abs(sum(key)-s[key])<Number.EPSILON*DB.rules.scale*DB.rules.scale,`${side} ${key} totals`);
    assert.ok(s.goals<=s.onTarget&&s.onTarget<=s.shots);
    assert.equal(s.saves,opponent.stats.onTarget-opponent.stats.goals);
    assert.ok(s.assists<=s.goals);
    assert.ok(s.completed<=s.passes&&s.longCompleted<=s.longPasses);
    assert.ok(s.tacklesWon<=s.tackles&&s.dribblesWon<=s.dribbles);
    assert.ok(s.aerialsWon<=s.aerials&&s.duelsWon<=s.duels);
    for(const person of team.players){const p=person.match;assert.ok(p.minutes<=result.duration&&p.minutes>=0);assert.ok(p.goals<=p.onTarget&&p.onTarget<=p.shots);assert.ok(p.completed<=p.passes);if(!p.minutes)for(const key of Object.keys(p))assert.equal(p[key],0);}
    for(const event of result.events)if(event.type==='goalEvent')assert.notEqual(event.player,event.assister);
  }
  assert.ok(Math.abs(result.home.stats.possession+result.away.stats.possession-DB.rules.scale)<Number.EPSILON*DB.rules.scale);
  assert.equal(result.home.stats.duels,result.away.stats.duels);
  assert.equal(result.home.stats.duelsWon+result.away.stats.duelsWon,result.home.stats.duels);
}
test('all countries produce domestic, European and academy offers',()=>{
  for(const country of DB.countries){const p={...profile(),country:country.id},offers=C.startingOffers(DB,p);assert.equal(offers.length,DB.routes.length);assert.equal(offers[0].club.league,country.league);assert.ok(offers[2].club.parent);}
  for(const seed of [0,1,2,3,4]){const p={...profile(),startingSeed:seed},offer=C.startingOffers(DB,p).find(o=>o.route.id==='academy'),parent=C.indexes(DB).clubs[offer.club.parent];assert.ok(DB.startingRouteRules.academyTiers.includes(parent.prestigeTier));assert.equal(C.indexes(DB).leagues[offer.club.league].country,C.indexes(DB).leagues[parent.league].country);}
});
test('round robin contains each home/away pair once and no round double booking',()=>{
  for(const league of DB.leagues.filter(l=>!['continental','postseason'].includes(l.kind))){const fixtures=C.schedule(DB,league.id,1,DB.meta.initialDate),teams=DB.clubs.filter(c=>!c.historical&&c.league===league.id);assert.equal(fixtures.length,teams.length*(teams.length-1)*(league.scheduleLegs===1?.5:1));const pairs=new Set(fixtures.map(f=>`${f.home}:${f.away}`));assert.equal(pairs.size,fixtures.length);for(const round of new Set(fixtures.map(f=>f.round))){const ids=fixtures.filter(f=>f.round===round).flatMap(f=>[f.home,f.away]);assert.equal(ids.length,new Set(ids).size);}}
});
test('deterministic detailed reports, every position and availability restrictions',()=>{
  for(const position of DB.positions){const state=create('domestic',position.id),f=state.fixtures[C.indexes(DB).clubs[state.player.club].league].find(f=>f.home===state.player.club||f.away===state.player.club);state.player.trust=DB.rules.scale;state.player.fitness=DB.rules.scale;
    const a=C.simulate(DB,f,state),b=C.simulate(DB,f,state);assert.deepEqual(normalize(a),normalize(b));verifyReport(a);
    for(const unavailable of ['injury','suspension']){state.player[unavailable]=1;const r=C.simulate(DB,f,state);assert.equal(r.player.minutes,0);assert.equal(r.appearance,'unused');state.player[unavailable]=0;}
    state.player.fitness=DB.rules.minimumFitnessForSelection-1;assert.equal(C.simulate(DB,f,state).player.minutes,0);
  }
});
test('calibrated aggregate football output and coherent player/team records',()=>{
  const calibration=DB.calibration,base=create(),league=C.indexes(DB).clubs[base.player.club].league,fixture=base.fixtures[league][0];let shots=0,goals=0,passes=0,completed=0;
  for(let i=0;i<calibration.samples;i++){const result=C.simulate(DB,{...fixture,id:`calibration:${i}`});verifyReport(result);for(const side of ['home','away']){shots+=result[side].stats.shots;goals+=result[side].stats.goals;passes+=result[side].stats.passes;completed+=result[side].stats.completed;}}
  const values={shots:shots/calibration.samples,goals:goals/calibration.samples,passesPerTeam:passes/(calibration.samples*2),passAccuracy:completed/passes};
  assert.ok(values.shots>=calibration.meanShotsMin&&values.shots<=calibration.meanShotsMax,JSON.stringify(values));assert.ok(values.goals>=calibration.meanGoalsMin&&values.goals<=calibration.meanGoalsMax,JSON.stringify(values));assert.ok(values.passesPerTeam>=calibration.meanPassesMin&&values.passesPerTeam<=calibration.meanPassesMax,JSON.stringify(values));assert.ok(values.passAccuracy>=calibration.passAccuracyMin&&values.passAccuracy<=calibration.passAccuracyMax,JSON.stringify(values));console.log('Calibration',values);
});
test('calendar advances a complete season and records league/cup results coherently',()=>{
  const state=C.createCareer(DB,profile(),'domestic','en1-0'),league='en-1';let count=0,reports=0;
  while(C.nextCalendar(state)){const previous=state.date,result=C.advance(DB,state);assert.ok(state.date>=previous);if(result.report){reports++;verifyReport(result.report.result);}assert.ok(++count<500);}
  assert.ok(C.seasonReady(state));assert.equal(C.standings(DB,state,league).length,20);assert.ok(C.standings(DB,state,league).every(t=>t.played===38));assert.equal(state.player.history.length,reports);
  for(const id of ['ucl','uel','uecl']){const matches=state.fixtures[id];assert.equal(matches.filter(f=>f.stage==='final').length,1);assert.ok(matches.at(-1).result.winner);for(const f of matches.filter(f=>f.result.penalties))assert.equal(f.result.winner,f.result.penalties[0]>f.result.penalties[1]?f.home:f.away);}
  assert.equal(C.advance(DB,state),false);assert.ok(C.nextSeason(DB,state));assert.equal(state.season,2);assert.equal(state.archives.length,1);assert.ok(ctx.validation.validateSave({schema:DB.meta.schema,db:DB,state}));
});
test('actual arrival starts the offer grace period; renewals and free agents remain distinct',()=>{
  const state=create(),candidate=DB.clubs.find(c=>!c.parent&&!c.historical&&c.id!==state.player.club);state.player.freeAgent=true;state.world.clubs[candidate.id].finance=DB.dynamics.financeMax;
  C.refreshOffers(DB,state);assert.equal(state.offers.length,0);for(let attempt=0;attempt<40&&!state.offers.length;attempt++){state.date=state.marketReview.date;C.refreshOffers(DB,state);}const offer=state.offers[0];assert.ok(offer);const target=offer.club;state.world.clubs[target].finance=DB.dynamics.financeMax;
  const deal=C.startDeal(DB,state,target);assert.ok(deal);deal.status='ready';deal.awaiting=false;deal.seller.status=deal.buyer.status=deal.agent.status='agreed';deal.terms.fee=0;deal.terms.signingBonus=0;
  const inquiry={id:'stale-contact',club:candidate.id,sourceClub:state.player.club,date:C.dateAdd(state.date,2),resolved:false};state.agentInquiries.push(inquiry);state.calendar.entries.push({id:inquiry.id,date:inquiry.date,type:'contact',name:'test',priority:1,completed:false});
  assert.ok(C.signDeal(DB,state,deal.id));assert.equal(state.player.club,target);assert.equal(inquiry.resolved,true);assert.ok(state.calendar.entries.find(e=>e.id===inquiry.id).completed);assert.ok(C.newClubGrace(DB,state));
  state.player.reputation=DB.rules.scale;C.refreshOffers(DB,state);assert.equal(state.offers.length,0);const joined=state.player.lastClubChangeDate;state.date=C.dateAdd(joined,DB.offerRules.newClubGraceDays-1);assert.ok(C.newClubGrace(DB,state));state.date=C.dateAdd(joined,DB.offerRules.newClubGraceDays);assert.equal(C.newClubGrace(DB,state),null);
  state.player.freeAgent=true;state.date=joined;assert.equal(C.newClubGrace(DB,state),null);
  const renewed=create();renewed.date=C.dateAdd(renewed.date,DB.offerRules.newClubGraceDays);renewed.player.contract.arrivalDate=renewed.date;renewed.player.career.push({season:renewed.season,date:renewed.date,club:renewed.player.club,type:'renewed'});assert.equal(C.newClubGrace(DB,renewed),null);
});
test('database edits and save imports reject broken references before changing state',()=>{
  const state=create();while(!state.player.history.length)C.advance(DB,state);const envelope={schema:DB.meta.schema,db:C.clone(DB),state:C.clone(state)};
  assert.ok(ctx.validation.validateDB(DB));assert.ok(ctx.validation.validateSave(envelope));
  const invalidState=C.clone(envelope);delete invalidState.state.player.history[0].result.home.players[0].match;assert.throws(()=>ctx.validation.validateSave(invalidState));
  const invalidDB=C.clone(DB);invalidDB.clubs=invalidDB.clubs.filter(c=>c.id!==state.player.club);assert.throws(()=>ctx.validation.validateDB(invalidDB,state));
  const invalidField=C.clone(DB);invalidField.ui.statFields=invalidField.ui.statFields.filter(f=>f.id!=='goals');assert.throws(()=>ctx.validation.validateDB(invalidField));
  const invalidWeight=C.clone(DB);invalidWeight.positions[0].weights.shooting=DB.rules.scale;assert.throws(()=>ctx.validation.validateDB(invalidWeight));
  const expanded=C.clone(DB),source=expanded.clubs.find(c=>c.league==='kr-2');expanded.clubs.push({...source,id:'new-club',name:'새 클럽'});assert.ok(ctx.validation.validateDB(expanded,state));assert.equal(C.schedule(expanded,'kr-2',1,DB.meta.initialDate).length,expanded.clubs.filter(c=>c.league==='kr-2').length*(expanded.clubs.filter(c=>c.league==='kr-2').length-1));
  const roster=C.roster(DB,state.player.club);assert.equal(new Set(roster.map(p=>p.name)).size,roster.length);
});

test('season labels and club careers show full years, overlapping summer years and newest first',()=>{
  const state=create();state.player.career=[{date:'2026-08-01',season:1,club:'kr1-0',type:'joined'},{date:'2028-07-10',season:2,club:'en1-0',type:'joined'},{date:'2028-08-01',season:3,club:'en1-0',type:'renewed'},{date:'2029-07-20',season:3,club:'us1-3',type:'joined'}];state.player.club='us1-3';
  const rows=C.clubCareerRecords(DB,state);assert.deepEqual(normalize(rows.map(r=>r.period)),['2029~','2028~2029','2026~2028']);
  vm.runInContext('const DB=DEFAULT_DB;'+ui.slice(ui.indexOf('const seasonLabel='),ui.indexOf('const abilityLabel='))+';globalThis.label=seasonLabel;',ctx);
  assert.equal(ctx.label(1),'2026~2027');assert.equal(ctx.label(4),'2029~2030');
  state.player.freeAgent=true;state.seasonStart='2030-08-01';state.player.contract.expiresSeason=5;state.season=5;assert.equal(C.clubCareerRecords(DB,state)[0].period,'2029~2030');
});

test('vacations charge the departure lifestyle and reduce fitness, fatigue and form without training',()=>{
  const state=create();C.careerIncome(DB,state,100000,'salary');state.player.fitness=90;state.trainingProgram.fatigue=70;
  const start=C.dateAdd(state.date,1),quote=C.vacationQuote(DB,state,'hawaii',7),approval=C.requestVacation(DB,state,'hawaii',start,7);assert.ok(approval.ok);assert.equal(state.economy.ledger.filter(l=>l.type==='vacation').length,0);
  assert.ok(C.lifestyleChange(DB,state,'comfortable'));const charged=C.vacationQuote(DB,state,'hawaii',7);assert.equal(charged,quote*3);let count=0;
  while(state.vacations[0].status!=='completed'){assert.ok(C.advance(DB,state));assert.ok(++count<20);if(C.vacationActive(state)){assert.equal(C.selection(DB,state),0);assert.equal(C.trainingSession(DB,state).kind,'vacation');}}
  const v=state.vacations[0],sessions=state.trainingProgram.sessions.filter(day=>day.date>=v.start&&day.date<=v.end);assert.equal(sessions.length,7);assert.ok(sessions.every(day=>day.kind==='vacation'&&day.load===0));assert.equal(v.cost,charged);assert.equal(v.lifestyle,'comfortable');assert.equal(state.economy.ledger.filter(l=>l.type==='vacation').length,1);
  assert.equal(state.economy.ledger.find(l=>l.type==='vacation').amount,-charged);assert.ok(state.player.fitness<90);assert.ok(state.trainingProgram.fatigue<=DB.vacationRules.fatigueCeiling);assert.ok(state.player.vacationForm<0);assert.ok(C.currentForm(DB,state.player)<DB.engine.selection.formCenter);assert.ok(ctx.validation.validateSave({schema:DB.meta.schema,db:DB,state}));
});

test('vacation approval rejects match conflicts, bad dates, missing funds and pre-season overruns',()=>{
  const state=create();C.careerIncome(DB,state,100000,'salary');const fixture=C.myFixtures(state).find(f=>!f.national);assert.equal(C.requestVacation(DB,state,'nice',fixture.date,3).issue,'vacationDenied');
  assert.equal(C.requestVacation(DB,state,'nice','2026-02-30',3).issue,'vacationDenied');assert.equal(C.requestVacation(DB,state,'nice',C.dateAdd(state.seasonStart,364),7).issue,'vacationDenied');
  const poor=create();poor.economy.arrears=1;assert.equal(C.requestVacation(DB,poor,'tokyo',C.dateAdd(poor.date,1),7).issue,'vacationFunds');
  const request=C.requestVacation(DB,state,'tokyo',C.dateAdd(state.date,1),7);assert.ok(request.ok);assert.ok(C.cancelVacation(DB,state,request.id));assert.ok(state.calendar.entries.filter(e=>e.vacation===request.id).every(e=>e.completed));
  const another=C.requestVacation(DB,state,'rio',C.dateAdd(state.date,1),7);assert.ok(another.ok);const league=C.indexes(DB,state).clubs[state.player.club].league;state.fixtures[league].push({...C.clone(fixture),id:'late-conflict',date:C.dateAdd(state.date,2),result:null});let count=0;while(state.vacations.at(-1).status==='approved'){C.advance(DB,state);assert.ok(++count<10);}assert.equal(state.vacations.at(-1).status,'cancelled');assert.equal(state.economy.ledger.filter(l=>l.type==='vacation').length,0);
});

test('extreme spotlight performances swing reputation and real form; ordinary games do not',()=>{
  const state=create();state.player.reputation=50;const row=rating=>({id:'spotlight:'+rating,date:state.date,season:1,league:'ucl',competition:'ucl',stage:'final',home:state.player.club,away:'en1-0',club:state.player.club,stats:{...C.createStats(DB),minutes:90,rating},result:{home:{stats:{goals:1}},away:{stats:{goals:0}}},reactions:{fans:'fans',press:'press'}});
  const before=C.currentForm(DB,state.player),good=row(9.5),impact=C.applySpotlight(DB,state,good);assert.ok(impact.reputation>=8);assert.ok(state.player.reputation>50);assert.ok(C.currentForm(DB,state.player)>before);assert.ok(good.reactions.press.includes(state.player.name));
  const poor=row(4.5),bad=C.applySpotlight(DB,state,poor);assert.ok(bad.reputation<-8);assert.ok(bad.form<0);assert.equal(C.spotlightImpact(DB,state,{...row(7),stage:'league'}),null);
  const normal={...row(9.5),league:'kr-2',competition:'kr-2',stage:'league',home:'kr2-0',away:'kr2-1'};assert.equal(C.spotlightImpact(DB,state,normal),null);
  const national={...row(4.5),id:'national-final',national:true,league:'world-cup',competition:'world-cup',home:'nt-kr',away:'nt-jp',club:'nt-kr'};assert.ok(C.applySpotlight(DB,state,national).reputation<0);
});

test('proven players aged 30+ receive funded Gulf and MLS offers with materially higher wages',()=>{
  const state=create();state.player.age=33;state.player.reputation=70;state.player.stats=Object.fromEntries(DB.attributes.map(a=>[a.id,75]));state.player.contract.weekly=10000;state.player.freeAgent=true;
  state.player.history=Array.from({length:12},(_,i)=>({id:'proof:'+i,date:C.dateAdd(state.date,-i),season:1,club:state.player.club,league:'en-1',home:state.player.club,away:'en1-0',stats:{...C.createStats(DB),minutes:90,rating:7.5}}));
  assert.ok(C.lateCareerQualified(DB,state));for(const club of ['al-hilal','al-sadd','al-ain','us1-3']){const c=C.indexes(DB,state).clubs[club],candidate=C.scoutingCandidate(DB,state,c),limits=C.buyerLimits(DB,state,club);assert.ok(candidate?.lateCareer,club);assert.ok(limits.weekly>50000,club);}
  C.refreshOffers(DB,state);for(let review=0;review<8&&!state.offers.some(o=>o.context.lateCareer);review++){state.date=state.marketReview.date;C.refreshOffers(DB,state);}const offer=state.offers.find(o=>o.context.lateCareer);assert.ok(offer);assert.equal(offer.source,'late-career');assert.ok(offer.terms.weekly>50000);assert.ok(offer.terms.signingBonus>0);assert.equal(state.world.clubs[offer.club].marqueeFundingSeason,state.season);
  const deal=C.startDeal(DB,state,offer.club);assert.ok(deal);assert.ok(C.buyerLimits(DB,state,offer.club).maxWeekly>=offer.terms.weekly);
  state.player.age=29;assert.equal(C.lateCareerQualified(DB,state),false);assert.equal(C.lateCareerBuyer(DB,state,C.indexes(DB,state).clubs['al-hilal']),null);
});
