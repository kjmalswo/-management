const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp(`<script id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1],DB=JSON.parse(section('game-db')),engine=section('game-engine'),ui=section('game-ui'),ctx=vm.createContext({});
vm.runInContext(engine+';globalThis.C=FootballCore;',ctx);const C=ctx.C,plain=value=>JSON.parse(JSON.stringify(value)),profile=(patch={})=>({...C.clone(DB.profile.defaults),name:'역할 검증 선수',startingSeed:73,stats:Object.fromEntries(DB.attributes.map(a=>[a.id,a.initial])),traits:Object.fromEntries(DB.traits.map(a=>[a.id,a.initial])),...patch});
const validators=ui.slice(ui.indexOf('function validateDB('),ui.indexOf('function toast(')),imports=ui.slice(ui.indexOf('function prepareImportedCareer('),ui.indexOf('async function restoreCareer('));
vm.runInContext(`const DEFAULT_DB=${JSON.stringify(DB)},Core=FootballCore,t=key=>key;${validators}${imports};globalThis.V={validateDB,validateSave,prepareImportedCareer};`,ctx);
const options=p=>C.positionRoleOptions(DB,p),roleOption=(p,id)=>options(p).find(option=>option.role.id===id);
let initial;const career=()=>{initial??=C.createCareer(DB,profile({positionRole:'deep-lying-forward'}),'domestic','kr2-0');return C.clone(initial);};

test('role catalog, script syntax and release agree; only requested primary positions receive roles',()=>{
 new vm.Script(engine);new vm.Script(ui);ctx.V.validateDB(C.clone(DB));assert.equal(DB.meta.version,JSON.parse(fs.readFileSync(path.join(__dirname,'../version.json'))).version);
 assert.ok(Buffer.byteLength(html)<25*1024*1024,'keep the single-file deployment within its asset size limit');
 assert.deepEqual(DB.creationSteps.map(step=>step.id),['profile','personality','position-role','contract']);
 for(const [position,count] of [['ST',7],['LW',5],['RW',5],['AM',5],['CM',6]]){
  const p=profile({position}),ranked=options(p);assert.equal(ranked.length,count);assert.equal(new Set(ranked.map(option=>option.role.id)).size,count);
  for(const [index,option] of ranked.entries()){assert.ok(Number.isFinite(option.score)&&option.score>=0&&option.score<=100);if(index)assert.ok(ranked[index-1].score>=option.score);assert.ok(option.role.positions.includes(position));assert.equal(C.validPlayStyleBuild(DB,option.role.build,position),true);}
 }
 for(const position of ['DM','LB','RB','CB','GK'])assert.equal(options(profile({position,secondaryPosition:'ST'})).length,0,'secondary positions must not unlock a primary role');
 assert.deepEqual(plain(options(profile())),plain(options(profile())),'recommendations are deterministic');
});

test('recommendations respond to actual skills, body, DNA, secondary positions and mirrored wing feet',()=>{
 const tall=profile({height:194,weight:91,stats:{speed:40,shooting:85,passing:40,physical:85,defending:40,dribbling:40}});assert.equal(options(tall)[0].role.id,'target-striker');
 const creative=profile({height:175,weight:68,secondaryPosition:'AM',stats:{speed:40,shooting:40,passing:85,physical:40,defending:40,dribbling:85},traits:{...profile().traits,intelligence:100,decisions:100,adaptability:100},characterTrait:'savvy'});assert.equal(options(creative)[0].role.id,'false-nine');
 const base=profile(),target=roleOption(base,'target-striker');assert.ok(roleOption({...base,height:194,weight:91},'target-striker').components.body>target.components.body);
 const dna=roleOption(base,'deep-lying-forward');assert.ok(roleOption({...base,traits:{...base.traits,intelligence:100,decisions:100,composure:100}},'deep-lying-forward').components.dna>dna.components.dna);
 assert.ok(roleOption({...base,characterTrait:'savvy'},'deep-lying-forward').components.dna>roleOption({...base,characterTrait:'resilience'},'deep-lying-forward').components.dna);
 assert.ok(roleOption({...base,secondaryPosition:'AM'},'deep-lying-forward').components.secondary>dna.components.secondary);
 assert.ok(roleOption({...base,tertiaryPosition:'AM'},'deep-lying-forward').components.secondary>dna.components.secondary);
 for(const position of ['LW','RW']){
  const natural=position==='LW'?'left':'right',inverted=natural==='left'?'right':'left',wing=profile({position,foot:natural});
  assert.ok(roleOption(wing,'winger').score>roleOption({...wing,foot:inverted},'winger').score);
  assert.ok(roleOption({...wing,foot:inverted},'inside-forward').score>roleOption(wing,'inside-forward').score);
  assert.equal(roleOption({...wing,foot:'both'},'inside-forward').components.foot,100);
 }
 const press=roleOption(base,'pressing-forward').components.dna;assert.ok(roleOption({...base,traits:{...base.traits,injuryProneness:100}},'pressing-forward').components.dna<press);
});

const functionText=name=>{const start=ui.indexOf('function '+name+'('),end=ui.indexOf('\nfunction ',start+1);assert.ok(start>=0);return ui.slice(start,end);};
function screenHarness(p=profile()){
 const app={innerHTML:'',insertAdjacentHTML(position,markup){assert.equal(position,'afterbegin');this.innerHTML=markup+this.innerHTML;}},handlers={},elements=new Map([['app',app]]);
 for(const id of ['game-db','club-emblem-assets','national-emblem-assets','branding-assets'])elements.set(id,{textContent:section(id)});
 const document={getElementById:id=>elements.get(id)||null,querySelector:()=>null,addEventListener:(type,callback)=>{(handlers[type]??=[]).push(callback);}};
 const context=vm.createContext({document,window:{scrollTo(){}},FootballCore:C,Intl});
 vm.runInContext(ui.slice(0,ui.indexOf('const progress=')),context);
 const steps=ui.split('\n').find(line=>line.startsWith('const creationSteps='));
 const actions=ui.slice(ui.indexOf("document.addEventListener('click',async event=>{const button=event.target.closest('[data-action]')"),ui.indexOf("document.getElementById('save-input').addEventListener"));
 vm.runInContext(`draft=${JSON.stringify(p)};let creationStep='personality',storageLoading=false,matchLoading=false,calendarLoading=false,modalContent='',settingsVisits=0;
 const titleLogo=()=>'',saveRecoveryNotice=()=>'',renderProfile=()=>{document.getElementById('app').innerHTML='profile';},renderOnboardSettings=()=>{settingsVisits++;document.getElementById('app').innerHTML='settings';},render=()=>renderOnboard(),closeModal=()=>{modalContent='';},showContracts=()=>{modalContent='contracts';};
 ${steps}
 ${['renderOnboard','updateDraft','positionRoleCard','renderPositionRoles','renderPersonality'].map(functionText).join('\n')}
 ${actions}
 renderOnboard();
 globalThis.Q={draft:()=>draft,step:()=>creationStep,modal:()=>modalContent,setPosition:position=>{draft.position=position;},settingsVisits:()=>settingsVisits};`,context);
 return {app,Q:context.Q,click:async(action,id)=>{const button={dataset:{action,id},disabled:false};for(const callback of handlers.click)await callback({target:{closest:selector=>selector==='[data-action]'?button:null}});}};
}

test('creation actions put roles between personality and contracts, retain manual selection through settings/back, and show all choices',async()=>{
 const screen=screenHarness();assert.match(screen.app.innerHTML,/aria-current="step">2\. 성격/);await screen.click('personality-next');assert.equal(screen.Q.step(),'position-role');assert.match(screen.app.innerHTML,/aria-current="step">3\. 포지션/);
 const ranked=options(screen.Q.draft()),markup=screen.app.innerHTML;assert.equal((markup.match(/data-action="position-role-select"/g)||[]).length,7);
 for(let index=0;index<3;index++)assert.ok(markup.indexOf('data-id="'+ranked[index].role.id+'"')<markup.indexOf('id="role-others"'));
 assert.match(markup,/data-action="position-role-next" disabled/);await screen.click('position-role-next');assert.equal(screen.Q.modal(),'');
 const manual=ranked.at(-1).role.id;await screen.click('position-role-select',manual);assert.equal(screen.Q.draft().positionRole,manual);assert.match(screen.app.innerHTML,new RegExp('data-id="'+manual+'" aria-pressed="true"'));assert.doesNotMatch(screen.app.innerHTML,/data-action="position-role-next" disabled/);
 await screen.click('onboard-settings');assert.equal(screen.Q.settingsVisits(),1);await screen.click('onboard-settings-back');assert.equal(screen.Q.step(),'position-role');assert.equal(screen.Q.draft().positionRole,manual);
 await screen.click('position-role-next');assert.equal(screen.Q.modal(),'contracts');await screen.click('position-role-back');assert.equal(screen.Q.modal(),'');assert.equal(screen.Q.draft().positionRole,manual);
 await screen.click('personality-back');assert.equal(screen.Q.step(),'personality');await screen.click('personality-next');assert.equal(screen.Q.draft().positionRole,manual);
 await screen.click('personality-back');screen.Q.setPosition('CM');await screen.click('personality-next');assert.equal(screen.Q.draft().positionRole,undefined);assert.equal((screen.app.innerHTML.match(/data-action="position-role-select"/g)||[]).length,6);
 await screen.click('position-role-select','poacher');assert.equal(screen.Q.draft().positionRole,undefined,'invalid selections must not be accepted');
 assert.match(functionText('showContracts'),/positionRoleBack/);assert.match(functionText('showContracts'),/position-role-back/);
});

test('unsupported primary positions can continue without a role, and role screen escapes player-controlled text',async()=>{
 const screen=screenHarness(profile({position:'GK',secondaryPosition:'none',positionRole:'poacher',name:'<img src=x onerror=alert(1)>'}));await screen.click('personality-next');assert.equal(screen.Q.draft().positionRole,undefined);assert.match(screen.app.innerHTML,/GK의 세부 역할은 준비 중/);assert.doesNotMatch(screen.app.innerHTML,/data-action="position-role-select"|data-action="position-role-next" disabled|<img src=x/);assert.match(screen.app.innerHTML,/&lt;img/);await screen.click('position-role-next');assert.equal(screen.Q.modal(),'contracts');
});

test('manual roles seed the existing play style without changing ability, and survive export/import without reapplying defaults',()=>{
 const p=profile({positionRole:'deep-lying-forward'}),s=career(),role=DB.positionRoleRules.roles.find(role=>role.id===p.positionRole);assert.equal(s.player.positionRole,p.positionRole);assert.equal(s.player.playStyleSetupComplete,true);assert.deepEqual(plain(s.player.playStyleBuild),role.build);assert.deepEqual(plain(s.player.stats),p.stats);
 assert.equal(C.setPlayStyleBuild(DB,s,C.playStyleDefaults(DB)),true);const envelope={schema:DB.meta.schema,db:C.clone(DB),state:s},before=JSON.stringify(envelope),loaded=ctx.V.prepareImportedCareer(JSON.parse(before));assert.equal(loaded.state.player.positionRole,p.positionRole);assert.deepEqual(plain(loaded.state.player.playStyleBuild),plain(C.playStyleDefaults(DB)));assert.equal(JSON.stringify(envelope),before);assert.equal(JSON.stringify(ctx.V.prepareImportedCareer(loaded)),JSON.stringify(loaded));
 const old=C.clone(envelope);delete old.db.positionRoleRules;delete old.state.player.positionRole;old.db.creationSteps=old.db.creationSteps.filter(step=>step.id!=='position-role');old.db.creationSteps.find(step=>step.id==='contract').name='3. 시작 팀 선택';old.db.ui.labels.personalityNext='시작 팀 선택으로';const originalPlayer=JSON.stringify(old.state.player),legacy=ctx.V.prepareImportedCareer(old);assert.equal(JSON.stringify(legacy.state.player),originalPlayer);assert.equal(legacy.db.creationSteps.filter(step=>step.id==='position-role').length,1);assert.equal(legacy.db.ui.labels.personalityNext,DB.ui.labels.personalityNext);
 for(const mutate of [value=>value.state.player.positionRole='unknown',value=>value.state.player.positionRole='mezzala',value=>value.db.positionRoleRules.roles=value.db.positionRoleRules.roles.filter(role=>role.id!==p.positionRole),value=>value.db.positionRoleRules.roles[0].build.identity='unknown',value=>value.db.positionRoleRules.roles[0].stats.shooting=-1,value=>value.db.positionRoleRules.bodySpans.height=0]){const broken=C.clone(envelope);mutate(broken);const before=JSON.stringify(broken);assert.throws(()=>ctx.V.prepareImportedCareer(broken));assert.equal(JSON.stringify(broken),before);}
 assert.throws(()=>C.createCareer(DB,profile({positionRole:'mezzala'}),'domestic','kr2-0'),/positionRole.selection/);
});
