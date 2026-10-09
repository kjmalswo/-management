const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),section=id=>html.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'))[1],bundled=JSON.parse(section('game-db')),ui=section('game-ui');
const result=(home,away,winner)=>({home:{stats:{goals:home}},away:{stats:{goals:away}},winner});
function fixture(id,home,away,date,score=null,extra={}){return {id,competition:'dom',home,away,date,result:score,round:0,...extra};}
function setup(){
 const DB={...bundled,clubs:['a','b','c'].map(id=>({id,name:'Team '+id,league:'dom'})),nationalTeams:[],leagues:[{id:'dom',name:'Domestic League'},{id:'cup',name:'Continental Cup',kind:'continental'},{id:'post',name:'Playoffs',kind:'postseason'}],nationalCompetitions:[{id:'nt',name:'National Cup'}]},state={season:2,date:'2026-09-01',player:{club:'a',freeAgent:false},world:{clubs:{}},fixtures:{dom:[],cup:[],post:[]},archives:[],calendar:{entries:[]},nations:{team:'a',camp:null,callups:[],tournaments:{}}};
 const context=vm.createContext({DB,state}),helpers=ui.slice(ui.indexOf('function tableClub('),ui.indexOf('function broadcastLineup(')),score=ui.match(/function broadcastScore\([^\n]+/)[0];
 vm.runInContext(section('game-engine')+String.raw`;const Core=FootballCore;const idx=()=>Core.indexes(DB,state);const n=value=>String(value);const h=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');const t=(key,values={})=>String(DB.ui.labels[key]??key).replace(/\{(\w+)\}/g,(_,name)=>values[name]??'');const crest=club=>'<div class="crest crest-image" aria-hidden="true"><img src="badge:'+club.id+'" alt=""></div>';const entityLink=(kind,id,name)=>'<button data-kind="'+kind+'" data-id="'+id+'">'+h(name)+'</button>';`+score+'\n'+helpers+';globalThis.API={matchTable,matchTeamRanks,previousCompetitionFinish,matchRoundName,matchScoreboard,nextTurnIsMatch,tableClub};',context);
 return {DB,state,api:context.API};
}
test('league standings remain at kickoff throughout preparation and commentary, without changing fixtures',()=>{
 const {state,api}=setup(),f=fixture('today','a','b','2026-09-10',null,{season:2,league:'dom',round:4});state.fixtures.dom=[fixture('before','a','c','2026-09-02',result(0,3)),f,fixture('future','a','c','2026-09-15',result(20,0))];
 assert.deepEqual(JSON.parse(JSON.stringify(api.matchTeamRanks(f))),{home:'리그 3위',away:'리그 2위'});f.result=result(6,0);const before=JSON.stringify(state);
 assert.deepEqual(JSON.parse(JSON.stringify(api.matchTeamRanks(f))),{home:'리그 3위',away:'리그 2위'});assert.equal(JSON.stringify(state),before);
 for(const phase of ['broadcastLineups','broadcastLocker','broadcastLive']){const view=api.matchScoreboard(f,[],phase);assert.match(view,/Domestic League/);assert.match(view,/5 라운드/);assert.match(view,/리그 3위/);assert.match(view,/리그 2위/);assert.match(view,/match-competition/);}
});
test('national group rankings use the current group and exclude the current game result',()=>{
 const {state,api}=setup(),f=fixture('nt-today','a','b','2026-06-10',result(0,10),{competition:'nt',national:true,stage:'group',group:'A'}),t={id:'nt:2026',competition:'nt',year:2026,participants:['a','b','c','d'],groups:[{id:'A',teams:['a','b']},{id:'B',teams:['c','d']}],fixtures:[fixture('nt-first','a','b','2026-06-03',result(2,0),{stage:'group',group:'A'}),fixture('other','c','d','2026-06-03',result(9,0),{stage:'group',group:'B'}),f]};state.nations.tournaments[t.id]=t;
 assert.deepEqual(JSON.parse(JSON.stringify(api.matchTeamRanks(f))),{home:'A조 1위',away:'A조 2위'});assert.match(api.matchRoundName(f),/A조/);
});
test('continental league phase uses its own ranking and labels knockout rounds and legs',()=>{
 const {DB,state,api}=setup(),f=fixture('cup-today','a','b','2026-09-10',null,{competition:'cup',league:'cup',stage:'league',formatRevision:DB.continentalRules.revision,round:2});state.fixtures.cup=[fixture('cup-before','a','c','2026-09-02',result(1,0),{competition:'cup',stage:'league'}),f];
 assert.deepEqual(JSON.parse(JSON.stringify(api.matchTeamRanks(f))),{home:'리그 페이즈 1위',away:'리그 페이즈 2위'});assert.match(api.matchRoundName(f),/3 라운드/);assert.ok(api.matchRoundName(f).includes(DB.ui.labels.competitionLeaguePhase));
 const round=api.matchRoundName({...f,stage:'quarter',leg:2,legs:2});assert.ok(round.includes(DB.ui.labels.competitionQuarter));assert.ok(round.includes('2차전'));assert.equal(api.matchRoundName({...f,stage:'final',leg:1,legs:1}),DB.ui.labels.competitionFinal);
});
test('knockout status comes from the previous season of the same competition, with honest missing records',()=>{
 const {DB,state,api}=setup(),f=fixture('now','a','b','2026-12-01',null,{competition:'cup',league:'cup',season:2,stage:'semi',formatRevision:DB.continentalRules.revision});
 assert.match(api.matchTeamRanks(f).home,/전시즌.*기록 없음/);state.archives=[{season:1,fixtures:{cup:[fixture('quarter','a','c','2025-10-01',result(2,0,'a'),{stage:'quarter',formatRevision:DB.continentalRules.revision}),fixture('semi','a','b','2025-11-01',result(0,1,'b'),{stage:'semi',formatRevision:DB.continentalRules.revision}),fixture('final','b','d','2025-12-01',result(1,0,'b'),{stage:'final'})]}}];
 assert.equal(api.matchTeamRanks(f).home,'전시즌 · '+DB.ui.labels.competitionSemi+' 진출');assert.equal(api.matchTeamRanks(f).away,'전시즌 · 우승');assert.equal(api.previousCompetitionFinish(f,'d'),'준우승');assert.equal(api.previousCompetitionFinish(f,'absent'),'불참');assert.match(api.previousCompetitionFinish({...f,competition:'post'},'b'),/기록 없음/);
});
test('playoff series finish uses the archived tie winner rather than one game winner',()=>{
 const {state,api}=setup(),f=fixture('now','a','b','2026-12-01',null,{competition:'post',season:2,stage:'knockout',postseason:'title',tie:'final'});state.archives=[{season:1,fixtures:{post:[fixture('last','a','b','2025-12-01',result(0,1,'b'),{stage:'knockout',postseason:'title',tie:'final',leg:3})]},postseason:{competitions:{title:{ties:[{id:'final',winner:'a'}]}}}}];
 assert.equal(api.previousCompetitionFinish(f,'a'),'우승');assert.equal(api.previousCompetitionFinish(f,'b'),'준우승');assert.match(api.matchRoundName({...f,tie:'east-final',leg:2}),/동부/);
});
test('national previous-season finish supports bronze matches and does not substitute an older edition',()=>{
 const {state,api}=setup(),f=fixture('now','a','b','2026-06-01',null,{national:true,competition:'nt',stage:'quarterfinal'});state.nations.tournaments={current:{id:'current',year:2026,competition:'nt',fixtures:[f]},previous:{id:'previous',year:2025,competition:'nt',fixtures:[fixture('bronze','a','c','2025-06-01',result(1,0,'a'),{stage:'third'})]}};
 assert.equal(api.previousCompetitionFinish(f,'a'),'3위');assert.equal(api.previousCompetitionFinish(f,'c'),'4위');state.nations.tournaments.previous.year=2022;assert.match(api.previousCompetitionFinish(f,'a'),/기록 없음/);
});
test('the progress preview is read-only and only identifies the actual next own match',()=>{
 const {state,api}=setup();state.fixtures.dom=[fixture('mine','a','b','2026-09-10')];state.calendar.entries=[{id:'training',type:'training',date:'2026-09-02',priority:1,completed:false},{id:'match',type:'match',date:'2026-09-10',priority:1,completed:false}];
 assert.equal(api.nextTurnIsMatch(),false);state.calendar.entries[0].completed=true;const before=JSON.stringify(state);assert.equal(api.nextTurnIsMatch(),true);assert.equal(JSON.stringify(state),before);state.player.freeAgent=true;assert.equal(api.nextTurnIsMatch(),false);state.player.freeAgent=false;state.fixtures.dom[0].result=result(1,0);assert.equal(api.nextTurnIsMatch(),false);
});
test('table identities keep club links and historical labels beside a decorative logo',()=>{
 const {api}=setup(),view=api.tableClub('a','Former <Name>');assert.match(view,/src="badge:a"/);assert.match(view,/data-kind="club" data-id="a"/);assert.match(view,/Former &lt;Name>/);assert.match(view,/aria-hidden="true"/);assert.doesNotMatch(view,/<div/);
});
