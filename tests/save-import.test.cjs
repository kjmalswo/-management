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
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)};const Core=FootballCore;const t=key=>key;${validators}${importFunctions};globalThis.importSave={prepareImportedCareer,parseCareerText,upgradePresentationDatabase};`,context);
const C=context.Core;
const create=()=>{
  const profile={...C.clone(DB.profile.defaults),name:'저장 검증 선수',displayName:'김',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial]))};
  const offer=C.startingOffers(DB,profile)[0];
  return {schema:DB.meta.schema,db:C.clone(DB),state:C.createCareer(DB,profile,offer.route.id,offer.club.id)};
};
const reload=value=>context.importSave.prepareImportedCareer(context.importSave.parseCareerText(JSON.stringify(value)));

test('legacy site branding migrates without changing saved storage identifiers or custom text',()=>{
  const saved=C.clone(DB);saved.meta.version='20.9.10';saved.meta.title='FIRST XI';saved.ui.labels.invalidSave='올바른 FIRST XI 저장 파일이 아닙니다.';saved.ui.labels.mainArtworkAlt='FBC 27 · 경기장에서 뛰는 축구선수';saved.rules.exportFilename='first-xi-career.json';saved.rules.dbFilename='first-xi-database.json';
  const locations=db=>JSON.stringify({career:db.meta.storageKey,database:db.meta.dbStorageKey,settings:db.settings.storageKey,storage:db.storageRules}),before=locations(saved),updated=context.importSave.upgradePresentationDatabase(saved);
  assert.equal(updated.meta.title,'Football Career 27');assert.equal(updated.ui.labels.invalidSave,DB.ui.labels.invalidSave);assert.equal(updated.ui.labels.mainArtworkAlt,DB.ui.labels.mainArtworkAlt);assert.equal(updated.rules.exportFilename,DB.rules.exportFilename);assert.equal(updated.rules.dbFilename,DB.rules.dbFilename);assert.equal(locations(updated),before);
  const once=JSON.stringify(updated);assert.equal(JSON.stringify(context.importSave.upgradePresentationDatabase(updated)),once);
  const custom=C.clone(DB);custom.meta.title='나의 축구 커리어';custom.ui.labels.invalidSave='사용자 안내';custom.ui.labels.mainArtworkAlt='사용자 이미지';custom.rules.exportFilename='my-save.json';custom.rules.dbFilename='my-db.json';context.importSave.upgradePresentationDatabase(custom);
  assert.equal(custom.meta.title,'나의 축구 커리어');assert.equal(custom.ui.labels.invalidSave,'사용자 안내');assert.equal(custom.ui.labels.mainArtworkAlt,'사용자 이미지');assert.equal(custom.rules.exportFilename,'my-save.json');assert.equal(custom.rules.dbFilename,'my-db.json');
});

test('pre-cover autosaves restore missing artwork settings without changing the career or source save',()=>{
  const saved=create();saved.db.meta.version='20.9.5';delete saved.db.ui.mainArtwork;delete saved.db.ui.labels.mainArtworkAlt;
  const before=JSON.stringify(saved),snapshot=s=>JSON.stringify({date:s.date,player:s.player,fixtures:s.fixtures,economy:s.economy,archives:s.archives}),careerBefore=snapshot(saved.state),loaded=reload(saved);
  assert.equal(snapshot(loaded.state),careerBefore);assert.equal(JSON.stringify(saved),before);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.db.ui.mainArtwork)),DB.ui.mainArtwork);
  assert.equal(JSON.stringify(reload(loaded)),JSON.stringify(loaded));
  const custom=create();custom.db.ui.mainArtwork={width:1000,height:1000};assert.deepEqual(JSON.parse(JSON.stringify(reload(custom).db.ui.mainArtwork)),custom.db.ui.mainArtwork);
});

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
  const saved=create();C.setPlayStyleBuild(DB,saved.state,C.playStyleDefaults(DB));let result;
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

