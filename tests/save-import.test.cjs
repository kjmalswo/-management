const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
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
