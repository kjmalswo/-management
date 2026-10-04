const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=(source,id)=>source.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1],DB=JSON.parse(section(html,'game-db')),ctx=vm.createContext({});
vm.runInContext(section(html,'game-engine').replace('return {rolePerformance,','return {simulateWorldFixture,recordCompetitionStats,rolePerformance,')+';globalThis.C=FootballCore;',ctx);const C=ctx.C,ui=section(html,'game-ui');
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast(')),imports=ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('));
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)},Core=FootballCore,t=k=>k;${validators}${imports};globalThis.V={validateDB,validateSave,prepareImportedCareer};`,ctx);
let base;const create=()=>{base??=C.createCareer(DB,{...C.clone(DB.profile.defaults),name:'유럽 수상 검증',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))},'domestic','kr2-0');return C.clone(base);};
const plain=x=>JSON.parse(JSON.stringify(x)),result=(home=0,away=0)=>({duration:90,home:{stats:{goals:home}},away:{stats:{goals:away}}});
function start(s){for(const c of DB.leagues.filter(l=>l.kind==='continental'))for(const f of s.fixtures[c.id])f.result=result();s.date=C.dateAdd(s.seasonStart,203);C.advanceContinental(DB,s);return s;}
function finish(s){for(let pass=0;pass<12;pass++){
  const games=Object.values(s.fixtures).flat().filter(f=>f.formatRevision&&f.stage!=='league'&&!f.result).sort((a,b)=>a.date.localeCompare(b.date));if(!games.length)break;
  for(const f of games){s.date=f.date;const r=result();if(C.needsPlayoffExtraTime(DB,s,f,0,0)){r.duration=120;r.extraTime=true;r.regulationDuration=90;}C.resolvePlayoffResult(DB,s,f,r);f.result=r;}C.advanceContinental(DB,s);
}return s;}
test('league phases have unique opponents, balanced home/away and match dates outside international breaks',()=>{
 const s=create();ctx.V.validateDB(DB);ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:s});
 for(const c of DB.leagues.filter(l=>l.kind==='continental')){const fixtures=s.fixtures[c.id],clubs=C.competitionMembers(DB,s,c.id);assert.equal(fixtures.length,clubs.length*c.phaseRounds/2);
  for(const club of clubs){const games=fixtures.filter(f=>f.home===club||f.away===club);assert.equal(games.length,c.phaseRounds);assert.equal(games.filter(f=>f.home===club).length,c.phaseRounds/2);assert.equal(new Set(games.map(f=>f.home===club?f.away:f.home)).size,c.phaseRounds);}
 }
 for(const club of DB.clubs.filter(c=>!c.parent&&!c.historical&&DB.continentalRules.domesticLeagues.includes(c.league))){const dates=Object.values(s.fixtures).flat().filter(f=>f.home===club.id||f.away===club.id).map(f=>f.date).sort();for(let i=1;i<dates.length;i++)assert.ok((Date.parse(dates[i])-Date.parse(dates[i-1]))/86400000>=DB.calendarRules.minimumMatchGapDays,club.id+' '+dates[i-1]+' '+dates[i]);}
});
test('ranked playoffs, byes and every two-leg stage resume with the same champion and neutral final',()=>{
 const s=start(create()),loaded=C.normalizeCareerSave(DB,C.clone(s));ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:loaded});finish(s);finish(loaded);assert.deepEqual(plain(loaded.continentalBrackets),plain(s.continentalBrackets));
 for(const c of DB.leagues.filter(l=>l.kind==='continental')){const t=s.continentalBrackets[c.id],format=DB.continentalRules.formats.find(f=>f.id===c.id);assert.equal(t.status,'complete');assert.equal(t.ties.length,format.nodes.length);assert.equal(t.ties.filter(t=>t.stage==='playoff').length,format.bye);
  const final=s.fixtures[c.id].find(f=>f.stage==='final');assert.equal(final.neutral,true);assert.equal(final.legs,1);assert.ok(final.result.penalties);for(const f of s.fixtures[c.id].filter(f=>f.stage!=='league')){assert.equal(f.legs,f.stage==='final'?1:2);assert.equal(Boolean(f.result.penalties),f.decisive);}
 }ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:s});
});
test('aggregate controls progression, first legs stay draws, and away goals never break a tie',()=>{
 const s=start(create()),tie=s.continentalBrackets.ucl.ties[0],[first,last]=tie.fixtures.map(id=>s.fixtures.ucl.find(f=>f.id===id));first.result=result(2,0);C.resolvePlayoffResult(DB,s,first,first.result);assert.equal(first.result.winner,undefined);assert.equal(C.needsPlayoffExtraTime(DB,s,first,2,0),false);
 let r=result(1,0);C.resolvePlayoffResult(DB,s,last,r);assert.equal(r.winner,first.home);assert.equal(r.penalties,undefined);assert.deepEqual(plain(r.aggregate),[1,2]);
 first.result=result(2,1);assert.equal(C.needsPlayoffExtraTime(DB,s,last,1,0),true);r=result(1,0);C.resolvePlayoffResult(DB,s,last,r);assert.ok(r.penalties);assert.deepEqual(plain(r.aggregate),[2,2]);assert.equal(r.home.stats.goals+r.away.stats.goals,1);
});
test('real detailed/world extra-time statistics exclude shootout goals and goal candidates match scored goals',()=>{
 const s=start(create()),tie=s.continentalBrackets.ucl.ties[0],[first,last]=tie.fixtures.map(id=>s.fixtures.ucl.find(f=>f.id===id));s.player.club=last.home;s.player.position='CM';s.player.trust=s.player.fitness=100;s.player.injury=s.player.suspension=0;
 const probe=C.simulate(DB,last,s);first.result={duration:90,home:{stats:{goals:probe.home.stats.goals}},away:{stats:{goals:probe.away.stats.goals}}};const detailed=C.simulate(DB,last,s);assert.equal(detailed.extraTime,true);assert.equal(detailed.duration,detailed.regulationDuration+DB.postseasonRules.extraTimeMinutes);C.resolvePlayoffResult(DB,s,last,detailed);
 for(const side of ['home','away'])for(const key of ['goals','assists','saves','shots','onTarget','passes','completed','xg','xa'])assert.ok(Math.abs(detailed[side].stats[key]-detailed[side].players.reduce((v,p)=>v+p.match[key],0))<1e-8,side+' '+key);
 const world=C.simulateWorldFixture(DB,{...last,matchDuration:120},s);assert.equal(world.duration,120);assert.equal(world.goalMoments.length,world.home.stats.goals+world.away.stats.goals);for(const e of world.goalMoments)assert.ok(world[e.club===last.home?'home':'away'].players.find(p=>p.id===e.playerId).match.goals>0);for(const side of ['home','away'])assert.equal(world[side].players.reduce((v,p)=>v+p.match.minutes,0),120*DB.matchBroadcast.teamSize);
});
test('titles, co-leading scorers, performance awards and Puskas settle once and require actual trophy appearances',()=>{
 const s=create(),league='kr-2',club=s.fixtures[league][0].home;for(const f of s.fixtures[league])f.result=result(f.home===club?3:0,f.away===club?3:0);s.date=C.dateAdd(s.seasonStart,302);
 const row=(id,goals)=>({id,name:id==='player'?s.player.name:'동점 득점 선수',clubs:[club],clubMinutes:{[club]:1800},position:'CM',age:20,minutes:1800,apps:20,goals,assists:14,saves:0,ratedMinutes:1800,ratingMinutes:(id==='player'?8.5:7.5)*1800,roleMinutes:.9*1800});s.competitionStats.leagues[league]={player:row('player',20),other:row('other',20)};
 C.recordAwardGoals(DB,s,s.fixtures[league][0],{events:[{type:'goalEvent',playerId:'player',player:s.player.name,club,minute:12,xg:.04,chance:'long'},{type:'goalEvent',playerId:'player',player:s.player.name,club,minute:40,xg:.75,chance:'penalty'}]});assert.equal(s.awards.bestGoals.length,1);
 C.settleAwards(DB,s);assert.equal(s.awards.records.filter(r=>r.type==='scorer'&&r.competition===league).length,2);assert.ok(s.player.honours.some(r=>r.type==='league-title'&&r.club===club));assert.ok(s.player.honours.some(r=>r.type==='player-year'));
 const snapshot=JSON.stringify(s.player.honours);C.settleAwards(DB,s);assert.equal(JSON.stringify(s.player.honours),snapshot);
 const absent=create();for(const f of absent.fixtures[league])f.result=result();C.settleAwards(DB,absent);assert.equal(absent.player.honours.filter(r=>DB.awardTypes.find(t=>t.id===r.type).kind==='trophy').length,0);
 for(const e of s.calendar.entries)e.completed=true;s.calendar.ended=true;s.postseason={season:s.season,competitions:{},moves:[],deferred:DB.leagues.filter(l=>l.kind==='domestic').map(l=>l.id),applied:false};C.settleAwards(DB,s);assert.ok(s.player.honours.some(r=>r.type==='ballon'));assert.ok(s.player.honours.some(r=>r.type==='young'));assert.ok(s.player.honours.some(r=>r.type==='puskas'));const awarded=JSON.stringify(s.player.honours);C.settleAwards(DB,s);assert.equal(JSON.stringify(s.player.honours),awarded);ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:s});
 const recap=C.captureSeasonReview(DB,s,true);assert.equal(recap.honours.length,s.player.honours.length);assert.ok(recap.worldAwards.some(r=>r.type==='ballon'));
});
test('club fit favors nearby squad means across starting and automatic offers while retaining a prospect chance',()=>{
 const s=create(),p=s.player;for(const key of Object.keys(p.stats))p.stats[key]=62;p.age=18;p.traits.potential=95;const clubs=DB.clubs.filter(c=>!c.parent&&!c.historical&&c.id!==p.club),close=clubs.reduce((a,b)=>Math.abs(C.squadOverall(DB,b.id,s)-62)<Math.abs(C.squadOverall(DB,a.id,s)-62)?b:a),strong=clubs.reduce((a,b)=>a.quality>b.quality?a:b),lower=clubs.reduce((a,b)=>a.quality<b.quality?a:b);
 assert.ok(C.offerAbilityFit(DB,p,close,s)>C.offerAbilityFit(DB,p,strong,s)*10);assert.ok(C.offerAbilityFit(DB,p,strong,s,true)>0);assert.ok(C.offerAbilityFit(DB,p,close,s)>C.offerAbilityFit(DB,p,lower,s));s.player.freeAgent=true;
 const nearby=clubs.filter(c=>Math.abs(C.squadOverall(DB,c.id,s)-62)<=4).map(c=>C.scoutingCandidate(DB,s,c)).filter(Boolean),higher=clubs.filter(c=>C.squadOverall(DB,c.id,s)>70).map(c=>C.scoutingCandidate(DB,s,c)).filter(Boolean);assert.ok(nearby.length);assert.ok(nearby.reduce((v,c)=>v+c.weight,0)>higher.reduce((v,c)=>v+c.weight,0));
 const counts=[];for(let seed=0;seed<200;seed++){const offers=C.startingOffers(DB,{...p,country:'EN',startingSeed:seed});counts.push(...offers.filter(o=>o.route.id==='domestic').map(o=>C.squadOverall(DB,o.club.id)));}assert.ok(counts.filter(n=>Math.abs(n-62)<=6).length>counts.filter(n=>n>70).length);
 // A proven high-potential newcomer can still receive a rare senior big-club offer.
 s.date=C.dateAdd(s.seasonStart,153);for(const key of Object.keys(p.stats)){p.stats[key]=70;p.development.birth[key]=95;}p.history=[];
 for(let i=0;i<12;i++){const stats=C.createStats(DB);stats.minutes=90;stats.rating=7.4;p.history.push({date:C.dateAdd(s.date,-100+i*7),stats,appearance:'starter'});}
 const elite=clubs.filter(c=>c.quality>=DB.scoutingRules.strongQuality);for(const c of elite)s.world.clubs[c.id].finance=DB.dynamics.financeMax;const eliteCandidates=elite.map(c=>C.scoutingCandidate(DB,s,c)).filter(Boolean);assert.ok(eliteCandidates.length,'proven prospects remain eligible at some strong clubs');
 const ownLevel=clubs.filter(c=>Math.abs(C.squadOverall(DB,c.id,s)-70)<=4).map(c=>C.scoutingCandidate(DB,s,c)).filter(Boolean);assert.ok(ownLevel.reduce((v,c)=>v+c.weight,0)>eliteCandidates.reduce((v,c)=>v+c.weight,0));
});

test('invalid continental seed/tie references and forged award types are rejected before restoring a career',()=>{
 const s=start(create());for(const corrupt of [x=>{x.continentalBrackets.ucl.ties[0].fixtures[0]='missing';},x=>{x.continentalBrackets.ucl.seeds.s1.club='missing';},x=>{x.continentalBrackets.ucl.nodes[0].home='w:missing';}]){const damaged=C.clone(s);corrupt(damaged);assert.throws(()=>ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:damaged}),/continental/);}
 const damaged=C.clone(s);damaged.player.honours.push({id:'forged',type:'missing',competition:'ucl',season:1,date:s.date,playerId:'player',name:s.player.name,club:s.player.club});assert.throws(()=>ctx.V.validateSave({schema:DB.meta.schema,db:DB,state:damaged}),/awards.record/);
});
test('young player mean overall and shooting grow faster while training and birth caps still limit gains',()=>{
 const s=create();for(const a of DB.attributes){s.player.stats[a.id]=60;s.player.development.caps[a.id]=90;s.player.development.birth[a.id]=95;}s.player.age=18;s.player.traits.professionalism=90;s.player.morale=90;
 const old=C.clone(s),oldDB=C.clone(DB);oldDB.growthRules.trainingMultiplier=oldDB.growthRules.matchMultiplier=1;Object.assign(oldDB.trainingRules,DB.growthRules.previousTrainingLimits);const initial=C.overall(DB,s.player.stats),shot=s.player.stats.shooting;
 for(let i=0;i<52;i++){for(const [state,d] of [[s,DB],[old,oldDB]]){state.date=C.dateAdd(state.seasonStart,i*7);state.round=i;C.grow(d,state,0,d.training.find(t=>t.id==='balanced'));if(i<38)C.grow(d,state,90,{growth:0});}}
 const gain=C.overall(DB,s.player.stats)-initial,prior=C.overall(oldDB,old.player.stats)-initial;assert.ok(gain>prior*1.25,{gain,prior});assert.ok(s.player.stats.shooting>shot);assert.ok(s.player.development.training.total<=DB.trainingRules.seasonTotalMax+1e-9);for(const a of DB.attributes)assert.ok(s.player.development.training.gains[a.id]<=DB.trainingRules.seasonAttributeMax+1e-9);console.log('Growth comparison:',JSON.stringify({newMeanGain:gain,previousMeanGain:prior,newShootingGain:s.player.stats.shooting-shot}));
 const capped=create();for(const a of DB.attributes)capped.player.development.caps[a.id]=capped.player.development.birth[a.id]=capped.player.stats[a.id];const before=JSON.stringify(capped.player.stats);C.grow(DB,capped,0,DB.training.find(t=>t.id==='shooting'));assert.equal(JSON.stringify(capped.player.stats),before);
});
