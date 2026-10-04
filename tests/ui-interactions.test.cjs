const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1],DB=JSON.parse(section('game-db')),ui=section('game-ui'),context=vm.createContext({});
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast('));
const imports=ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('));
vm.runInContext(section('game-engine')+';const Core=FootballCore;const DEFAULT_DB='+JSON.stringify(DB)+';const t=key=>key;'+validators+imports+';globalThis.API={validateDB,upgradePresentationDatabase};',context);
const clone=()=>JSON.parse(JSON.stringify(DB));
test('interaction explanations have stable IDs, meaningful labels and valid dimensions',()=>{
 assert.doesNotThrow(()=>context.API.validateDB(clone()));assert.ok(DB.ui.interactions.glossary.some(entry=>entry.id==='xg'));assert.ok(DB.ui.interactions.glossary.some(entry=>entry.id==='xa'));
 for(const entry of DB.ui.interactions.glossary){assert.ok(entry.description.length>entry.labels[0].length);assert.ok(entry.labels.length);}
});
test('a v17 presentation database gains explanations while retaining game data and custom text',()=>{
 const previous=clone();delete previous.ui.interactions;for(const key of Object.keys(previous.ui.labels).filter(key=>key.startsWith('info')))delete previous.ui.labels[key];previous.meta.version='17.0.0';previous.ui.labels.welcome='사용자 환영 {name}';previous.clubs[0].color='#123456';
 const engineData=db=>JSON.stringify(Object.fromEntries(Object.entries(db).filter(([key])=>!['ui','meta','teamColorRules'].includes(key)))),before=engineData(previous),updated=context.API.upgradePresentationDatabase(previous);
 assert.equal(engineData(updated),before);assert.equal(updated.ui.labels.welcome,'사용자 환영 {name}');assert.equal(updated.clubs[0].color,'#123456');assert.equal(updated.meta.version,'17.1.0');assert.deepEqual(JSON.parse(JSON.stringify(updated.ui.interactions)),DB.ui.interactions);assert.doesNotThrow(()=>context.API.validateDB(updated));
});
test('invalid tooltip geometry, duplicate IDs and malformed descriptions are rejected',()=>{
 for(const change of [db=>db.ui.interactions.tooltipWidthPixels=0,db=>db.ui.interactions.tooltipDelayMs=-1,db=>db.ui.interactions.tooltipInsetPixels=db.ui.interactions.tooltipWidthPixels,db=>db.ui.interactions.glossary.push(db.ui.interactions.glossary[0]),db=>db.ui.interactions.glossary[0].description='',db=>db.ui.interactions.glossary[0].id='<invalid>']){const db=clone();change(db);assert.throws(()=>context.API.validateDB(db));}
});
test('explicit user-edited explanations survive presentation migration',()=>{
 const db=clone();db.ui.interactions.glossary.find(entry=>entry.id==='xg').description='사용자가 작성한 기대득점 설명';const updated=context.API.upgradePresentationDatabase(db);assert.equal(updated.ui.interactions.glossary.find(entry=>entry.id==='xg').description,'사용자가 작성한 기대득점 설명');assert.doesNotThrow(()=>context.API.validateDB(updated));
});
