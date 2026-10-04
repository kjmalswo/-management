const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1],DB=JSON.parse(section('game-db')),ctx=vm.createContext({});
vm.runInContext(section('game-engine')+';globalThis.C=FootballCore;',ctx);const C=ctx.C,ui=section('game-ui');
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast(')),imports=ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('));
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)};const Core=FootballCore;const t=key=>key;${validators}${imports};globalThis.importCareer=prepareImportedCareer;`,ctx);
const create=()=>{const s=C.createCareer(DB,{...C.clone(DB.profile.defaults),name:'메디컬 회귀 검증',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))},'domestic','kr2-0');for(const m of s.inbox)m.answered=true;return s;};
function reply(s,d,terms=d.terms){assert.ok(C.submitDeal(DB,s,d.id,C.clone(terms)));for(let i=0;i<40&&d.awaiting&&!d.medicalWaiting;i++)C.advance(DB,s);assert.ok(!d.awaiting||d.medicalWaiting);}
function recover(s,d){for(let i=0;i<40&&d.status==='negotiating'&&d.medicalWaiting;i++)C.advance(DB,s);}
const reviews=(s,d)=>s.calendar.entries.filter(e=>e.type==='reply'&&!e.completed&&e.deal===d.id);
test('agreed renewal waits for recovery, rechecks without new rounds, then requests a signature',()=>{
  const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal');s.player.fitness=25;reply(s,d);
  assert.equal(d.medical,'pending');assert.ok(d.medicalWaiting&&d.awaiting);assert.equal(C.pendingResponses(DB,s).length,0);assert.equal(reviews(s,d).length,1);assert.equal(C.signDeal(DB,s,d.id),false);assert.equal(C.submitDeal(DB,s,d.id,C.clone(d.terms)),false);
  const round=d.round,initialMail=s.inbox.filter(m=>m.deal===d.id).at(-1).id;recover(s,d);assert.equal(d.status,'ready');assert.equal(d.round,round);assert.equal(d.medical,'agreed');assert.equal(C.pendingResponses(DB,s).filter(m=>m.deal===d.id).length,1);assert.notEqual(s.inbox.filter(m=>m.deal===d.id).at(-1).id,initialMail);assert.ok(C.signDeal(DB,s,d.id));assert.equal(d.status,'completed');
});
test('a real transfer offer can recover and sign without changing club or reserving money early',()=>{
  const s=create();s.player.freeAgent=true;const target=DB.clubs.find(c=>!c.parent&&!c.historical&&c.id!==s.player.club&&c.league==='kr-2');assert.ok(C.seekClub(DB,s,target.id));for(let i=0;i<30&&!s.offers.some(o=>o.club===target.id);i++)C.advance(DB,s);const d=C.startDeal(DB,s,target.id);assert.ok(d);s.player.injuryDays=45;s.player.injury=Math.ceil(45/DB.calendarRules.injuryDaysPerWeek);const club=s.player.club;reply(s,d);assert.ok(d.medicalWaiting);assert.equal(s.player.club,club);assert.equal(s.pendingTransfer,null);recover(s,d);assert.equal(d.status,'ready');assert.ok(C.signDeal(DB,s,d.id));assert.equal(s.player.club,target.id);
});
test('an imported stalled v14.1.1 save keeps records and terms and repairs exactly one medical review',()=>{
  const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal');s.player.injuryDays=45;reply(s,d);assert.ok(d.medicalWaiting);
  s.calendar.entries=s.calendar.entries.filter(e=>!reviews(s,d).includes(e));d.awaiting=false;delete d.medicalWaiting;
  const oldDB=C.clone(DB);oldDB.meta.version='14.1.1';delete oldDB.dealRules.medicalReviewDays;const saved={schema:DB.meta.schema,db:oldDB,state:s},original=JSON.stringify(saved),fixtureSnapshot=JSON.stringify(s.fixtures),terms=JSON.stringify(d.terms),loaded=ctx.importCareer(saved),restored=loaded.state.deals.find(x=>x.id===d.id);
  assert.equal(JSON.stringify(saved),original);assert.equal(JSON.stringify(loaded.state.fixtures),fixtureSnapshot);assert.equal(JSON.stringify(restored.terms),terms);assert.equal(loaded.db.dealRules.medicalReviewDays,DB.dealRules.medicalReviewDays);assert.ok(restored.medicalWaiting);for(let i=0;i<4;i++)C.syncMarketState(loaded.db,loaded.state);assert.equal(reviews(loaded.state,restored).length,1);assert.equal(C.pendingResponses(loaded.db,loaded.state).length,0);recover(loaded.state,restored);assert.equal(restored.status,'ready');
});
test('medical-only delay at the last round remains recoverable and does not bypass approval',()=>{
  const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal');d.round=DB.dealRules.maxRounds-1;s.player.injuryDays=45;reply(s,d);assert.equal(d.round,DB.dealRules.maxRounds);assert.equal(d.status,'negotiating');assert.ok(d.medicalWaiting);recover(s,d);assert.equal(d.status,'ready');assert.equal(d.round,DB.dealRules.maxRounds);
});
test('financial counteroffers still require a response when medical is also blocked',()=>{
  const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal');s.player.injuryDays=60;const terms=C.clone(d.terms);terms.weekly=DB.dealFields.find(f=>f.id==='weekly').max;reply(s,d,terms);assert.equal(d.status,'negotiating');assert.equal(d.buyer.status,'pending');assert.equal(d.awaiting,false);assert.equal(Boolean(d.medicalWaiting),false);assert.equal(C.pendingResponses(DB,s).filter(m=>m.deal===d.id).length,1);assert.equal(reviews(s,d).length,0);
});
test('long injuries expire at the original deadline and withdrawing cancels outstanding reviews',()=>{
  const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal'),deadline=d.deadline;s.player.injuryDays=100;reply(s,d);recover(s,d);assert.equal(s.date,deadline);assert.equal(d.deadline,deadline);assert.equal(d.status,'failed');assert.equal(d.awaiting,false);assert.equal(C.pendingResponses(DB,s).filter(m=>m.deal===d.id).length,0);assert.equal(reviews(s,d).length,0);
  const other=create(),withdrawn=C.startDeal(DB,other,other.player.club,'renewal');other.player.injuryDays=45;reply(other,withdrawn);withdrawn.status='withdrawn';withdrawn.awaiting=false;C.syncMarketState(DB,other);assert.equal(reviews(other,withdrawn).length,0);assert.equal(withdrawn.medicalWaiting,false);
});
test('health deteriorating between agreement and signature starts a medical review instead of trapping progress',()=>{
  const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal');reply(s,d);assert.equal(d.status,'ready');s.player.injuryDays=45;assert.equal(C.signDeal(DB,s,d.id),false);assert.ok(d.medicalWaiting);assert.equal(C.pendingResponses(DB,s).filter(m=>m.deal===d.id).length,0);recover(s,d);assert.equal(d.status,'ready');
});
test('medical and financial holds can wait explicitly without accepting terms or losing counteroffers',()=>{
  const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal');s.player.injuryDays=45;const terms=C.clone(d.terms);terms.weekly=DB.dealFields.find(f=>f.id==='weekly').max;reply(s,d,terms);assert.equal(d.buyer.status,'pending');assert.equal(C.pendingResponses(DB,s).filter(m=>m.deal===d.id).length,1);
  const original=JSON.stringify(d.terms),counter=JSON.stringify(d.counter),round=d.round,trust=s.agent.trust;assert.ok(C.waitForMedical(DB,s,d.id));assert.ok(d.medicalDeferred&&d.medicalWaiting);assert.equal(C.pendingResponses(DB,s).filter(m=>m.deal===d.id).length,0);assert.equal(JSON.stringify(d.counter),counter);assert.equal(JSON.stringify(d.terms),original);assert.equal(C.signDeal(DB,s,d.id),false);
  const loaded=ctx.importCareer({schema:DB.meta.schema,db:C.clone(DB),state:s}),restored=loaded.state.deals.find(x=>x.id===d.id);recover(loaded.state,restored);assert.equal(restored.medical,'agreed');assert.equal(restored.status,'negotiating');assert.equal(restored.medicalDeferred,false);assert.equal(restored.round,round);assert.equal(loaded.state.agent.trust,trust);assert.equal(JSON.stringify(restored.terms),original);assert.equal(C.pendingResponses(DB,loaded.state).filter(m=>m.deal===d.id).length,1);assert.equal(C.signDeal(DB,loaded.state,restored.id),false);assert.ok(C.submitDeal(DB,loaded.state,restored.id,C.clone(restored.counter)));
});
test('valid proposals with only one or two days left still schedule replies inside the deadline',()=>{
  for(const days of [1,2]){const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal');s.date=C.dateAdd(d.deadline,-days);for(const e of s.calendar.entries)if(e.date<=s.date)e.completed=true;assert.equal(C.dealSubmissionIssue(DB,s,d.id,d.terms),null);assert.ok(C.submitDeal(DB,s,d.id,C.clone(d.terms)));assert.ok(d.responseDate>s.date&&d.responseDate<=d.deadline);while(d.awaiting)C.advance(DB,s);assert.equal(d.status,'ready');}
});
test('deadline and round exhaustion close the negotiation instead of reporting invalid fields and keeping responses blocked',()=>{
  for(const reason of ['negotiationDeadline','negotiationLimit']){const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal');if(reason==='negotiationDeadline')s.date=d.deadline;else d.round=DB.dealRules.maxRounds;assert.equal(C.dealSubmissionIssue(DB,s,d.id,d.terms).key,reason);assert.equal(C.submitDeal(DB,s,d.id,C.clone(d.terms)),false);assert.equal(d.status,'failed');assert.equal(C.pendingResponses(DB,s).filter(m=>m.deal===d.id).length,0);assert.equal(s.inbox.filter(m=>m.deal===d.id).at(-1).body,DB.ui.labels[reason]);}
});
test('submission errors identify invalid fields and distinguish waiting and signing states',()=>{
  const s=create(),d=C.startDeal(DB,s,s.player.club,'renewal'),terms=C.clone(d.terms);terms.years=1.5;terms.role='missing';const issue=C.dealSubmissionIssue(DB,s,d.id,terms);assert.equal(issue.key,'negotiationFieldInvalid');assert.ok(issue.fields.includes(DB.dealFields.find(f=>f.id==='years').name));assert.ok(issue.fields.includes(DB.dealFields.find(f=>f.id==='role').name));assert.equal(C.submitDeal(DB,s,d.id,terms),false);assert.equal(d.round,0);assert.ok(C.submitDeal(DB,s,d.id,C.clone(d.terms)));assert.equal(C.dealSubmissionIssue(DB,s,d.id,d.terms).key,'negotiationWait');while(d.awaiting)C.advance(DB,s);assert.equal(C.dealSubmissionIssue(DB,s,d.id,d.terms).key,'negotiationSignRequired');
});
