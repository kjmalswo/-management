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
const create=(overrides={})=>{
  const profile={...C.clone(DB.profile.defaults),name:'저장 검증 선수',displayName:'김',stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial])),...overrides};
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
  // v21.5 recorded positional highlights but shipped without their report labels.
  const event={minute:3,type:'turnoverEvent',club:result.report.club,player:saved.state.player.name,playerId:'player'};
  saved.db.meta.version='21.5.0';delete saved.db.ui.labels[event.type];
  saved.state.player.history[0].result.events.push(event);
  saved.state.matchPresentation={reportId:result.report.id,phase:'live',cursor:2,paused:true};
  const loaded=reload(saved);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.state.player.history[0].result.events.at(-1))),event);
  assert.equal(loaded.db.ui.labels[event.type],DB.ui.labels[event.type]);
  assert.equal(loaded.state.player.history.length,saved.state.player.history.length);
  assert.equal(loaded.state.player.history[0].result.home.stats.goals,result.report.result.home.stats.goals);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.state.player.history[0].result.playerPerformance)),JSON.parse(JSON.stringify(result.report.result.playerPerformance)));
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.state.matchPresentation)),saved.state.matchPresentation);
});
test('new positional rules upgrade an older catalog and preserve edited choices',()=>{
  const previous=C.clone(DB),counts={identity:7,onBall:5,offBall:5};
  previous.meta.version='21.2.3';
  delete previous.matchPerformanceRules;
  previous.matchIntentRules.options=previous.matchIntentRules.options.filter(option=>!option.actionFactors);
  for(const slot of previous.playStyleRules.slots)slot.options=slot.options.slice(0,counts[slot.id]);
  previous.playStyleRules.slots[0].options[1].name='사용자 지정 빌드';
  const updated=context.importSave.upgradePresentationDatabase(previous);
  assert.deepEqual(JSON.parse(JSON.stringify(updated.matchPerformanceRules)),DB.matchPerformanceRules);
  assert.equal(updated.matchIntentRules.options.length,DB.matchIntentRules.options.length);
  assert.equal(updated.playStyleRules.slots[0].options[1].name,'사용자 지정 빌드');
  for(const stock of DB.playStyleRules.slots){
    const slot=updated.playStyleRules.slots.find(slot=>slot.id===stock.id);
    assert.deepEqual(Array.from(slot.options,option=>option.id),stock.options.map(option=>option.id));
  }
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

test('saved appearance choices survive import and pre-portrait saves acquire the art catalog',()=>{
  const fields=DB.profile.appearance.fields;
  const selected=Object.fromEntries(fields.map(field=>[field.id,field.options.at(-1).id]));
  const saved=create({appearance:selected,height:197,weight:92});
  const loaded=reload(saved);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.state.player.appearance)),selected);
  assert.equal(loaded.state.player.height,197);
  assert.equal(loaded.state.player.weight,92);

  delete saved.db.profile.appearance;
  delete saved.state.player.appearance;
  const legacy=reload(saved);
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.db.profile.appearance)),DB.profile.appearance);
  assert.equal(legacy.state.player.height,197);
  assert.equal(legacy.state.player.weight,92);
});

test('pre-expansion appearance databases gain the new presets once and preserve custom choices',()=>{
  const previous=C.clone(DB);
  previous.meta.version='21.2.1';
  for(const field of previous.profile.appearance.fields)field.options=field.options.filter(option=>!option.addedIn);
  const skin=previous.profile.appearance.fields.find(field=>field.id==='skin');
  const removed=skin.options.pop();
  skin.options[0].name='사용자 피부색';
  const custom={id:'olive',name:'사용자 올리브',colors:[...skin.options[0].colors]};
  skin.options.push(custom);

  const upgraded=context.importSave.upgradePresentationDatabase(previous);
  const fields=upgraded.profile.appearance.fields;
  assert.equal(upgraded.meta.version,DB.meta.version);
  for(const stock of DB.profile.appearance.fields){
    const field=fields.find(item=>item.id===stock.id);
    const expected=stock.options.filter(option=>field.id!=='skin'||option.id!==removed.id).map(option=>option.id);
    assert.deepEqual(Array.from(field.options,option=>option.id).sort(),expected.sort());
  }
  assert.equal(skin.options[0].name,'사용자 피부색');
  assert.equal(skin.options.find(option=>option.id===custom.id),custom);
  const once=JSON.stringify(fields);
  context.importSave.upgradePresentationDatabase(upgraded);
  assert.equal(JSON.stringify(upgraded.profile.appearance.fields),once);
});

test('the file picker accepts career JSON and compressed browser backups up to the autosave limit',async()=>{
 const cfg=DB.storageRules;
 assert.equal(cfg.maxImportBytes,cfg.maxAutosaveBytes);
 const saved=create(),expected=saved.state.player.name;
 const previous=saved.db.profile.appearance.fields.find(f=>f.id==='haircut');
 previous.options=previous.options.filter(o=>o.addedIn!=='21.6.0');
 saved.db.meta.version='21.5.0';
 const raw=JSON.stringify(saved);
 const view=vm.createContext({Blob,Response,DecompressionStream,atob,DEFAULT_DB:DB,parseCareerText:context.importSave.parseCareerText,prepareImportedCareer:context.importSave.prepareImportedCareer});
 vm.runInContext(ui.slice(ui.indexOf('async function decodeCareer('),ui.indexOf('async function localCareerRecord('))+ui.slice(ui.indexOf('async function readCareerFile('),ui.indexOf("document.getElementById('save-input').addEventListener")),view);
 const zipped=require('node:zlib').gzipSync(raw).toString('base64');
 for(const file of [new Blob([raw]),new Blob([JSON.stringify({format:cfg.backupFormat,encoding:'gzip',payload:zipped})])]){
  const loaded=await view.readCareerFile(file);
  assert.equal(loaded.state.player.name,expected);
  assert.equal(loaded.db.profile.appearance.fields.find(f=>f.id==='haircut').options.length,27);
 }
 await assert.rejects(view.readCareerFile({size:cfg.maxImportBytes+1}),/saveImportTooLarge/);
});
