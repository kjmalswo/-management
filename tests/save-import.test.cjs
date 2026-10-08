const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const cp=require('node:child_process');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=(source,id)=>source.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1];
const DB=JSON.parse(section(html,'game-db'));
const context=vm.createContext({});
vm.runInContext(section(html,'game-engine')+';globalThis.Core=FootballCore;',context);
const ui=section(html,'game-ui');
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast('));
const importFunctions=ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('));
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)};const Core=FootballCore;const t=key=>key;${validators}${importFunctions};globalThis.importSave={prepareImportedCareer,parseCareerText};`,context);
const C=context.Core;
const create=()=>{
  const profile={...C.clone(DB.profile.defaults),name:'저장 검증 선수',displayName:'김',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))};
  const offer=C.startingOffers(DB,profile)[0];
  return {schema:DB.meta.schema,db:C.clone(DB),state:C.createCareer(DB,profile,offer.route.id,offer.club.id)};
};
const reload=value=>context.importSave.prepareImportedCareer(context.importSave.parseCareerText(JSON.stringify(value)));

test('a real v20.4 database with revision 1 balance metadata restores in the same schema',()=>{
  const historical=cp.execFileSync(process.env.GIT_PATH||'git',['show','9d4b1ee:index.html'],{cwd:path.join(__dirname,'..'),encoding:'utf8',maxBuffer:10000000});
  const saved=create();saved.db=JSON.parse(section(historical,'game-db'));
  assert.equal(saved.db.balanceRules.revision,1);
  assert.equal(saved.db.balanceRules.previous.rules.initialOverallMax,undefined);
  assert.equal(saved.db.balanceRules.previous.nationalRules,undefined);
  saved.db.scoutingRules.minRating=6.42;saved.db.balanceRules.previous.rules.valueBase=1777;
  const snapshot=s=>JSON.stringify({date:s.date,player:s.player,fixtures:s.fixtures}),before=snapshot(saved.state),original=JSON.stringify(saved.db),loaded=reload(saved);
  assert.equal(snapshot(loaded.state),before);
  assert.equal(JSON.stringify(saved.db),original,'the input save is not modified');
  assert.equal(loaded.db.scoutingRules.minRating,6.42);
  assert.equal(loaded.db.balanceRules.previous.rules.valueBase,1777,'custom migration markers remain intact');
  assert.equal(loaded.db.balanceRules.previous.rules.initialOverallMax,DB.balanceRules.previous.rules.initialOverallMax);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.db.balanceRules.previous.nationalRules)),DB.balanceRules.previous.nationalRules);
  assert.equal(loaded.db.balanceRules.revision,DB.balanceRules.revision);
  assert.equal(JSON.stringify(reload(loaded)),JSON.stringify(loaded),'migration remains stable on the next load');
  loaded.db.balanceRules.previous.rules.initialOverallMax='bad';assert.throws(()=>reload(loaded),/DB.balanceRules.previous.rules.initialOverallMax/);
});

test('a schema 13 save with the pre-expansion color registry restores without changing its career',()=>{
  const saved=create();saved.db.meta.version='15.0.2';
  for(const club of saved.db.clubs.filter(c=>/^(?:youth-)?(?:en-champ|es-segunda|de-bundesliga2|fr-ligue2|it-serieb|pt-liga2|br-serieb|jp-3)-2026-/.test(c.id)))delete saved.db.teamColorRules.legacyMain[club.id];
  saved.db.clubs.find(c=>c.id===saved.state.player.club).color='#123456';
  const before=JSON.stringify(saved.state),snapshot=s=>JSON.stringify({date:s.date,player:s.player,fixtures:s.fixtures}),expected=snapshot(saved.state),loaded=reload(saved);
  assert.equal(snapshot(loaded.state)===expected,true,'player, date, contract, attributes, history and fixtures preserved');
  assert.equal(loaded.db.clubs.find(c=>c.id===saved.state.player.club).color,'#123456');
  assert.equal(Object.keys(loaded.db.teamColorRules.legacyMain).length,Object.keys(DB.teamColorRules.legacyMain).length);
  assert.equal(JSON.stringify(saved.state),before);
});
test('an exported new career imports without requiring every tactic to share weight keys',()=>{
  const saved=create(),loaded=reload(saved);
  assert.equal(loaded.state.player.name,saved.state.player.name);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.state.fixtures)),JSON.parse(JSON.stringify(saved.state.fixtures)));
  assert.ok(!Object.hasOwn(loaded.db.dynamics.trends.find(t=>t.id==='possession').weights,'speed'));
});
test('a played match and paused commentary survive export/import without duplicate records',()=>{
  const saved=create();let result;
  for(let step=0;step<100&&!result?.report;step++)result=C.advance(DB,saved.state);
  assert.ok(result?.report,'a real scheduled match was played');
  saved.state.matchPresentation={reportId:result.report.id,phase:'live',cursor:2,paused:true};
  const loaded=reload(saved);
  assert.equal(loaded.state.player.history.length,saved.state.player.history.length);
  assert.equal(loaded.state.player.history[0].result.home.stats.goals,result.report.result.home.stats.goals);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.state.matchPresentation)),saved.state.matchPresentation);
});
test('legacy schema 8 export upgrades while preserving player and contract',()=>{
  const saved=create();saved.schema=saved.state.schema=saved.db.meta.schema=8;delete saved.db.uniformRules.nameWidth;
  const loaded=reload(saved);
  assert.equal(loaded.schema,DB.meta.schema);
  assert.equal(loaded.state.player.name,saved.state.player.name);
  assert.equal(loaded.state.player.contract.weekly,saved.state.player.contract.weekly);
  assert.equal(loaded.db.uniformRules.nameWidth,DB.uniformRules.nameWidth);
});
test('BOM-prefixed JSON is accepted and malformed or future saves are rejected',()=>{
  assert.equal(context.importSave.prepareImportedCareer(context.importSave.parseCareerText('\uFEFF'+JSON.stringify(create()))).schema,DB.meta.schema);
  assert.throws(()=>context.importSave.parseCareerText('{broken'),/saveImportDamaged/);
  assert.throws(()=>reload(DB),/saveImportFormat/);
  const future=create();future.schema=DB.meta.schema+1;assert.throws(()=>reload(future),/saveImportVersion/);
});
test('missing shared settings and malformed variant weights are rejected without mutating the input',()=>{
  const saved=create(),before=JSON.stringify(saved);
  const missing=C.clone(saved);delete missing.db.storageRules.databaseName;assert.throws(()=>reload(missing));
  const wrong=C.clone(saved);wrong.db.dynamics.trends.find(t=>t.id==='possession').weights.passing='bad';assert.throws(()=>reload(wrong),/weights.passing/);
  const contract=C.clone(saved);contract.state.player.contract.weekly=-1;assert.throws(()=>reload(contract));
  assert.equal(JSON.stringify(saved),before);
});

test('vacation itineraries and temporary form survive import, while damaged records are rejected',()=>{
  const saved=create(),s=saved.state;C.careerIncome(DB,s,100000,'salary');const approved=C.requestVacation(DB,s,'sardinia',C.dateAdd(s.date,1),7);assert.ok(approved.ok);
  const queued=reload(saved);assert.deepEqual(JSON.parse(JSON.stringify(queued.state.vacations)),JSON.parse(JSON.stringify(s.vacations)));
  while(s.vacations[0].status!=='active')C.advance(DB,s);s.player.spotlightForm=.5;const loaded=reload(saved);assert.equal(loaded.state.vacations[0].status,'active');assert.equal(loaded.state.player.vacationForm,s.player.vacationForm);assert.equal(loaded.state.player.spotlightForm,.5);assert.equal(loaded.state.economy.ledger.filter(l=>l.type==='vacation').length,1);
  while(loaded.state.vacations[0].status!=='completed')C.advance(loaded.db,loaded.state);assert.ok(reload(loaded));
  for(const mutate of [value=>value.state.vacations[0].days=90,value=>value.state.vacations[0].destination='missing',value=>value.state.player.spotlightForm=100,value=>value.state.calendar.entries.find(e=>e.type==='vacation-end').date='2026-09-01']){const damaged=C.clone(saved);mutate(damaged);assert.throws(()=>reload(damaged));}
});

test('v20.8.11 saves acquire vacation navigation and Middle East clubs without changing player history',()=>{
  const historical=cp.execFileSync(process.env.GIT_PATH||'git',['show','ed04ae3:index.html'],{cwd:path.join(__dirname,'..'),encoding:'utf8',maxBuffer:10000000});const saved=create();saved.db=JSON.parse(section(historical,'game-db'));const before=JSON.stringify(saved.state.player);const loaded=reload(saved);
  assert.equal(JSON.stringify(loaded.state.player),before);assert.ok(loaded.db.ui.navigationGroups.find(g=>g.id==='economy').views.includes('vacation'));assert.ok(loaded.db.ui.tabs.some(t=>t.id==='vacation'));assert.ok(loaded.db.clubs.some(c=>c.id==='al-hilal'));assert.ok(loaded.state.world.rosters['al-hilal']);assert.ok(loaded.state.fixtures['sa-pro'].length);assert.equal(JSON.stringify(reload(loaded)),JSON.stringify(loaded));
});
